/**
 * Which theme is the host page actually showing?
 *
 * `prefers-color-scheme` is the wrong answer on its own: ChatGPT, Claude and
 * Gemini all ship their own theme switch, and a user on a light OS running
 * Claude in dark mode is the common case rather than an edge case. So we
 * sample what is actually painted behind the composer and fall back to the
 * media query only when sampling tells us nothing.
 *
 * Every function here calls `getComputedStyle`, so callers must invoke them
 * from inside the layout batcher's read phase — never from an event handler.
 */

export type Theme = 'light' | 'dark';

/** Below this relative luminance, we treat the surface as dark. */
const DARK_THRESHOLD = 0.42;

/** How far up the tree to look for a surface that is not transparent. */
const SAMPLE_DEPTH = 12;

export function detectTheme(composer: HTMLElement | null, win: Window = window): Theme {
  const sampled = composer ? sampleSurfaceLuminance(composer, win) : null;
  if (sampled !== null) return sampled < DARK_THRESHOLD ? 'dark' : 'light';
  return win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Walk up from the composer until we hit an element with a non-transparent
 * background, and return its relative luminance. Most composers are themselves
 * transparent over a themed container, so the first hit is usually two or
 * three levels up.
 */
export function sampleSurfaceLuminance(el: HTMLElement, win: Window = window): number | null {
  let node: HTMLElement | null = el;
  let depth = 0;

  while (node && depth < SAMPLE_DEPTH) {
    const parsed = parseColor(win.getComputedStyle(node).backgroundColor);
    if (parsed && parsed.a > 0.5) return relativeLuminance(parsed);
    node = node.parentElement;
    depth += 1;
  }
  return null;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse what `getComputedStyle` actually returns. Chromium normalises to
 * `rgb()`/`rgba()` for most inputs but emits `color(srgb ...)` when the author
 * used a wide-gamut syntax, which Claude's palette does.
 */
export function parseColor(value: string): Rgba | null {
  if (!value) return null;

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/i.exec(value);
  if (rgb) {
    return {
      r: Number(rgb[1]) / 255,
      g: Number(rgb[2]) / 255,
      b: Number(rgb[3]) / 255,
      a: parseAlpha(rgb[4]),
    };
  }

  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/i.exec(value);
  if (srgb) {
    return {
      r: Number(srgb[1]),
      g: Number(srgb[2]),
      b: Number(srgb[3]),
      a: parseAlpha(srgb[4]),
    };
  }

  return null;
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (raw.endsWith('%')) return Number(raw.slice(0, -1)) / 100;
  return Number(raw);
}

/** WCAG relative luminance, on 0..1 channel values. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

function linearise(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
