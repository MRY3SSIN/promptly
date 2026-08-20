import { readText } from '../io/readText';
import { writeText } from '../io/writeText';
import { detectEngine, isUsableComposer, type SiteAdapter } from './types';

/**
 * The heuristic fallback, for sites we have not hand-written an adapter for.
 *
 * This is deliberately not the primary path anywhere. A heuristic that picks
 * the right composer nine times out of ten picks somebody's *other* text field
 * the tenth time, and the failure mode is replacing content the user did not
 * want replaced. So it never runs unless a user has explicitly enabled it for
 * that exact hostname — see `genericEnabledHosts` — and the registry keeps it
 * out of the ordinary lookup entirely.
 *
 * The scoring below is a set of structural signals rather than one rule,
 * because any single rule has an obvious counterexample: "biggest
 * contenteditable" picks the message transcript on most chat sites.
 */

/** Anything smaller than this is a search box, not a composer. */
const MIN_AREA = 4000;
const MIN_WIDTH = 180;
const MIN_HEIGHT = 24;

const CANDIDATE_SELECTOR =
  'textarea, div[contenteditable="true"], div[contenteditable=""], [role="textbox"][contenteditable]';

export const genericAdapter: SiteAdapter = {
  id: 'generic',
  label: 'This site',
  engine: 'unknown',

  // Never matched by the registry. Resolution is explicit and opt-in.
  matches: () => false,

  getComposer() {
    return findLikelyComposer();
  },

  resolveEngine: (el) => detectEngine(el),

  readText(el) {
    return readText(el, detectEngine(el));
  },

  async writeText(el, text) {
    return (await writeText(el, text, detectEngine(el))).ok;
  },

  anchor: {
    corner: 'bottom-right',
    offset: { x: -8, y: -8 },
    avoidSelectors: [
      'button[type="submit"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Submit" i]',
    ],
  },
};

interface Scored {
  el: HTMLElement;
  score: number;
}

/**
 * Rank the page's editable fields and take the best, if anything scores well
 * enough to be worth acting on at all.
 */
export function findLikelyComposer(root: ParentNode = document): HTMLElement | null {
  const scored: Scored[] = [];

  for (const node of root.querySelectorAll(CANDIDATE_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    if (!isUsableComposer(node)) continue;

    const score = scoreCandidate(node);
    if (score > 0) scored.push({ el: node, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.el ?? null;
}

function scoreCandidate(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return 0;
  if (rect.width * rect.height < MIN_AREA) return 0;

  // Off-screen fields are templates or hidden panels, not what has focus.
  if (rect.bottom < 0 || rect.top > window.innerHeight * 2) return 0;

  let score = 1;

  // A composer is nearly always the lowest editable field on the page. This is
  // the signal that separates it from a transcript or a document body.
  score += (rect.top / Math.max(1, window.innerHeight)) * 3;

  // Wide fields are composers; narrow ones are search and filter boxes.
  if (rect.width > 320) score += 1;

  // The site telling us what it is beats anything we can infer.
  const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`;
  if (/prompt|message|ask|chat|question|send/i.test(label)) score += 3;
  if (/search|filter|find|url|email/i.test(label)) score -= 4;

  if (el.closest('form')) score += 0.5;
  if (el.tagName === 'TEXTAREA') score += 0.5;

  // A field holding a conversation is the transcript, not the composer.
  if (el.isContentEditable && (el.innerText?.length ?? 0) > 4000) score -= 3;

  return Math.max(0, score);
}
