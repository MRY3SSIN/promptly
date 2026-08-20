import { describe, expect, it } from 'vitest';
import {
  area,
  boxFromRect,
  clamp,
  intersect,
  overlaps,
  sameBox,
  samePosition,
  visibleRatio,
  type Box,
} from '../../src/anchor/geometry';

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

describe('intersect', () => {
  it('returns the overlapping region', () => {
    expect(intersect(box(0, 0, 100, 100), box(50, 50, 100, 100))).toEqual(box(50, 50, 50, 50));
  });

  it('reports zero area for boxes that only touch at an edge', () => {
    expect(area(intersect(box(0, 0, 10, 10), box(10, 0, 10, 10)))).toBe(0);
  });

  it('reports zero area for disjoint boxes', () => {
    expect(area(intersect(box(0, 0, 10, 10), box(200, 200, 10, 10)))).toBe(0);
  });

  it('is commutative', () => {
    const a = box(10, 20, 55, 40);
    const b = box(30, 5, 90, 90);
    expect(intersect(a, b)).toEqual(intersect(b, a));
  });
});

describe('overlaps', () => {
  it('is false for edge-adjacent boxes, so a widget flush against a button does not slide', () => {
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
  });

  it('is true for a one-pixel overlap', () => {
    expect(overlaps(box(0, 0, 10, 10), box(9, 0, 10, 10))).toBe(true);
  });
});

describe('visibleRatio', () => {
  it('is 1 when fully contained', () => {
    expect(visibleRatio(box(10, 10, 10, 10), box(0, 0, 100, 100))).toBe(1);
  });

  it('is 0.5 when half clipped', () => {
    expect(visibleRatio(box(0, 0, 10, 10), box(5, 0, 100, 100))).toBe(0.5);
  });

  it('is 0 for a zero-area box rather than NaN', () => {
    expect(visibleRatio(box(0, 0, 0, 0), box(0, 0, 100, 100))).toBe(0);
  });
});

describe('clamp', () => {
  it('bounds a value into range', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('prefers the minimum when the range is inverted', () => {
    // Happens when the available space is narrower than the widget. Pinning to
    // the leading edge is stable; the alternative flips the widget between
    // sides as the space crosses the threshold.
    expect(clamp(50, 100, 0)).toBe(100);
  });
});

describe('samePosition / sameBox', () => {
  it('treats sub-epsilon jitter as unchanged', () => {
    expect(samePosition({ x: 100, y: 100 }, { x: 100.4, y: 99.7 }, 0.5)).toBe(true);
  });

  it('treats a half-pixel move as a change', () => {
    expect(samePosition({ x: 100, y: 100 }, { x: 100.5, y: 100 }, 0.5)).toBe(false);
  });

  it('treats a null previous value as changed, so the first frame always commits', () => {
    expect(samePosition(null, { x: 0, y: 0 }, 0.5)).toBe(false);
    expect(sameBox(null, box(0, 0, 0, 0), 0.5)).toBe(false);
  });

  it('notices a size change at a fixed position', () => {
    expect(sameBox(box(0, 0, 100, 20), box(0, 0, 100, 44), 0.5)).toBe(false);
  });
});

describe('boxFromRect', () => {
  it('reads left/top rather than x/y, which older rect shims omit', () => {
    const rect = { left: 5, top: 7, width: 20, height: 30 } as DOMRectReadOnly;
    expect(boxFromRect(rect)).toEqual(box(5, 7, 20, 30));
  });
});
