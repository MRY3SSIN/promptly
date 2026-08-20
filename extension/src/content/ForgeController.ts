import type { SiteAdapter } from '../adapters/types';
import { AnchorEngine } from '../anchor/AnchorEngine';
import { layoutBatcher } from '../anchor/LayoutBatcher';
import { HALO_SIZE } from '../config/constants';
import { widgetStore } from '../store/widgetStore';
import { detectTheme } from '../ui/theme';
import type { WidgetHandle } from '../ui/mountWidget';
import { log, telemetry } from '../util/logger';

/**
 * Ties the adapter, the anchor engine and the widget together, and owns every
 * listener we put on the host page.
 *
 * Three rules govern everything in this file:
 *   - Every listener is `passive`. We never call `preventDefault` or
 *     `stopPropagation`, so no key the site depends on — Enter above all —
 *     can be swallowed by us.
 *   - Nothing measures outside the layout batcher's read phase.
 *   - If the composer cannot be resolved, we disable ourselves silently. A
 *     broken widget is worse than no widget.
 */

/** How long after the last keystroke we stop treating the user as typing. */
const TYPING_IDLE_MS = 400;

export interface ForgeControllerOptions {
  adapter: SiteAdapter;
  widget: WidgetHandle;
}

export class ForgeController {
  readonly #adapter: SiteAdapter;
  readonly #widget: WidgetHandle;
  readonly #anchor: AnchorEngine;

  #typingTimer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #missReported = false;

  constructor({ adapter, widget }: ForgeControllerOptions) {
    this.#adapter = adapter;
    this.#widget = widget;

    this.#anchor = new AnchorEngine({
      host: widget.host,
      size: { width: HALO_SIZE, height: HALO_SIZE },
      spec: adapter.anchor,
      resolveTarget: () => adapter.getComposer(),
      onPlacement: (placement) => widgetStore.getState().setPlaced(placement.visible),
    });
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    // `focusin` bubbles where `focus` does not, so one document-level listener
    // covers every composer without touching the composer itself.
    document.addEventListener('focusin', this.#onFocusIn, { passive: true, capture: true });
    document.addEventListener('focusout', this.#onFocusOut, { passive: true, capture: true });
    document.addEventListener('input', this.#onInput, { passive: true, capture: true });

    this.#anchor.attach();
    this.#refreshTheme();
    this.#syncActive();

    if (!this.#adapter.getComposer()) {
      // Not necessarily a miss yet — these apps mount the composer after first
      // paint. The anchor engine's interval will keep retrying, and
      // `#reportMissIfStillAbsent` decides once the page has settled.
      setTimeout(() => this.#reportMissIfStillAbsent(), 5000);
    }
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    document.removeEventListener('focusin', this.#onFocusIn, { capture: true });
    document.removeEventListener('focusout', this.#onFocusOut, { capture: true });
    document.removeEventListener('input', this.#onInput, { capture: true });

    if (this.#typingTimer) clearTimeout(this.#typingTimer);
    this.#anchor.detach();
    this.#widget.destroy();
  }

  /** Exposed for the Cmd/Ctrl+Shift+K command and for dev tooling. */
  get anchor(): AnchorEngine {
    return this.#anchor;
  }

  // ------------------------------------------------------------- listeners

  #onFocusIn = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // Re-resolve on focus: these apps swap the composer node on navigation
    // without a page load, so a cached element goes stale silently.
    if (isEditable(target)) this.#anchor.retarget();
    this.#syncActive();
    this.#refreshTheme();
  };

  #onFocusOut = (): void => {
    // Focus moves through `document.body` between two elements, so read the
    // new state after the browser has settled rather than on this tick.
    setTimeout(() => this.#syncActive(), 0);
  };

  #onInput = (event: Event): void => {
    const composer = this.#anchor.target;
    if (!composer || !(event.target instanceof Node)) return;
    if (event.target !== composer && !composer.contains(event.target)) return;

    const state = widgetStore.getState();
    state.setTyping(true);
    state.setActive(true);

    if (this.#typingTimer) clearTimeout(this.#typingTimer);
    this.#typingTimer = setTimeout(() => {
      widgetStore.getState().setTyping(false);
      // M3 hooks local analysis in here. It stays local: a debounced pause is
      // never a reason to touch the network.
      this.#syncActive();
    }, TYPING_IDLE_MS);
  };

  // --------------------------------------------------------------- helpers

  /** The widget shows only when the composer has focus or holds text. */
  #syncActive(): void {
    const composer = this.#adapter.getComposer();
    if (!composer) {
      widgetStore.getState().setActive(false);
      return;
    }

    const focused = composer === document.activeElement || composer.contains(document.activeElement);
    const hasText = this.#safeReadText(composer).trim().length > 0;
    widgetStore.getState().setActive(focused || hasText);
  }

  /**
   * Theme is sampled from what the page actually paints, which means
   * `getComputedStyle` — so it goes through the batcher's read phase like
   * every other measurement.
   */
  #refreshTheme(): void {
    layoutBatcher.read(() => {
      const theme = detectTheme(this.#adapter.getComposer(), window);
      if (widgetStore.getState().theme === theme) return;
      widgetStore.getState().setTheme(theme);
      layoutBatcher.write(() => this.#widget.setTheme(theme));
    });
  }

  #safeReadText(el: HTMLElement): string {
    try {
      return this.#adapter.readText(el);
    } catch (err) {
      log.error('readText threw', err);
      return '';
    }
  }

  /**
   * Adapter rot is the failure mode that produces one-star reviews, so it is
   * reported explicitly — with the site id and nothing else. No selectors, no
   * markup, and above all no page content.
   */
  #reportMissIfStillAbsent(): void {
    if (!this.#started || this.#missReported) return;
    if (this.#adapter.getComposer()) return;

    this.#missReported = true;
    widgetStore.getState().setDisabled(true);
    telemetry('adapter_miss', { site_id: this.#adapter.id });
    log.warn(`no composer found for "${this.#adapter.id}" — widget disabled on this tab`);
  }
}

function isEditable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT';
}
