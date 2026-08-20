import { describe, expect, it } from 'vitest';
import { parseColor, relativeLuminance } from '../../src/ui/theme';

describe('parseColor', () => {
  it('parses the rgb() form Chromium normalises most colours to', () => {
    expect(parseColor('rgb(22, 24, 26)')).toEqual({ r: 22 / 255, g: 24 / 255, b: 26 / 255, a: 1 });
  });

  it('parses rgba() with a fractional alpha', () => {
    expect(parseColor('rgba(0, 0, 0, 0.5)')?.a).toBe(0.5);
  });

  it('parses the slash-separated form', () => {
    expect(parseColor('rgb(255 255 255 / 0.25)')?.a).toBe(0.25);
  });

  it('parses a percentage alpha', () => {
    expect(parseColor('rgb(0 0 0 / 40%)')?.a).toBeCloseTo(0.4);
  });

  /**
   * Not hypothetical: a page authoring its palette in a wide-gamut syntax gets
   * `color(srgb ...)` back from getComputedStyle, and a parser that only knows
   * `rgb()` silently reports "no background" and falls through to the OS
   * theme — which is exactly the wrong answer on a site with its own toggle.
   */
  it('parses the color(srgb ...) form', () => {
    expect(parseColor('color(srgb 0.1 0.2 0.3)')).toEqual({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  });

  it('parses color(srgb ...) with an alpha', () => {
    expect(parseColor('color(srgb 1 1 1 / 0.5)')?.a).toBe(0.5);
  });

  it('returns null for transparent and unparseable values', () => {
    expect(parseColor('rgba(0, 0, 0, 0)')?.a).toBe(0);
    expect(parseColor('transparent')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('oklch(0.5 0.1 200)')).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    expect(relativeLuminance({ r: 1, g: 1, b: 1, a: 1 })).toBeCloseTo(1);
  });

  it('puts the two brand surfaces on opposite sides of the dark threshold', () => {
    const ink = parseColor('rgb(22, 24, 26)')!;
    const paper = parseColor('rgb(251, 250, 248)')!;
    expect(relativeLuminance(ink)).toBeLessThan(0.42);
    expect(relativeLuminance(paper)).toBeGreaterThan(0.42);
  });

  it('weights green above red above blue', () => {
    const red = relativeLuminance({ r: 1, g: 0, b: 0, a: 1 });
    const green = relativeLuminance({ r: 0, g: 1, b: 0, a: 1 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 1, a: 1 });
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});
