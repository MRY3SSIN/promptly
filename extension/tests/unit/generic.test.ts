import { beforeEach, describe, expect, it } from 'vitest';
import { findLikelyComposer, genericAdapter } from '../../src/adapters/generic';
import { resolveAdapter, resolveAdapterWithFallback } from '../../src/adapters/registry';
import { DEFAULT_SETTINGS, isEnabledFor, isGenericAllowedFor } from '../../src/settings/settings';

/**
 * The generic adapter is the one component here that can actively damage
 * something: it guesses which box holds the user's draft, and a wrong guess
 * means replacing content they did not offer up. So the tests are mostly about
 * it *not* running.
 */

/** happy-dom reports zero-size rects, so tests stub the geometry they need. */
function sized(el: HTMLElement, box: { x?: number; y?: number; w: number; h: number }) {
  const rect = {
    x: box.x ?? 0, y: box.y ?? 0, width: box.w, height: box.h,
    left: box.x ?? 0, top: box.y ?? 0,
    right: (box.x ?? 0) + box.w, bottom: (box.y ?? 0) + box.h,
    toJSON: () => ({}),
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
  // `isUsableComposer` checks the element is rendered at all.
  Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
  return el;
}

function field(tag: 'textarea' | 'div', attrs: Record<string, string> = {}) {
  const el = document.createElement(tag);
  if (tag === 'div') {
    el.setAttribute('contenteditable', 'true');
    Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true });
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

describe('generic adapter gating', () => {
  it('never matches a URL, so it cannot be reached by accident', () => {
    // The only route in is `resolveAdapterWithFallback` with an explicit
    // permission. If this ever returns true, the heuristic starts running on
    // sites nobody opted into.
    expect(genericAdapter.matches(new URL('https://example.com/'))).toBe(false);
    expect(resolveAdapter(new URL('https://example.com/'))).toBeNull();
  });

  it('stays out of the way unless the user enabled this exact host', () => {
    const url = new URL('https://notes.example.com/');
    expect(resolveAdapterWithFallback(url, false)).toBeNull();
    expect(resolveAdapterWithFallback(url, true)?.id).toBe('generic');
  });

  it('is opt-in per host rather than globally', () => {
    const settings = { ...DEFAULT_SETTINGS, genericEnabledHosts: ['notes.example.com'] };
    expect(isGenericAllowedFor(settings, new URL('https://notes.example.com/'))).toBe(true);
    expect(isGenericAllowedFor(settings, new URL('https://other.example.com/'))).toBe(false);
  });

  it('defaults to enabled for nothing at all', () => {
    expect(DEFAULT_SETTINGS.genericEnabledHosts).toEqual([]);
  });

  it('never outranks a hand-written adapter', () => {
    // Even with the fallback allowed, a site we know about uses its own
    // adapter — the heuristic is a last resort, not a competitor.
    expect(resolveAdapterWithFallback(new URL('https://claude.ai/'), true)?.id).toBe('claude');
  });
});

describe('findLikelyComposer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns null when the page has no plausible field', () => {
    sized(field('div'), { w: 40, h: 12 });
    expect(findLikelyComposer()).toBeNull();
  });

  it('prefers the lower field, which is where composers live', () => {
    const top = sized(field('textarea'), { y: 40, w: 600, h: 60 });
    const bottom = sized(field('textarea'), { y: 700, w: 600, h: 60 });
    top.id = 'top';
    bottom.id = 'bottom';

    expect(findLikelyComposer()?.id).toBe('bottom');
  });

  it('trusts what the site says about a field over anything it can infer', () => {
    const search = sized(field('textarea', { 'aria-label': 'Search notes' }), { y: 760, w: 600, h: 60 });
    const prompt = sized(field('textarea', { 'aria-label': 'Message' }), { y: 300, w: 600, h: 60 });
    search.id = 'search';
    prompt.id = 'prompt';

    // The search box is lower on the page and would win on position alone.
    expect(findLikelyComposer()?.id).toBe('prompt');
  });

  it('does not mistake a long transcript for a composer', () => {
    const transcript = sized(field('div'), { y: 100, w: 800, h: 500 });
    transcript.id = 'transcript';
    Object.defineProperty(transcript, 'innerText', { value: 'x'.repeat(8000), configurable: true });
    const composer = sized(field('div'), { y: 700, w: 600, h: 40 });
    composer.id = 'composer';

    expect(findLikelyComposer()?.id).toBe('composer');
  });

  it('ignores a field too small to be a composer', () => {
    const tiny = sized(field('textarea'), { y: 700, w: 120, h: 20 });
    tiny.id = 'tiny';
    expect(findLikelyComposer()).toBeNull();
  });
});

describe('kill switches', () => {
  it('global pause stops everything', () => {
    const settings = { ...DEFAULT_SETTINGS, globalPause: true };
    expect(isEnabledFor(settings, new URL('https://claude.ai/'))).toBe(false);
  });

  it('a per-host switch leaves other hosts alone', () => {
    const settings = { ...DEFAULT_SETTINGS, disabledHosts: ['claude.ai'] };
    expect(isEnabledFor(settings, new URL('https://claude.ai/'))).toBe(false);
    expect(isEnabledFor(settings, new URL('https://chatgpt.com/'))).toBe(true);
  });

  it('is on by default', () => {
    expect(isEnabledFor(DEFAULT_SETTINGS, new URL('https://claude.ai/'))).toBe(true);
  });

  it('defaults to retaining nothing server-side', () => {
    expect(DEFAULT_SETTINGS.zeroRetention).toBe(true);
  });
});
