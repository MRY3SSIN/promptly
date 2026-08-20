import { readText } from '../io/readText';
import { writeText } from '../io/writeText';
import { resolveFirst, type SelectorChain, type SiteAdapter } from './types';

/**
 * claude.ai — ProseMirror.
 *
 * Selectors are ordered most-specific to most-general. The specific ones are
 * what the site ships today; the general ones are what will still be true
 * after the next redesign. `resolveFirst` walks them in order, so adding a
 * newer selector at the top is the whole cost of keeping up with a redesign.
 *
 * These are verified against `tests/fixtures/claude.html`. That fixture is a
 * snapshot and will rot — the weekly selector-drift CI job is what catches it.
 */
const COMPOSER_SELECTORS: SelectorChain = [
  // Current: the composer sits inside a fieldset in the chat input form.
  'fieldset div.ProseMirror[contenteditable="true"]',
  // The composer carries an aria-label ("Write your prompt to Claude").
  'div.ProseMirror[contenteditable="true"][aria-label]',
  // Older markup keyed off a test id on the wrapper.
  '[data-testid="chat-input-container"] div[contenteditable="true"]',
  '[data-testid="chat-input"]',
  // Generic ProseMirror anywhere in the document.
  'div.ProseMirror[contenteditable="true"]',
  // Last resort: any contenteditable that declares itself a textbox.
  'div[contenteditable="true"][role="textbox"]',
];

const SUBMIT_SELECTORS: SelectorChain = [
  'button[aria-label="Send message"]',
  'button[aria-label="Send Message"]',
  'button[data-testid="send-button"]',
  'fieldset button[type="submit"]',
];

export const claudeAdapter: SiteAdapter = {
  id: 'claude',
  label: 'Claude',
  engine: 'prosemirror',

  matches: (url) => url.hostname === 'claude.ai' || url.hostname.endsWith('.claude.ai'),

  getComposer() {
    return resolveFirst(COMPOSER_SELECTORS);
  },

  getSubmitButton() {
    return resolveFirst(SUBMIT_SELECTORS);
  },

  readText(el) {
    return readText(el, 'prosemirror');
  },

  async writeText(el, text) {
    return (await writeText(el, text, 'prosemirror')).ok;
  },

  anchor: {
    corner: 'bottom-right',
    /*
     * Inset from the composer's own bottom-right corner. Claude keeps its send
     * and attach buttons in the fieldset's padding *below* the composer
     * element, so an inset placement clears them without relying on the
     * avoid-zone slide at all — and a placement that does not depend on the
     * slide cannot jitter when the slide's overlap test flips.
     */
    offset: { x: -8, y: -8 },
    avoidSelectors: [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="attach" i]',
      'button[aria-label*="Upload" i]',
      '[data-testid="model-selector-dropdown"]',
    ],
  },
};
