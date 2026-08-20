import type { EditorEngine } from '../adapters/types';
import { log, telemetry } from '../util/logger';
import { readText, textMatches } from './readText';

/**
 * Putting text into somebody else's editor.
 *
 * This is the file that breaks, and it breaks quietly. ProseMirror, Lexical and
 * Quill all keep an internal document tree that is the source of truth; the DOM
 * is a rendering of it. Set `innerHTML` and the pixels change, the user sees
 * their new prompt, and then the editor's next render — often the moment they
 * press Enter — throws it away and sends the old text. The write "worked" right
 * up until it mattered.
 *
 * So every strategy here goes through an input path the editor is already
 * listening to, and every strategy is verified by reading the text back a frame
 * later. A write that cannot be verified is treated as a failure and escalated,
 * because the alternative is telling the user we inserted their improved prompt
 * when we did not.
 *
 * The chain, in order, stopping at the first verified success:
 *
 *   1. engine-specific — the prototype value setter for textareas, or
 *      `execCommand('insertText')` for anything contenteditable
 *   2. synthetic paste — a real `ClipboardEvent` carrying a `DataTransfer`
 *   3. `beforeinput` + `input` with `inputType: 'insertReplacementText'`
 *   4. give up honestly — copy to the clipboard and tell the user to paste
 */

export type WriteStrategy =
  | 'value-setter'
  | 'exec-command'
  | 'synthetic-paste'
  | 'input-events'
  | 'clipboard-fallback';

export interface WriteResult {
  ok: boolean;
  /** The strategy that verified, or `clipboard-fallback` when we gave up. */
  strategy: WriteStrategy | null;
  /** Every strategy tried, in order. Telemetry uses this to spot adapter rot. */
  attempts: WriteStrategy[];
}

export interface WriteOptions {
  /** Injectable so unit tests can drive frames without waiting on rAF. */
  nextFrame?: () => Promise<void>;
  /** Called when the chain is exhausted, to show the "copied" toast. */
  onFallback?: (text: string) => void;
}

export async function writeText(
  el: HTMLElement,
  text: string,
  engine: EditorEngine,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const waitFrame = options.nextFrame ?? nextAnimationFrame;
  const attempts: WriteStrategy[] = [];

  for (const strategy of STRATEGIES) {
    if (!strategy.applies(el, engine)) continue;
    attempts.push(strategy.id);

    try {
      strategy.run(el, text);
    } catch (err) {
      log.debug(`write strategy "${strategy.id}" threw`, err);
      continue;
    }

    /*
     * One frame, then read it back.
     *
     * The frame matters: these editors process an input event into a
     * transaction and re-render asynchronously, so reading immediately can see
     * either the old text or a half-applied state, and we would escalate away
     * from a strategy that was about to work.
     */
    await waitFrame();

    if (textMatches(readText(el, engine), text)) {
      telemetry('write_ok', { strategy: strategy.id, engine, attempts: attempts.length });
      return { ok: true, strategy: strategy.id, attempts };
    }

    log.debug(`write strategy "${strategy.id}" did not verify; escalating`);
  }

  // Nothing took. Never fail silently: put it on the clipboard so the work is
  // not lost, and say so.
  attempts.push('clipboard-fallback');
  await copyToClipboard(el, text);
  options.onFallback?.(text);
  telemetry('write_exhausted', { engine, attempts: attempts.length });

  return { ok: false, strategy: 'clipboard-fallback', attempts };
}

// --------------------------------------------------------------- strategies

interface Strategy {
  id: WriteStrategy;
  applies(el: HTMLElement, engine: EditorEngine): boolean;
  run(el: HTMLElement, text: string): void;
}

const STRATEGIES: readonly Strategy[] = [
  /**
   * Textareas and inputs, through the prototype's value setter.
   *
   * React installs its own `value` property on the DOM *instance* to track
   * changes, so a plain `el.value = text` writes straight past its bookkeeping:
   * the box shows the new text and React's state still holds the old one.
   * Calling the setter from the prototype instead goes through the descriptor
   * React wrapped, so its onChange sees the change like any keystroke.
   */
  {
    id: 'value-setter',
    applies: (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement,
    run(el, text) {
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('no value setter on prototype');

      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    },
  },

  /**
   * Contenteditable, through `execCommand('insertText')`.
   *
   * `execCommand` is deprecated and universally implemented, and it is the only
   * route that makes the browser emit a genuine `beforeinput` with
   * `inputType: 'insertText'` — which is exactly the event ProseMirror, Lexical
   * and Quill build their transactions from. A synthetic `beforeinput` is not
   * the same thing: it is untrusted, and these editors check.
   *
   * Do not modernise this. There is no replacement that reaches the editor's
   * document model.
   */
  {
    id: 'exec-command',
    applies: (el, engine) => engine !== 'textarea' && el.isContentEditable,
    run(el, text) {
      el.focus({ preventScroll: true });

      /*
       * Refuse to continue unless focus actually landed inside the composer.
       *
       * `selectAll` is scoped to the focused editable, so if focus went
       * somewhere else — a disabled ancestor, a modal stealing it back — it
       * selects the whole *document* instead, and the `insertText` that follows
       * replaces the page. Checking is cheap; the failure is not recoverable.
       */
      if (!hasFocusWithin(el)) throw new Error('focus did not land in the composer');

      selectAllWithin(el);
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted) throw new Error('execCommand(insertText) returned false');
    },
  },

  /**
   * A synthetic paste, carrying a real `DataTransfer`.
   *
   * Editors that ignore synthetic key input still handle paste, because paste
   * is how content legitimately arrives from outside. This is the strategy that
   * covers editors which have opted out of `execCommand` handling.
   */
  {
    id: 'synthetic-paste',
    applies: (el) => el.isContentEditable || el instanceof HTMLTextAreaElement,
    run(el, text) {
      el.focus({ preventScroll: true });
      if (!hasFocusWithin(el)) throw new Error('focus did not land in the composer');
      if (el.isContentEditable) selectAllWithin(el);
      else if (el instanceof HTMLTextAreaElement) el.select();

      const data = new DataTransfer();
      data.setData('text/plain', text);

      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      if (!el.dispatchEvent(event)) {
        // The editor called preventDefault, which means it handled the paste
        // itself. That is a success signal, not a failure; verification decides.
        return;
      }
    },
  },

  /**
   * A `beforeinput`/`input` pair with `inputType: 'insertReplacementText'`.
   *
   * Last resort before giving up. Both events are synthetic and therefore
   * untrusted, so a strict editor will ignore them — but several treat
   * `insertReplacementText` as the spellcheck-correction path and apply it
   * without checking `isTrusted`.
   */
  {
    id: 'input-events',
    applies: () => true,
    run(el, text) {
      el.focus({ preventScroll: true });
      if (el.isContentEditable) selectAllWithin(el);

      const init: InputEventInit = {
        inputType: 'insertReplacementText',
        data: text,
        bubbles: true,
        cancelable: true,
        composed: true,
      };

      el.dispatchEvent(new InputEvent('beforeinput', init));

      // Nothing applies a synthetic beforeinput on our behalf, so put the text
      // in the DOM before announcing it with `input`.
      if (el.isContentEditable) el.textContent = text;
      else if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.value = text;

      el.dispatchEvent(new InputEvent('input', { ...init, cancelable: false }));
    },
  },
];

// ------------------------------------------------------------------ helpers

/**
 * Select the composer's contents, and only the composer's contents.
 *
 * A `Range` over the element rather than `document.execCommand('selectAll')`:
 * the two agree when focus is where we think it is, but a scoped range cannot
 * possibly reach outside the composer even if it is not.
 */
function selectAllWithin(el: HTMLElement): void {
  const selection = (el.ownerDocument.defaultView ?? window).getSelection();
  if (!selection) throw new Error('no selection available');

  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Did focus land in the composer — including through a shadow boundary? */
function hasFocusWithin(el: HTMLElement): boolean {
  const doc = el.ownerDocument;
  if (doc.activeElement === el || (doc.activeElement && el.contains(doc.activeElement))) return true;

  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const active = root.activeElement;
    if (active === el || (active && el.contains(active))) return true;
  }
  return false;
}

/**
 * Put the text on the clipboard so an exhausted chain still leaves the user
 * their improved prompt.
 *
 * The async Clipboard API needs transient user activation, which we have —
 * every write originates in a click. When it is unavailable the fallback stages
 * through a textarea, which is created *inside our own shadow root* rather than
 * appended to the page, so even this path adds nothing to the host document.
 */
async function copyToClipboard(el: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy path.
  }

  const root = el.getRootNode();
  const host = root instanceof ShadowRoot ? root : document.body;

  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('aria-hidden', 'true');
  scratch.style.cssText = 'position:fixed;top:-9999px;opacity:0;pointer-events:none';
  host.appendChild(scratch);
  try {
    scratch.select();
    document.execCommand('copy');
  } catch (err) {
    log.error('clipboard fallback failed', err);
  } finally {
    scratch.remove();
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}
