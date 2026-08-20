import { writeText } from '../io/writeText';
import { readText } from '../io/readText';
import { resolveFirst, type SelectorChain, type SiteAdapter } from './types';

/**
 * gemini.google.com — Quill, inside Angular.
 *
 * The composer is a `.ql-editor` within Google's own `<rich-textarea>`
 * component. Angular re-renders the subtree on its own schedule, so the element
 * we resolve is replaced more often here than on the other sites — which is
 * what the anchor engine's re-resolution is for.
 */
const COMPOSER_SELECTORS: SelectorChain = [
  'rich-textarea .ql-editor[contenteditable="true"]',
  'rich-textarea div[contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
];

const SUBMIT_SELECTORS: SelectorChain = [
  'button.send-button',
  'button[aria-label*="Send" i]',
  'button[mattooltip*="Send" i]',
];

export const geminiAdapter: SiteAdapter = {
  id: 'gemini',
  label: 'Gemini',
  engine: 'quill',

  matches: (url) => url.hostname === 'gemini.google.com',

  getComposer() {
    return resolveFirst(COMPOSER_SELECTORS);
  },

  getSubmitButton() {
    return resolveFirst(SUBMIT_SELECTORS);
  },

  readText(el) {
    return readText(el, 'quill');
  },

  async writeText(el, text) {
    return (await writeText(el, text, 'quill')).ok;
  },

  anchor: {
    corner: 'bottom-right',
    offset: { x: -8, y: -8 },
    avoidSelectors: [
      'button.send-button',
      'button[aria-label*="Send" i]',
      'button[aria-label*="microphone" i]',
      'button[aria-label*="image" i]',
      'uploader-button',
    ],
  },
};
