import { boxFromRect, type Box } from './geometry';

/**
 * DOM reads that are expensive enough to be worth doing once and caching.
 *
 * Everything in here calls `getComputedStyle` or hit-tests, so nothing in here
 * may be called from an event handler. The AnchorEngine calls these only from
 * inside its rAF read phase, and caches the structural results across frames.
 */

const CLIPPING_OVERFLOW = new Set(['hidden', 'auto', 'scroll', 'clip', 'overlay']);

/** Positioned ancestors we walk before giving up on an occlusion question. */
const OCCLUSION_WALK_LIMIT = 8;

export interface Ancestry {
  /** Ancestors that scroll, so we know which scroll events concern us. */
  scrollables: HTMLElement[];
  /** Ancestors that clip, so we know when the composer has scrolled away. */
  clippers: HTMLElement[];
  /**
   * The whole parent chain up to and including `body`.
   *
   * Observed for resize, because an ancestor changing size is the usual way a
   * composer moves without moving itself: a side panel opens and every element
   * between the composer and the body gets narrower, while the composer keeps
   * its own width and never fires a thing.
   */
  chain: HTMLElement[];
}

/**
 * Walk up from the composer collecting the ancestors that can move it or hide
 * it. Recomputed whenever the composer is re-resolved, never per frame.
 */
export function resolveAncestry(el: HTMLElement, win: Window = window): Ancestry {
  const scrollables: HTMLElement[] = [];
  const clippers: HTMLElement[] = [];
  const chain: HTMLElement[] = [];

  let node: HTMLElement | null = el.parentElement;
  while (node && node !== win.document.documentElement) {
    chain.push(node);
    if (node === win.document.body) break;

    const style = win.getComputedStyle(node);
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;

    if (CLIPPING_OVERFLOW.has(overflowX) || CLIPPING_OVERFLOW.has(overflowY)) {
      clippers.push(node);
      // Anything that clips can also scroll its content under the clip, and
      // `auto` reports as clipping even when it is not currently scrollable.
      // Treating the two sets as near-identical costs one idle listener and
      // saves us missing a scroller that only becomes scrollable later.
      scrollables.push(node);
    }

    node = node.parentElement;
  }

  return { scrollables, clippers, chain };
}

/**
 * The composer's grandparent, which is what the MutationObserver watches.
 * Falls back up the chain when the composer is mounted shallow.
 */
export function grandparentOf(el: HTMLElement): HTMLElement | null {
  return el.parentElement?.parentElement ?? el.parentElement ?? null;
}

/**
 * The region the composer is actually visible within: every clipping
 * ancestor's box intersected with the viewport.
 *
 * Pure rect reads — the clipper list itself is cached by the caller.
 */
export function clipRegion(clippers: readonly HTMLElement[], viewport: Box): Box {
  let region = viewport;
  for (const clipper of clippers) {
    const rect = clipper.getBoundingClientRect();
    const x = Math.max(region.x, rect.left);
    const y = Math.max(region.y, rect.top);
    const w = Math.min(region.x + region.width, rect.right) - x;
    const h = Math.min(region.y + region.height, rect.bottom) - y;
    if (w <= 0 || h <= 0) return { x, y, width: 0, height: 0 };
    region = { x, y, width: w, height: h };
  }
  return region;
}

/**
 * `position: fixed` resolves against the viewport only while no ancestor has
 * turned itself into a containing block. Our host is a direct child of
 * `body`, so `body` and `html` are the only two elements that can do this to
 * us — but when one of them does (a page-level scale animation, a
 * `filter: blur` on a modal backdrop) every coordinate we write is offset by
 * the body's own position, and the widget lands visibly wrong.
 */
export function containingBlockOffset(win: Window = window): { x: number; y: number } {
  const doc = win.document;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const style = win.getComputedStyle(el);
    if (createsContainingBlockForFixed(style)) {
      const rect = el.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
  }
  return { x: 0, y: 0 };
}

function createsContainingBlockForFixed(style: CSSStyleDeclaration): boolean {
  if (style.transform && style.transform !== 'none') return true;
  if (style.perspective && style.perspective !== 'none') return true;
  if (style.filter && style.filter !== 'none') return true;
  const backdrop = style.backdropFilter ?? (style as unknown as Record<string, string>).webkitBackdropFilter;
  if (backdrop && backdrop !== 'none') return true;
  if (style.contain && /\b(paint|layout|strict|content)\b/.test(style.contain)) return true;
  if (style.willChange && /\b(transform|perspective|filter)\b/.test(style.willChange)) return true;
  return false;
}

export interface OcclusionQuery {
  /** Point to hit-test, in viewport coordinates. */
  point: { x: number; y: number };
  /** The composer. Hitting it, its subtree, or its ancestors is expected. */
  target: HTMLElement;
  /** Our own host element, filtered out of the hit stack. */
  host: HTMLElement;
  doc?: Document;
  win?: Window;
}

/**
 * Is something the user cares about sitting on top of where we want to draw?
 *
 * A hit-test, not a z-index calculation: reimplementing stacking contexts is a
 * losing game, and the browser already knows the answer. We only care about
 * `fixed`/`sticky` occluders because those are the ones that stay put while
 * the composer scrolls — a normally-positioned overlap resolves itself.
 */
export function isOccluded(query: OcclusionQuery): boolean {
  const doc = query.doc ?? query.host.ownerDocument;
  const win = query.win ?? doc.defaultView ?? window;
  if (typeof doc.elementsFromPoint !== 'function') return false;

  const { x, y } = query.point;
  if (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) return false;

  const stack = doc.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    // Our own UI never counts as occluding itself. `elementsFromPoint` does
    // not pierce shadow roots, so the host is the only entry we can see.
    if (el === query.host || query.host.contains(el)) continue;

    // Over the composer, or over one of its ancestors: that is where we asked
    // to be drawn, and it is behind us in paint order anyway.
    if (el === query.target || el.contains(query.target) || query.target.contains(el)) {
      return false;
    }

    return hasFixedOrStickyAncestor(el, win);
  }
  return false;
}

function hasFixedOrStickyAncestor(el: HTMLElement, win: Window): boolean {
  let node: HTMLElement | null = el;
  let depth = 0;
  while (node && depth < OCCLUSION_WALK_LIMIT) {
    const position = win.getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
    node = node.parentElement;
    depth += 1;
  }
  return false;
}
