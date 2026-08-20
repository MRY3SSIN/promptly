import type { AnchorCorner, AnchorSpec } from '../adapters/types';
import { MIN_TARGET_VISIBLE_PX } from '../config/constants';
import { area, clamp, intersect, overlaps, type Box } from './geometry';

/**
 * Turning a composer rect into a widget position. Pure — the engine does the
 * measuring, this decides where the result goes, and the tests exercise every
 * branch without touching a DOM.
 */

export type PlacementReason =
  | 'ok'
  | 'no-target'
  | 'target-empty'
  | 'clipped'
  | 'occluded'
  | 'suspended';

export interface Placement {
  x: number;
  y: number;
  corner: AnchorCorner;
  visible: boolean;
  reason: PlacementReason;
}

export interface PlacementInput {
  /** The composer's viewport rect. */
  target: Box;
  widget: { width: number; height: number };
  spec: AnchorSpec;
  /** Overridden corner, when the engine has flipped us away from an occluder. */
  corner?: AnchorCorner;
  /** Viewport rects of the site's own controls we must not cover. */
  avoid?: readonly Box[];
  /** Composer's clipping ancestors, already intersected with the viewport. */
  clip: Box;
  viewport: Box;
}

/** Breathing room left between us and one of the site's own buttons. */
const AVOID_GAP_PX = 8;

/** Keep the widget off the literal edge of the screen. */
const VIEWPORT_MARGIN_PX = 4;

export const HIDDEN_PLACEMENT: Placement = {
  x: 0,
  y: 0,
  corner: 'bottom-right',
  visible: false,
  reason: 'no-target',
};

export function solvePlacement(input: PlacementInput): Placement {
  const { target, widget, spec, clip, viewport } = input;
  const corner = input.corner ?? spec.corner;

  if (area(target) === 0) {
    return { ...HIDDEN_PLACEMENT, corner, reason: 'target-empty' };
  }

  /*
   * Anchor to the part of the composer that is actually on screen, not to its
   * full box. Two cases make this the right reference:
   *
   *   - A long prompt makes the composer taller than the max-height wrapper it
   *     scrolls inside, so its real bottom edge is somewhere below the visible
   *     window. Anchoring there would put the halo off the bottom of a
   *     perfectly visible text box.
   *   - A composer scrolled away inside a container has no visible slice at
   *     all, which is exactly when we should disappear.
   *
   * Clamping the target first handles both with the same line.
   */
  const visible = intersect(target, clip);
  if (visible.height < MIN_TARGET_VISIBLE_PX || visible.width < MIN_TARGET_VISIBLE_PX) {
    return { x: 0, y: 0, corner, visible: false, reason: 'clipped' };
  }

  let x = visible.x + visible.width - widget.width + spec.offset.x;
  let y =
    corner === 'bottom-right'
      ? visible.y + visible.height - widget.height + spec.offset.y
      : visible.y + spec.offset.y;

  /*
   * The vertical position is deliberately *not* clamped into the composer.
   *
   * Clamping introduces a regime change: while the composer is shorter than
   * the widget the clamp binds and the widget sits flush with the composer's
   * top; once a second line appears the clamp releases and the widget drops to
   * its inset position. The relationship to the anchor corner changes by the
   * difference, which the user sees as the widget hopping the first time they
   * press Enter. An unclamped corner offset holds the same relationship at
   * every composer height, and the adapter's negative offset already keeps the
   * widget clear of the control row below.
   *
   * Horizontally the clamp is safe — composers are always far wider than the
   * widget, so there is no boundary to straddle — and it protects against a
   * pathologically narrow one.
   */
  x = clamp(x, visible.x, visible.x + Math.max(visible.width, widget.width) - widget.width);
  x = slideClearOfAvoidZones(x, y, widget, input.avoid ?? []);

  /*
   * Final nudge: never let a rounding error or an extreme offset push us off
   * the edge of the screen.
   *
   * Against the viewport, and only the viewport. Clamping into the clip region
   * as well would be wrong twice over: the widget lives in its own stacking
   * context and is not actually clipped by the composer's ancestors, and on a
   * single-line composer the clip box is shorter than the widget, so the clamp
   * would bind — silently overriding the anchor offset until a second line
   * appears and then releasing it again. Whether the composer is visible at
   * all is already settled above.
   */
  x = clamp(x, viewport.x + VIEWPORT_MARGIN_PX, viewport.x + viewport.width - widget.width - VIEWPORT_MARGIN_PX);
  y = clamp(y, viewport.y + VIEWPORT_MARGIN_PX, viewport.y + viewport.height - widget.height - VIEWPORT_MARGIN_PX);

  return { x, y, corner, visible: true, reason: 'ok' };
}

/**
 * Move left until we are clear of the site's own controls.
 *
 * Rightmost-first, so on a composer whose corner holds several stacked buttons
 * we step past all of them rather than hopping into the gap between two. The
 * loop is bounded by the number of avoid zones, so a pathological layout costs
 * a few extra comparisons, not a hang.
 */
function slideClearOfAvoidZones(
  x: number,
  y: number,
  widget: { width: number; height: number },
  avoid: readonly Box[],
): number {
  if (avoid.length === 0) return x;

  const sorted = [...avoid].filter((box) => area(box) > 0).sort((a, b) => b.x - a.x);
  let result = x;

  for (const zone of sorted) {
    const candidate: Box = { x: result, y, width: widget.width, height: widget.height };
    if (overlaps(candidate, zone)) {
      result = zone.x - widget.width - AVOID_GAP_PX;
    }
  }

  return result;
}

/** The point we hit-test for occlusion: the middle of the widget. */
export function centerOf(placement: Placement, widget: { width: number; height: number }) {
  return {
    x: placement.x + widget.width / 2,
    y: placement.y + widget.height / 2,
  };
}

/** Flipping to the other corner is our first response to being covered. */
export function oppositeCorner(corner: AnchorCorner): AnchorCorner {
  return corner === 'bottom-right' ? 'top-right' : 'bottom-right';
}
