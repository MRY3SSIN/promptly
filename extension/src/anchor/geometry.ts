/**
 * Pure rectangle maths. No DOM access, so every branch here is unit-testable
 * without a browser.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const EMPTY_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };

export function boxFromRect(rect: DOMRectReadOnly): Box {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

export function right(box: Box): number {
  return box.x + box.width;
}

export function bottom(box: Box): number {
  return box.y + box.height;
}

export function area(box: Box): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/** The overlapping region, or a zero-area box if they do not touch. */
export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(right(a), right(b)) - x;
  const h = Math.min(bottom(a), bottom(b)) - y;
  if (w <= 0 || h <= 0) return { x, y, width: 0, height: 0 };
  return { x, y, width: w, height: h };
}

export function overlaps(a: Box, b: Box): boolean {
  return area(intersect(a, b)) > 0;
}

/** How much of `box` survives being clipped by `clip`, from 0 to 1. */
export function visibleRatio(box: Box, clip: Box): number {
  const total = area(box);
  if (total === 0) return 0;
  return area(intersect(box, clip)) / total;
}

export function clamp(value: number, min: number, max: number): number {
  // A clip region narrower than the widget makes min > max; preferring `min`
  // keeps the widget pinned to the leading edge instead of flipping sides.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Position comparison with a tolerance. Sub-pixel churn is constant on these
 * sites — a rect will report 823.9998 one frame and 824.0001 the next — and
 * writing a transform for that is a wasted composite every frame.
 */
export function samePosition(
  a: { x: number; y: number } | null,
  b: { x: number; y: number },
  epsilon: number,
): boolean {
  if (!a) return false;
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

export function sameBox(a: Box | null, b: Box, epsilon: number): boolean {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
