import { writeText } from '../io/writeText';
import { readText } from '../io/readText';
import { resolveFirst, type SelectorChain, type SiteAdapter } from './types';

/** aistudio.google.com — a plain textarea, and the simplest site we support. */
const COMPOSER_SELECTORS: SelectorChain = [
  'ms-prompt-input-wrapper textarea',
  'textarea[aria-label*="prompt" i]',
  'textarea[placeholder*="prompt" i]',
  'main textarea',
];

const SUBMIT_SELECTORS: SelectorChain = [
  'button[aria-label*="Run" i]',
  'run-button button',
  'button[type="submit"]',
];

export const aiStudioAdapter: SiteAdapter = {
  id: 'aistudio',
  label: 'Google AI Studio',
  engine: 'textarea',

  matches: (url) => url.hostname === 'aistudio.google.com',

  getComposer() {
    return resolveFirst(COMPOSER_SELECTORS);
  },

  getSubmitButton() {
    return resolveFirst(SUBMIT_SELECTORS);
  },

  readText(el) {
    return readText(el, 'textarea');
  },

  async writeText(el, text) {
    return (await writeText(el, text, 'textarea')).ok;
  },

  anchor: {
    corner: 'bottom-right',
    offset: { x: -8, y: -8 },
    avoidSelectors: ['button[aria-label*="Run" i]', 'run-button', 'button[aria-label*="Insert" i]'],
  },
};
