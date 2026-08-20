import { writeText } from '../io/writeText';
import { readText } from '../io/readText';
import { detectEngine, resolveFirst, type SelectorChain, type SiteAdapter } from './types';

/**
 * perplexity.ai — textarea or Lexical, depending which surface you are on.
 *
 * The home page and the follow-up box are not the same component, and they have
 * not historically shipped the same editor. Guessing wrong is not a cosmetic
 * problem: the textarea path writes through the prototype value setter, which a
 * Lexical editor ignores entirely, so the write appears to land and is dropped
 * on the next render. So the engine is read off the element itself.
 */
const COMPOSER_SELECTORS: SelectorChain = [
  'div[contenteditable="true"][data-lexical-editor="true"]',
  'textarea[placeholder*="Ask" i]',
  'textarea#ask-input',
  'main div[contenteditable="true"]',
  'main textarea',
];

const SUBMIT_SELECTORS: SelectorChain = [
  'button[aria-label*="Submit" i]',
  'button[data-testid="submit-button"]',
  'button[type="submit"]',
];

export const perplexityAdapter: SiteAdapter = {
  id: 'perplexity',
  label: 'Perplexity',
  // Only the starting assumption; `resolveEngine` is what actually decides.
  engine: 'unknown',

  matches: (url) => url.hostname === 'perplexity.ai' || url.hostname.endsWith('.perplexity.ai'),

  getComposer() {
    return resolveFirst(COMPOSER_SELECTORS);
  },

  getSubmitButton() {
    return resolveFirst(SUBMIT_SELECTORS);
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
      'button[aria-label*="Submit" i]',
      'button[data-testid="submit-button"]',
      'button[aria-label*="attach" i]',
      'button[aria-label*="voice" i]',
    ],
  },
};
