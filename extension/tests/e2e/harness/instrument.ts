/**
 * Instrumentation for the anchoring e2e tests.
 *
 * Two constraints in the spec are about *how* the code runs, not what it
 * produces, and neither is observable from the outside:
 *
 *   - no `getBoundingClientRect` or `getComputedStyle` in a scroll or
 *     mousemove handler; all layout reads batched into one rAF
 *   - position via `transform` only, never `top`/`left`
 *
 * Asserting on Chrome's "forced reflow" console warning would be testing a
 * heuristic. Counting layout reads taken outside the shared batcher's flush
 * tests the actual rule, and fails loudly the moment somebody adds a
 * convenience `getBoundingClientRect()` to a scroll handler.
 *
 * "Inside a batched flush" rather than "inside a rAF callback": the engine
 * also flushes synchronously from ResizeObserver callbacks, which the browser
 * runs after animation frames but before paint, with layout already clean. A
 * read there is free and lands in the right frame — while a read in a scroll
 * handler forces a reflow no matter which frame it is nominally part of. The
 * batcher is what distinguishes the two.
 */

export interface InstrumentReport {
  /** Layout reads taken outside a batched flush. Must be zero. */
  outOfFrameRectReads: number;
  outOfFrameStyleReads: number;
  /** Batched reads — informational, used to prove the test actually ran. */
  inFrameRectReads: number;
  /** True if anything ever wrote a non-zero `top` or `left` on the host. */
  usedTopLeft: boolean;
}

/** Set while the harness's own sampler measures, so it excludes itself. */
let inSampler = false;

const report: InstrumentReport = {
  outOfFrameRectReads: 0,
  outOfFrameStyleReads: 0,
  inFrameRectReads: 0,
  usedTopLeft: false,
};

/** Supplied by the harness; true while the shared LayoutBatcher is running. */
let isBatched: () => boolean = () => false;

export function installInstrumentation(win: Window, batched: () => boolean): void {
  isBatched = batched;

  const ElementCtor = (win as Window & typeof globalThis).Element;
  const rawRect = ElementCtor.prototype.getBoundingClientRect;
  ElementCtor.prototype.getBoundingClientRect = function patched(this: Element) {
    if (!inSampler) {
      if (isBatched()) report.inFrameRectReads += 1;
      else report.outOfFrameRectReads += 1;
    }
    return rawRect.call(this);
  };

  const rawStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    if (!inSampler && !isBatched()) report.outOfFrameStyleReads += 1;
    return rawStyle(el, pseudo ?? undefined);
  }) as typeof win.getComputedStyle;
}

export function noteTopLeft(host: HTMLElement): void {
  const top = host.style.top;
  const left = host.style.left;
  if ((top && top !== '0px' && top !== '0') || (left && left !== '0px' && left !== '0')) {
    report.usedTopLeft = true;
  }
}

export function withSampler<T>(fn: () => T): T {
  inSampler = true;
  try {
    return fn();
  } finally {
    inSampler = false;
  }
}

export function resetInstrumentation(): void {
  report.outOfFrameRectReads = 0;
  report.outOfFrameStyleReads = 0;
  report.inFrameRectReads = 0;
  report.usedTopLeft = false;
}

export function getInstrumentReport(): InstrumentReport {
  return { ...report };
}
