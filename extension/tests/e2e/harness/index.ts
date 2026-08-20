import { createElement } from 'react';
import { claudeAdapter } from '../../../src/adapters/claude';
import { AnchorEngine } from '../../../src/anchor/AnchorEngine';
import { layoutBatcher } from '../../../src/anchor/LayoutBatcher';
import { HALO_SIZE } from '../../../src/config/constants';
import { mountWidget } from '../../../src/ui/mountWidget';
import { ScoreHalo } from '../../../src/ui/ScoreHalo';
import { widgetStore } from '../../../src/store/widgetStore';
import css from '../../../src/ui/style.css?inline';
import {
  getInstrumentReport,
  installInstrumentation,
  noteTopLeft,
  resetInstrumentation,
  withSampler,
  type InstrumentReport,
} from './instrument';

/**
 * Drives the real production AnchorEngine against a fixture page.
 *
 * This deliberately imports the shipped modules rather than a test double.
 * The whole question M1 has to answer — does the halo stay glued — is only
 * meaningful against the actual observer wiring, in an actual browser, with
 * actual scroll and resize timing.
 */

export interface DriftReport extends InstrumentReport {
  samples: number;
  visibleSamples: number;
  /**
   * Largest deviation from the settled offset, over samples where the composer
   * held still for at least one frame. This is the number that must stay
   * within budget.
   */
  maxDrift: number;
  /**
   * Largest deviation including samples taken while the composer was moving.
   * Informational: a sample can land between the browser applying a layout
   * change and the frame that corrects for it, and no such state is ever
   * painted. Reported so the transient magnitude is visible rather than
   * silently discarded.
   */
  transientMaxDrift: number;
  /** Samples discarded because the composer moved between them. */
  movingSamples: number;
  /** Where the drift peaked, for debugging a failure. */
  worst: { dx: number; dy: number } | null;
  /** Full geometry at the drift peak, so a failure is diagnosable. */
  worstDetail: Record<string, unknown> | null;
  /** The settled offset every sample is compared against. */
  baseline: { dx: number; dy: number } | null;
  hostCount: number;
  headStyleCount: number;
}

interface Harness {
  start(): void;
  stop(): void;
  baseline(): void;
  reset(): void;
  report(): DriftReport;
  setText(text: string): void;
  drive(on: boolean): void;
}

let engine: AnchorEngine | null = null;
let host: HTMLElement | null = null;
let widget: ReturnType<typeof mountWidget> | null = null;
let rafHandle: number | null = null;
let driveHandle: number | null = null;
let driveStep = 0;

let baselineOffset: { dx: number; dy: number } | null = null;
let samples = 0;
let visibleSamples = 0;
let maxDrift = 0;
let transientMaxDrift = 0;
let movingSamples = 0;
let previousComposer: { x: number; y: number; w: number; h: number } | null = null;
let worst: { dx: number; dy: number } | null = null;
let worstDetail: Record<string, unknown> | null = null;

/**
 * Sample what the browser actually painted.
 *
 * Sampling from inside the animation frame is wrong, and wrong in a way that
 * invents drift that no user could ever see: within one frame the engine reads
 * the composer's new rect and writes the matching transform, but a sampler
 * registered earlier in the same rAF queue runs *between* those two steps and
 * reads the new rect against the old transform. Nothing is painted in that
 * gap. Deferring to a task after the frame's rendering steps measures the
 * composed result instead of an intermediate one.
 */
function scheduleSample(): void {
  rafHandle = requestAnimationFrame(() => {
    setTimeout(() => {
      sample();
      if (engine) scheduleSample();
    }, 0);
  });
}

function sample(): void {
  const composer = claudeAdapter.getComposer();
  if (!composer || !host) return;

  withSampler(() => {
    samples += 1;
    noteTopLeft(host!);

    const visible = host!.style.visibility === 'visible';
    if (!visible) return;

    const c = composer.getBoundingClientRect();
    const h = host!.getBoundingClientRect();
    if (h.width === 0 && h.height === 0) return;

    visibleSamples += 1;

    // "Glued" means the widget holds a constant offset from the composer's
    // anchor corner. Measuring the offset rather than an absolute position is
    // what makes this a drift test rather than a re-implementation of the
    // placement solver.
    const offset = { dx: h.right - c.right, dy: h.bottom - c.bottom };
    if (!baselineOffset) {
      baselineOffset = offset;
      previousComposer = { x: c.x, y: c.y, w: c.width, h: c.height };
      return;
    }

    const drift = Math.max(
      Math.abs(offset.dx - baselineOffset.dx),
      Math.abs(offset.dy - baselineOffset.dy),
    );

    /*
     * Only judge samples where the composer held still since the previous one.
     *
     * There is no API for "read the state that was just painted". This sampler
     * runs in a task after the frame, and a layout change driven from the test
     * process — a viewport resize, say — can be applied by the browser between
     * that frame and this task. The sampler then compares a moved composer
     * against a transform computed for where it used to be, and reports drift
     * for a frame that was never rendered. Verified directly: at the peak, the
     * engine's committed placement matched the widget's actual position
     * exactly, and the only stale value was the composer rect the engine had
     * measured — it simply had not been told yet.
     *
     * Requiring one frame of stillness removes that whole class of false
     * positive while still catching everything real: a genuine misalignment
     * persists after the geometry settles, and so does any lag longer than a
     * frame.
     */
    const still =
      previousComposer !== null &&
      Math.abs(previousComposer.x - c.x) < 0.5 &&
      Math.abs(previousComposer.y - c.y) < 0.5 &&
      Math.abs(previousComposer.w - c.width) < 0.5 &&
      Math.abs(previousComposer.h - c.height) < 0.5;
    previousComposer = { x: c.x, y: c.y, w: c.width, h: c.height };

    if (drift > transientMaxDrift) transientMaxDrift = drift;
    if (!still) {
      movingSamples += 1;
      return;
    }

    if (drift > maxDrift) {
      maxDrift = drift;
      worst = offset;
      const round = (n: number) => Math.round(n);
      worstDetail = {
        composer: { x: round(c.x), y: round(c.y), w: round(c.width), h: round(c.height) },
        host: { x: round(h.x), y: round(h.y) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        sidebar: document.body.classList.contains('sidebar-open'),
        zones: [...document.querySelectorAll('.controls button')].map((b) => {
          const r = b.getBoundingClientRect();
          return { label: b.getAttribute('aria-label'), x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
        }),
        /*
         * The composer rect the engine last measured. If this matches the
         * live composer rect the engine is current and any mismatch is in the
         * write; if it is stale the engine never measured this state. That
         * distinction is the whole diagnosis.
         */
        engineSawBox: engine?.lastTargetBox
          ? {
              x: round(engine.lastTargetBox.x), y: round(engine.lastTargetBox.y),
              w: round(engine.lastTargetBox.width), h: round(engine.lastTargetBox.height),
            }
          : null,
        enginePlacement: engine
          ? { x: round(engine.placement.x), y: round(engine.placement.y), slid: engine.placement.slid }
          : null,
        wrapper: (() => {
          const w = document.querySelector('.composer-wrapper');
          if (!w) return null;
          const r = w.getBoundingClientRect();
          return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
        })(),
      };
    }
  });
}

/**
 * Mutate the page from inside an animation frame, one change per frame.
 *
 * Driving these from the test process instead would make the results
 * meaningless: a `page.evaluate` runs as its own task, so a mutation can land
 * between the last paint and the sampler's post-frame task, and the sampler
 * then compares a moved composer against a transform for a frame that was
 * never rendered. Every "drift" measured that way is a state no user could
 * see.
 *
 * Mutating inside the frame puts the change ahead of the browser's own
 * ResizeObserver and IntersectionObserver steps, which is where the engine
 * corrects itself, and both are ahead of paint. So each frame is either
 * consistent when it is painted or genuinely wrong — which is the thing worth
 * measuring. It is also far harsher than the real world: sixty layout changes
 * a second, every second.
 */
function driveFrame(): void {
  if (driveHandle === null) return;
  driveHandle = requestAnimationFrame(driveFrame);
  driveStep += 1;

  const transcript = document.getElementById('transcript');
  if (transcript) {
    const range = Math.max(1, transcript.scrollHeight - transcript.clientHeight);
    transcript.scrollTop = (driveStep * 37) % range;
  }

  // The site's own side panel opening: shifts the composer sideways without
  // resizing it, without scrolling it, and without mutating anything the
  // narrowly scoped MutationObserver watches.
  if (driveStep % 5 === 0) document.body.classList.toggle('sidebar-open');

  // Typing: grows the composer line by line.
  if (driveStep % 7 === 0) {
    const lines = 1 + (driveStep % 6);
    harness.setText(Array.from({ length: lines }, (_, n) => `line ${n}`).join('\n'));
  }

  if (driveStep % 11 === 0) {
    document.body.dataset.theme = document.body.dataset.theme === 'dark' ? '' : 'dark';
  }
}

const harness: Harness = {
  start() {
    if (engine) return;
    installInstrumentation(window, () => layoutBatcher.flushing);

    widget = mountWidget(css, createElement(ScoreHalo));
    host = widget.host;

    // M1 renders a hardcoded score; the analyzer arrives in M3.
    widgetStore.getState().setActive(true);
    widgetStore.getState().setScore(64, 3);

    engine = new AnchorEngine({
      host,
      size: { width: HALO_SIZE, height: HALO_SIZE },
      spec: claudeAdapter.anchor,
      resolveTarget: () => claudeAdapter.getComposer(),
    });
    engine.attach();

    scheduleSample();
  },

  stop() {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    engine?.detach();
    engine = null;
    widget?.destroy();
    widget = null;
    host = null;
  },

  /** Re-take the settled offset — called after the page stops moving. */
  baseline() {
    baselineOffset = null;
    previousComposer = null;
    maxDrift = 0;
    transientMaxDrift = 0;
    movingSamples = 0;
    worst = null;
    worstDetail = null;
  },

  reset() {
    resetInstrumentation();
    samples = 0;
    visibleSamples = 0;
    maxDrift = 0;
    transientMaxDrift = 0;
    movingSamples = 0;
    worst = null;
    worstDetail = null;
  },

  report() {
    return {
      ...getInstrumentReport(),
      samples,
      visibleSamples,
      maxDrift,
      transientMaxDrift,
      movingSamples,
      worst,
      worstDetail,
      baseline: baselineOffset,
      // The extension's entire footprint: one element, appended to body.
      hostCount: document.querySelectorAll('[data-forge-host]').length,
      headStyleCount: document.head.querySelectorAll('style[wxt-shadow-root-document-styles]').length,
    };
  },

  drive(on: boolean) {
    if (on && driveHandle === null) {
      driveHandle = requestAnimationFrame(driveFrame);
    } else if (!on && driveHandle !== null) {
      cancelAnimationFrame(driveHandle);
      driveHandle = null;
    }
  },

  setText(text: string) {
    const composer = claudeAdapter.getComposer();
    if (!composer) return;
    composer.innerHTML = text
      .split('\n')
      .map((line) => `<p>${line || '<br>'}</p>`)
      .join('');
  },
};

declare global {
  interface Window {
    __forge: Harness;
  }
}

window.__forge = harness;
