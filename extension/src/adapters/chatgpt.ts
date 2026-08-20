import { writeText } from '../io/writeText';
import { readText } from '../io/readText';
import { resolveFirst, type SelectorChain, type SiteAdapter } from './types';

/**
 * chatgpt.com and chat.openai.com — ProseMirror.
 *
 * OpenAI moved this composer from a plain `<textarea>` to ProseMirror without
 * changing the element's id, so `#prompt-textarea` still resolves — it is just
 * a contenteditable now. The chain keeps both shapes, and the engine is
 * detected per element rather than assumed, because the id lies about it.
 */
const COMPOSER_SELECTORS: SelectorChain = [
  'div#prompt-textarea[contenteditable="true"]',
  '#prompt-textarea',
  'form div.ProseMirror[contenteditable="true"]',
  'div.ProseMirror[contenteditable="true"]',
  'textarea[data-id="root"]',
  'form textarea',
];

const SUBMIT_SELECTORS: SelectorChain = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send" i]',
  'form button[type="submit"]',
];

export const chatgptAdapter: SiteAdapter = {
  id: 'chatgpt',
  label: 'ChatGPT',
  engine: 'prosemirror',

  matches: (url) =>
    url.hostname === 'chatgpt.com' ||
    url.hostname.endsWith('.chatgpt.com') ||
    url.hostname === 'chat.openai.com',

  getComposer() {
    return resolveFirst(COMPOSER_SELECTORS);
  },

  getSubmitButton() {
    return resolveFirst(SUBMIT_SELECTORS);
  },

  // `#prompt-textarea` is a contenteditable today and was a textarea before.
  resolveEngine: (el) => (el.tagName === 'TEXTAREA' ? 'textarea' : 'prosemirror'),

  readText(el) {
    return readText(el, el.tagName === 'TEXTAREA' ? 'textarea' : 'prosemirror');
  },

  async writeText(el, text) {
    const result = await writeText(el, text, el.tagName === 'TEXTAREA' ? 'textarea' : 'prosemirror');
    return result.ok;
  },

  anchor: {
    corner: 'bottom-right',
    offset: { x: -8, y: -8 },
    avoidSelectors: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Dictate" i]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Upload" i]',
    ],
  },
};
