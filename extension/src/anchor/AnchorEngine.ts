import type { AnchorCorner, AnchorSpec } from '../adapters/types';
import {
  ANCHOR_FALLBACK_INTERVAL_MS,
  OCCLUSION_PROBE_INTERVAL_MS,
  POSITION_EPSILON_PX,
} from '../config/constants';
import { log } from '../util/logger';
import {
  clipRegion,
  containingBlockOffset,
  grandparentOf,
  isOccluded,
  resolveAncestry,
  type Ancestry,
} from './domProbe';
import { boxFromRect, sameBox, samePosition, type Box } from './geometry';
import { LayoutBatcher, layoutBatcher } from './LayoutBatcher';
import {
  centerOf,
  oppositeCorner,
  solvePlacement,
  type Placement,
  HIDDEN_PLACEMENT,
} from './placement';

/**
 * Keeps one element glued to another element it does not own.
 *
 * There is no "this element moved" event in the platform, so this class
 * synthesises one out of six signals that each catch a different subset of
 * movement:
 *
 *   1. ResizeObserver      — the composer grows as the user types
 *   2. IntersectionObserver — it scrolls in and out of view (and hands us a
 *                             free rect in the callback)
 *   3. scroll (passive, capture) on each scrollable ancestor
 *   4. window + visualViewport resize — window drag, devtools, pinch zoom
 *   5. MutationObserver on the grandparent — the site restyles or replaces it
 *   6. a 1s interval — everything the five above cannot see
 *
 * Signal 6 is not a hack to be removed later. Adjacent elements resizing, a
 * stylesheet arriving late, a sibling collapsing — none of those fire anything
 * on the composer, and the interval is what makes alignment *eventually*
 * correct in the long tail.
 *
 * Signal 7 exists because "eventually" turned out not to be good enough. The
 * concrete case: Claude's own side panel opens, which sets a class on `body`
 * and shifts the composer 280px sideways. The composer does not resize, does
 * not scroll, does not change its intersection with the viewport, and the
 * mutation is on `body` — outside the narrowly scoped observer. Signals 1-5
 * are all silent, and the interval leaves the halo visibly displaced for up to
 * a second. So after the geometry settles we re-frame an IntersectionObserver
 * with a `rootMargin` that fits the composer's rect exactly: the ratio is 1
 * while it holds still and drops the instant it moves by a pixel, in any
 * direction, for any reason. That is the difference between a widget that is
 * usually right and one that is always right.
 *
 * Every signal funnels into `scheduleMeasure()`, which sets a dirty flag and
 * asks the shared batcher for a frame. Nothing measures in a handler.
 */

export interface AnchorEngineOptions {
  /** The single div we appended to the page. */
  host: HTMLElement;
  /** Widget size in CSS pixels. */
  size: { width: number; height: number };
  spec: AnchorSpec;
  /** Re-resolves the composer. Called on attach, retarget and interval ticks. */
  resolveTarget: () => HTMLElement | null;
  /** Notified whenever the placement changes meaningfully. */
  onPlacement?: (placement: Placement) => void;
  batcher?: LayoutBatcher;
  win?: Window;
}

export class AnchorEngine {
  readonly #opts: AnchorEngineOptions;
  readonly #win: Window;
  readonly #doc: Document;
  readonly #batcher: LayoutBatcher;

  #target: HTMLElement | null = null;
  #ancestry: Ancestry = { scrollables: [], clippers: [], chain: [] };
  #boundScrollables: HTMLElement[] = [];

  #resizeObserver: ResizeObserver | null = null;
  #intersectionObserver: IntersectionObserver | null = null;
  #positionSentinel: IntersectionObserver | null = null;
  #sentinelRect: Box | null = null;
  #mutationObserver: MutationObserver | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;

  #attached = false;
  #suspended = false;
  #dirty = false;
  /** Set when something structural changed and cached probes must be redone. */
  #structuralDirty = true;

  #lastTargetBox: Box | null = null;
  #lastPlacement: Placement = HIDDEN_PLACEMENT;
  #origin = { x: 0, y: 0 };
  #corner: AnchorCorner;
  #lastOcclusionProbe = 0;
  /** Rect handed to us free by the IntersectionObserver callback. */
  #rectHint: Box | null = null;

  constructor(options: AnchorEngineOptions) {
    this.#opts = options;
    this.#win = options.win ?? window;
    this.#doc = this.#win.document;
    this.#batcher = options.batcher ?? layoutBatcher;
    this.#corner = options.spec.corner;
  }

  get placement(): Placement {
    return this.#lastPlacement;
  }

  get target(): HTMLElement | null {
    return this.#target;
  }

  /** The composer rect the current placement was computed from. Diagnostics. */
  get lastTargetBox(): Box | null {
    return this.#lastTargetBox;
  }

  attach(): void {
    if (this.#attached) return;
    this.#attached = true;

    this.#doc.addEventListener('visibilitychange', this.#onVisibilityChange);
    this.#win.addEventListener('resize', this.#onCoarseSignal, { passive: true });
    this.#win.visualViewport?.addEventListener('resize', this.#onCoarseSignal, { passive: true });
    // Pinch-zoom moves the visual viewport without moving the layout viewport,
    // so it produces no window scroll and no resize on anything we observe.
    this.#win.visualViewport?.addEventListener('scroll', this.#onCoarseSignal, { passive: true });
    this.#win.addEventListener('scroll', this.#onCoarseSignal, { passive: true });

    this.retarget();
    this.#startInterval();
  }

  detach(): void {
    if (!this.#attached) return;
    this.#attached = false;

    this.#doc.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#win.removeEventListener('resize', this.#onCoarseSignal);
    this.#win.visualViewport?.removeEventListener('resize', this.#onCoarseSignal);
    this.#win.visualViewport?.removeEventListener('scroll', this.#onCoarseSignal);
    this.#win.removeEventListener('scroll', this.#onCoarseSignal);

    this.#teardownTargetObservers();
    this.#stopInterval();
    this.#target = null;
    this.#lastTargetBox = null;
    this.#lastPlacement = HIDDEN_PLACEMENT;
  }

  /**
   * Re-resolve the composer and rebind every element-scoped signal to it.
   *
   * Called on `focusin`, on childList mutations near the composer, and on the
   * interval tick when the cached element has detached. These apps replace the
   * composer node on navigation without a page load, and a stale reference
   * means a widget anchored to a rect that will never update again.
   */
  retarget(): void {
    const next = this.#safeResolve();
    if (next === this.#target && next?.isConnected) {
      this.#structuralDirty = true;
      this.scheduleMeasure();
      return;
    }

    this.#teardownTargetObservers();
    this.#target = next;
    this.#rectHint = null;
    this.#lastTargetBox = null;
    this.#corner = this.#opts.spec.corner;
    this.#structuralDirty = true;

    if (!next) {
      this.#commitPlacement({ ...HIDDEN_PLACEMENT, reason: 'no-target' });
      return;
    }

    this.#setupTargetObservers(next);
    this.scheduleMeasure();
  }

  /** The single entry point every signal funnels into. */
  scheduleMeasure = (): void => {
    if (!this.#attached || this.#suspended) return;
    if (this.#dirty) return;
    this.#dirty = true;
    this.#batcher.read(this.#measure);
  };

  // ---------------------------------------------------------------- signals

  #setupTargetObservers(target: HTMLElement): void {
    // Cache the ancestor walk up front: the observers below are bound to
    // specific elements, and re-deriving the list per frame would mean a
    // `getComputedStyle` walk sixty times a second.
    this.#ancestry = resolveAncestry(target, this.#win);

    /*
     * 1. ResizeObserver — on the composer *and* on its ancestor chain.
     *
     * The composer alone covers the obvious case, growing line by line as the
     * user types. The ancestors cover the case that actually breaks
     * alignment: a side panel opens, every container between the composer and
     * the body gets narrower, and the composer — still the same width inside a
     * max-width form — slides sideways without resizing, without scrolling,
     * and without touching anything the narrowly scoped MutationObserver
     * watches.
     *
     * Watching ancestors is what makes that case a same-frame correction.
     * ResizeObserver callbacks run inside the browser's rendering steps,
     * before paint; the position sentinel below is an IntersectionObserver,
     * and those are delivered in a later task — a frame late, which is a frame
     * the user sees the widget in the wrong place.
     */
    if (typeof ResizeObserver === 'function') {
      this.#resizeObserver = new ResizeObserver(this.#onSettledSignal);
      this.#resizeObserver.observe(target);
      for (const ancestor of this.#ancestry.chain) {
        this.#resizeObserver.observe(ancestor);
      }
    }

    // 2. IntersectionObserver — scrolling in and out of view. The callback
    //    carries `boundingClientRect`, which is a layout read the browser has
    //    already done for us; taking it as a hint saves a forced measurement.
    if (typeof IntersectionObserver === 'function') {
      this.#intersectionObserver = new IntersectionObserver(this.#onIntersection, {
        threshold: [0, 0.25, 0.5, 0.75, 1],
      });
      this.#intersectionObserver.observe(target);
    }

    // 3. scroll on every scrollable ancestor, walked up from the composer.
    //    Passive so we never delay a scroll, capture because scroll events do
    //    not bubble.
    this.#boundScrollables = [...this.#ancestry.scrollables];
    for (const scroller of this.#boundScrollables) {
      scroller.addEventListener('scroll', this.#onCoarseSignal, { passive: true, capture: true });
    }

    // 5. MutationObserver scoped to the grandparent — never to document. The
    //    site restyling the composer's container, or swapping the composer
    //    out entirely, both surface here.
    const scope = grandparentOf(target);
    if (scope && typeof MutationObserver === 'function') {
      this.#mutationObserver = new MutationObserver(this.#onMutation);
      this.#mutationObserver.observe(scope, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        childList: true,
        subtree: true,
      });
    }
  }

  #teardownTargetObservers(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#intersectionObserver?.disconnect();
    this.#intersectionObserver = null;
    this.#positionSentinel?.disconnect();
    this.#positionSentinel = null;
    this.#sentinelRect = null;
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;

    for (const scroller of this.#boundScrollables) {
      scroller.removeEventListener('scroll', this.#onCoarseSignal, { capture: true });
    }
    this.#boundScrollables = [];
    this.#ancestry = { scrollables: [], clippers: [], chain: [] };
  }

  /** Every signal that carries no useful payload lands here. */
  #onCoarseSignal = (): void => {
    this.scheduleMeasure();
  };

  /**
   * Signals delivered from inside the browser's rendering steps.
   *
   * Scroll and resize events fire *before* animation frames, so scheduling a
   * frame from them corrects the position within the same painted frame.
   * ResizeObserver and IntersectionObserver callbacks fire *after* animation
   * frames — so deferring to the next frame paints one frame with the composer
   * already moved and our transform still stale. On a composer that grows a
   * line as the user types, that is a visible flick of misalignment on every
   * newline.
   *
   * Measuring here instead is both correct and cheap: the browser has just
   * finished layout in order to deliver the callback, so the rect read costs
   * nothing, and the style write still lands before paint.
   */
  #onSettledSignal = (): void => {
    this.scheduleMeasure();
    this.#batcher.flushSync();
  };

  #onIntersection = (entries: IntersectionObserverEntry[]): void => {
    const entry = entries[entries.length - 1];
    if (entry) this.#rectHint = boxFromRect(entry.boundingClientRect);
    this.#onSettledSignal();
  };

  #onMutation = (records: MutationRecord[]): void => {
    // A childList change near the composer may have replaced it. Anything
    // else is a restyle, which only needs a re-measure.
    const structural = records.some((r) => r.type === 'childList');
    this.#structuralDirty = true;
    if (structural && !this.#target?.isConnected) {
      this.retarget();
      return;
    }
    this.scheduleMeasure();
  };

  // 6. The interval fallback. Not optional.
  #startInterval(): void {
    if (this.#interval !== null) return;
    this.#interval = setInterval(this.#onIntervalTick, ANCHOR_FALLBACK_INTERVAL_MS);
  }

  #stopInterval(): void {
    if (this.#interval === null) return;
    clearInterval(this.#interval);
    this.#interval = null;
  }

  #onIntervalTick = (): void => {
    if (this.#suspended) return;
    // The composer being swapped out is the one failure the observers cannot
    // report, because a disconnected node fires nothing.
    if (this.#target && !this.#target.isConnected) {
      this.retarget();
      return;
    }
    if (!this.#target) {
      this.retarget();
      return;
    }
    this.#structuralDirty = true;
    this.scheduleMeasure();
  };

  /**
   * Frame the composer's current rect with an IntersectionObserver whose
   * `rootMargin` shrinks the viewport down to exactly that rect.
   *
   * While the composer sits still the ratio is 1 and nothing fires. The moment
   * it moves — by any mechanism, including ones nothing else reports — the
   * ratio drops below 1 and we get a callback in the same frame. It is the
   * only way to observe "this element moved" without polling.
   */
  #armPositionSentinel(target: HTMLElement, rect: Box): void {
    if (typeof IntersectionObserver !== 'function') return;
    if (rect.width <= 0 || rect.height <= 0) return;
    // Already framed for this rect: re-arming would be pure churn.
    if (sameBox(this.#sentinelRect, rect, 1)) return;

    this.#positionSentinel?.disconnect();
    this.#sentinelRect = rect;

    const vw = this.#win.innerWidth;
    const vh = this.#win.innerHeight;
    // Floor rather than round, so the frame is never *tighter* than the
    // element — a sub-pixel-tight frame reports a ratio below 1 immediately
    // and re-triggers forever.
    const top = Math.floor(rect.y);
    const left = Math.floor(rect.x);
    const right = Math.floor(vw - (rect.x + rect.width));
    const bottom = Math.floor(vh - (rect.y + rect.height));

    try {
      this.#positionSentinel = new IntersectionObserver(
        (entries) => {
          const ratio = entries[entries.length - 1]?.intersectionRatio ?? 1;
          if (ratio < 1) this.#onSettledSignal();
        },
        { rootMargin: `${-top}px ${-right}px ${-bottom}px ${-left}px`, threshold: 1 },
      );
      this.#positionSentinel.observe(target);
    } catch {
      // A rect far outside the viewport can produce a rootMargin the browser
      // rejects. The other six signals still cover that case.
      this.#positionSentinel = null;
      this.#sentinelRect = null;
    }
  }

  /** Idle throttle: a hidden tab costs us nothing. */
  #onVisibilityChange = (): void => {
    if (this.#doc.visibilityState === 'hidden') this.suspend();
    else this.resume();
  };

  suspend(): void {
    if (this.#suspended) return;
    this.#suspended = true;
    this.#teardownTargetObservers();
    this.#stopInterval();
    log.debug('anchor suspended');
  }

  resume(): void {
    if (!this.#suspended) return;
    this.#suspended = false;
    this.#startInterval();
    // Anything could have moved while we were not watching; re-resolve rather
    // than trusting the cached element or rect.
    this.retarget();
    log.debug('anchor resumed');
  }

  // ------------------------------------------------------------ read phase

  #measure = (): void => {
    this.#dirty = false;
    if (!this.#attached || this.#suspended) return;

    const target = this.#target;
    if (!target || !target.isConnected) {
      this.#commitPlacement({ ...HIDDEN_PLACEMENT, reason: 'no-target' });
      return;
    }

    if (this.#structuralDirty) {
      this.#origin = containingBlockOffset(this.#win);
      this.#ancestry = resolveAncestry(target, this.#win);
      this.#structuralDirty = false;
    }

    // The one unavoidable measurement. Everything downstream reads from this.
    const targetBox = boxFromRect(target.getBoundingClientRect());
    this.#rectHint = null;

    const viewport: Box = {
      x: 0,
      y: 0,
      width: this.#win.visualViewport?.width ?? this.#win.innerWidth,
      height: this.#win.visualViewport?.height ?? this.#win.innerHeight,
    };

    const clip = clipRegion(this.#ancestry.clippers, viewport);
    const avoid = this.#measureAvoidZones(target);

    let placement = solvePlacement({
      target: targetBox,
      widget: this.#opts.size,
      spec: this.#opts.spec,
      corner: this.#corner,
      avoid,
      clip,
      viewport,
      // Feeding the previous frame's slide state back is what makes dodging
      // the site's controls hysteretic rather than a bare threshold the widget
      // can chatter across.
      slid: this.#lastPlacement.slid,
    });

    placement = this.#applyOcclusion(placement, target, {
      targetBox,
      avoid,
      clip,
      viewport,
    });

    const geometryUnchanged = sameBox(this.#lastTargetBox, targetBox, POSITION_EPSILON_PX);
    this.#lastTargetBox = targetBox;

    if (geometryUnchanged) {
      // Motion has stopped: frame the tripwire around where the composer came
      // to rest.
      this.#armPositionSentinel(target, targetBox);
    } else {
      /*
       * Still moving. Queue one more measurement for the next frame rather
       * than re-framing the sentinel now — re-arming mid-motion would
       * allocate an observer per frame to detect movement we are already
       * tracking, and leaving it un-armed would strand us with no tripwire
       * once the movement ends. This settles after exactly one idle frame.
       */
      this.scheduleMeasure();
    }

    // Bail without touching style when nothing moved. On a page that fires
    // hundreds of scroll events a second this is the difference between one
    // composite per frame and none.
    if (
      geometryUnchanged &&
      placement.visible === this.#lastPlacement.visible &&
      placement.corner === this.#lastPlacement.corner &&
      placement.slid === this.#lastPlacement.slid &&
      samePosition(this.#lastPlacement, placement, POSITION_EPSILON_PX)
    ) {
      return;
    }

    this.#commitPlacement(placement);
  };

  /**
   * The site's own buttons, measured fresh each frame. Their rects move with
   * the composer, and on Claude the send button appears and disappears as the
   * draft empties, so a cached rect goes wrong within a keystroke.
   */
  #measureAvoidZones(target: HTMLElement): Box[] {
    const selectors = this.#opts.spec.avoidSelectors;
    if (selectors.length === 0) return [];

    // Scope the query to the composer's surroundings rather than the whole
    // document: a "Send message" button in some unrelated panel is not
    // something we need to dodge.
    const scope = target.closest('form, fieldset') ?? grandparentOf(target) ?? this.#doc.body;
    const zones: Box[] = [];

    for (const selector of selectors) {
      let matches: NodeListOf<Element>;
      try {
        matches = scope.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of matches) {
        if (!(el instanceof HTMLElement) || !el.isConnected) continue;
        zones.push(boxFromRect(el.getBoundingClientRect()));
      }
    }
    return zones;
  }

  /**
   * If a sticky or fixed element covers the anchor point, try the opposite
   * corner once; hide only if that is covered too. Throttled — a hit-test is
   * the most expensive read we do, and occluders do not appear mid-scroll.
   */
  #applyOcclusion(
    placement: Placement,
    target: HTMLElement,
    ctx: { targetBox: Box; avoid: Box[]; clip: Box; viewport: Box },
  ): Placement {
    if (!placement.visible) return placement;

    const now = Date.now();
    if (now - this.#lastOcclusionProbe < OCCLUSION_PROBE_INTERVAL_MS) return placement;
    this.#lastOcclusionProbe = now;

    const occludedHere = isOccluded({
      point: centerOf(placement, this.#opts.size),
      target,
      host: this.#opts.host,
      doc: this.#doc,
      win: this.#win,
    });
    if (!occludedHere) {
      this.#corner = placement.corner;
      return placement;
    }

    const flipped = solvePlacement({
      target: ctx.targetBox,
      widget: this.#opts.size,
      spec: this.#opts.spec,
      corner: oppositeCorner(placement.corner),
      avoid: ctx.avoid,
      clip: ctx.clip,
      viewport: ctx.viewport,
      slid: placement.slid,
    });

    if (
      flipped.visible &&
      !isOccluded({
        point: centerOf(flipped, this.#opts.size),
        target,
        host: this.#opts.host,
        doc: this.#doc,
        win: this.#win,
      })
    ) {
      this.#corner = flipped.corner;
      return flipped;
    }

    return { ...placement, visible: false, reason: 'occluded' };
  }

  // ----------------------------------------------------------- write phase

  #commitPlacement(placement: Placement): void {
    this.#lastPlacement = placement;
    this.#batcher.write(() => this.#write(placement));
  }

  /**
   * `transform` only — never `top`/`left`. A transform change is handled on
   * the compositor without laying the page out again; a `top` change is a
   * layout invalidation on somebody else's page every single frame of a
   * scroll.
   */
  #write(placement: Placement): void {
    const style = this.#opts.host.style;
    const x = placement.x - this.#origin.x;
    const y = placement.y - this.#origin.y;

    // `!important` matches how the rest of the host's styles are written: it
    // is the one author priority a host-page stylesheet cannot override.
    style.setProperty('transform', `translate3d(${round(x)}px, ${round(y)}px, 0)`, 'important');
    style.setProperty('visibility', placement.visible ? 'visible' : 'hidden', 'important');
    this.#opts.onPlacement?.(placement);
  }

  #safeResolve(): HTMLElement | null {
    try {
      return this.#opts.resolveTarget();
    } catch (err) {
      log.error('composer resolution threw', err);
      return null;
    }
  }
}

/** Sub-pixel precision the compositor can use, without 15 digits of noise. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
