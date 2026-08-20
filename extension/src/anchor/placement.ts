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
  /**
   * Whether the widget is currently held clear of the site's own controls.
   * Fed back in on the next frame; see `slideClearOfAvoidZones`.
   */
  slid: boolean;
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
  /** Previous frame's slide state, which makes the decision hysteretic. */
  slid?: boolean;
}

/** Breathing room left between us and one of the site's own buttons. */
const AVOID_GAP_PX = 8;

/**
 * How far clear of a control the widget must get before it stops dodging it.
 *
 * Engaging the slide costs a ~60px sideways move, so the decision cannot be a
 * bare threshold: the widget rests only a few pixels above Claude's send
 * button, and a threshold that close oscillates on layout noise — the widget
 * hops the width of the control row and back while nothing the user did has
 * changed. Requiring clear separation to disengage makes the decision sticky
 * in one direction and turns the oscillation into a single transition.
 */
const AVOID_RELEASE_PX = 12;

/** Keep the widget off the literal edge of the screen. */
const VIEWPORT_MARGIN_PX = 4;

export const HIDDEN_PLACEMENT: Placement = {
  x: 0,
  y: 0,
  corner: 'bottom-right',
  visible: false,
  reason: 'no-target',
  slid: false,
};

export function solvePlacement(input: PlacementInput): Placement {
  const { target, widget, spec, clip, viewport } = input;
  const corner = input.corner ?? spec.corner;

  const wasSlid = input.slid ?? false;

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
    return { x: 0, y: 0, corner, visible: false, reason: 'clipped', slid: wasSlid };
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

  const slide = slideClearOfAvoidZones(x, y, widget, input.avoid ?? [], wasSlid);
  x = slide.x;

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

  return { x, y, corner, visible: true, reason: 'ok', slid: slide.slid };
}

/**
 * Move left until we are clear of the site's own controls.
 *
 * The walk starts from the widget's undisplaced position and steps left past
 * each zone it would collide with, rightmost first, so a corner holding
 * several stacked buttons is cleared in one move rather than landing in the
 * gap between two of them. Starting from the undisplaced position is what
 * keeps the decision from feeding back on itself: a widget that has already
 * moved 60px left no longer overlaps the button it moved to avoid, so testing
 * from where it currently sits would release the slide, re-collide, and
 * oscillate every frame.
 *
 * The two geometries in the collision test are deliberately different:
 *
 *   - the zone is *inflated* to decide whether to dodge, but only once we are
 *     already dodging, so a widget resting near the edge of a control needs
 *     real separation to stop rather than releasing on a pixel of jitter;
 *   - the destination is computed from the *raw* zone, so the resting position
 *     is identical whether we have just engaged or been engaged for a while.
 *
 * Using the inflated zone for both would trade a large oscillation for a small
 * one — the widget would settle 12px further left while holding than when it
 * first moved, and hop between the two.
 */
function slideClearOfAvoidZones(
  x: number,
  y: number,
  widget: { width: number; height: number },
  avoid: readonly Box[],
  wasSlid: boolean,
): { x: number; slid: boolean } {
  const zones = [...avoid].filter((box) => area(box) > 0).sort((a, b) => b.x - a.x);
  if (zones.length === 0) return { x, slid: false };

  const margin = wasSlid ? AVOID_RELEASE_PX : 0;
  let result = x;
  let slid = false;

  for (const zone of zones) {
    const candidate: Box = { x: result, y, width: widget.width, height: widget.height };
    if (overlaps(candidate, inflate(zone, margin))) {
      result = zone.x - widget.width - AVOID_GAP_PX;
      slid = true;
    }
  }

  return { x: result, slid };
}

/** Grow a box by `by` on every side. */
function inflate(box: Box, by: number): Box {
  if (by === 0) return box;
  return { x: box.x - by, y: box.y - by, width: box.width + by * 2, height: box.height + by * 2 };
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
