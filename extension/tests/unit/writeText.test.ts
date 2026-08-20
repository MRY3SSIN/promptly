import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalize, readText, textMatches } from '../../src/io/readText';
import { writeText } from '../../src/io/writeText';

/**
 * The write chain, against editors that behave like the real ones.
 *
 * The hazard these mocks reproduce is the one that makes this file hard: a
 * framework editor keeps its own document as the source of truth and re-renders
 * the DOM from it. Text put into the DOM by any route the editor is not
 * listening to survives exactly until its next render, so a naive check
 * immediately after writing sees success and the user loses their prompt on
 * Enter. `MockEditor` re-renders on a microtask, so a write that did not reach
 * the model is gone by the time verification reads it back.
 *
 * `document.execCommand` does not exist in happy-dom, so the `exec-command`
 * strategy always throws here and the suite exercises escalation past it. The
 * strategy itself is covered against real editors in
 * `tests/e2e/writeText.spec.ts`, in a browser where it exists.
 */

type Accepts = 'input' | 'paste' | 'beforeinput';

/**
 * An editor whose DOM is a projection of `doc`, updated only through the input
 * paths it has opted into.
 */
class MockEditor {
  doc = '';
  readonly el: HTMLElement;
  readonly seen: string[] = [];

  constructor(el: HTMLElement, private readonly accepts: Set<Accepts>) {
    this.el = el;

    el.addEventListener('paste', (event) => {
      if (!this.accepts.has('paste')) return;
      const text = (event as ClipboardEvent).clipboardData?.getData('text/plain');
      if (text == null) return;
      event.preventDefault();
      this.commit(text, 'paste');
    });

    el.addEventListener('beforeinput', (event) => {
      if (!this.accepts.has('beforeinput')) return;
      const ie = event as InputEvent;
      if (ie.data == null) return;
      this.commit(ie.data, 'beforeinput');
    });

    el.addEventListener('input', () => {
      if (!this.accepts.has('input')) return;
      this.commit(this.readDom(), 'input');
    });
  }

  private commit(text: string, via: Accepts): void {
    this.doc = text;
    this.seen.push(via);
    this.render();
  }

  private readDom(): string {
    return this.el instanceof HTMLTextAreaElement ? this.el.value : (this.el.textContent ?? '');
  }

  /**
   * Overwrite whatever is in the DOM with the model's version — the step that
   * discards writes which never reached the model.
   */
  render(): void {
    if (this.el instanceof HTMLTextAreaElement) this.el.value = this.doc;
    else this.el.textContent = this.doc;
  }

  /**
   * Stands in for the frame `writeText` waits before reading back.
   *
   * Rendering here is what makes the mock honest. A real editor re-renders from
   * its model between the write and the next frame, so text that never reached
   * the model is already gone by the time verification looks. Without it the
   * mock keeps whatever was poked into the DOM, every strategy appears to
   * succeed, and the suite passes while asserting nothing — which is exactly
   * what the first version of it did.
   */
  frame = async (): Promise<void> => {
    this.render();
  };
}

function makeTextarea(accepts: Accepts[]): MockEditor {
  const el = document.createElement('textarea');
  document.body.appendChild(el);
  return new MockEditor(el, new Set(accepts));
}

function makeContentEditable(accepts: Accepts[]): MockEditor {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  // happy-dom derives `isContentEditable` from the attribute inconsistently,
  // so pin it: the strategy dispatch keys off this property.
  Object.defineProperty(el, 'isContentEditable', { value: true, configurable: true });
  document.body.appendChild(el);
  return new MockEditor(el, new Set(accepts));
}

/** Frames are injected, so no test waits on a real rAF. */
const immediateFrame = () => Promise.resolve();

describe('writeText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('textarea', () => {
    it('writes through the prototype value setter and announces it', async () => {
      const editor = makeTextarea(['input']);

      const result = await writeText(editor.el, 'hello world', 'textarea', {
        nextFrame: editor.frame,
      });

      expect(result.ok).toBe(true);
      expect(result.strategy).toBe('value-setter');
      expect(editor.doc).toBe('hello world');
    });

    /**
     * React installs its own `value` accessor on the element instance to track
     * changes, so assigning to `el.value` writes past its bookkeeping — the box
     * shows new text while React's state still holds the old. Going through the
     * prototype descriptor is what makes the change visible to it.
     */
    it('reaches a framework that shadows value on the instance', async () => {
      const editor = makeTextarea(['input']);
      let shadowed = '';
      Object.defineProperty(editor.el, 'value', {
        configurable: true,
        get: () => shadowed,
        set: (v: string) => {
          shadowed = v;
        },
      });

      await writeText(editor.el, 'through the prototype', 'textarea', { nextFrame: editor.frame });

      // The prototype setter bypasses the instance accessor entirely, so the
      // shadow copy never sees it — which is the whole point.
      expect(editor.doc).toBe('through the prototype');
    });

    it('escalates to paste when the editor ignores input events', async () => {
      const editor = makeTextarea(['paste']);

      const result = await writeText(editor.el, 'pasted instead', 'textarea', {
        nextFrame: editor.frame,
      });

      expect(result.ok).toBe(true);
      expect(result.strategy).toBe('synthetic-paste');
      expect(result.attempts).toEqual(['value-setter', 'synthetic-paste']);
      expect(editor.doc).toBe('pasted instead');
    });
  });

  describe('contenteditable', () => {
    it('escalates past exec-command to paste', async () => {
      const editor = makeContentEditable(['paste']);

      const result = await writeText(editor.el, 'prosemirror text', 'prosemirror', {
        nextFrame: editor.frame,
      });

      expect(result.strategy).toBe('synthetic-paste');
      expect(result.attempts[0]).toBe('exec-command');
      expect(editor.doc).toBe('prosemirror text');
    });

    it('falls through to the input-event pair when paste is refused', async () => {
      const editor = makeContentEditable(['beforeinput']);

      const result = await writeText(editor.el, 'via beforeinput', 'lexical', {
        nextFrame: editor.frame,
      });

      expect(result.ok).toBe(true);
      expect(result.strategy).toBe('input-events');
      expect(editor.doc).toBe('via beforeinput');
    });

    it('never leaves a write unverified: an editor that reverts is a failure', async () => {
      // Accepts nothing, and re-renders over anything written directly. This is
      // exactly the editor that makes a naive innerHTML write look successful.
      const editor = makeContentEditable([]);
      const onFallback = vi.fn();

      const result = await writeText(editor.el, 'will not stick', 'quill', {
        nextFrame: editor.frame,
        onFallback,
      });

      expect(result.ok).toBe(false);
      expect(result.strategy).toBe('clipboard-fallback');
      expect(onFallback).toHaveBeenCalledWith('will not stick');
      expect(editor.doc).toBe('');
    });

    it('tries every strategy in order before giving up', async () => {
      const editor = makeContentEditable([]);

      const result = await writeText(editor.el, 'nope', 'unknown', {
        nextFrame: editor.frame,
        onFallback: () => {},
      });

      expect(result.attempts).toEqual([
        'exec-command',
        'synthetic-paste',
        'input-events',
        'clipboard-fallback',
      ]);
    });

    it('stops at the first strategy that verifies', async () => {
      const editor = makeContentEditable(['paste', 'beforeinput']);

      const result = await writeText(editor.el, 'first win', 'prosemirror', {
        nextFrame: editor.frame,
      });

      expect(result.attempts).not.toContain('input-events');
      expect(editor.seen).toEqual(['paste']);
    });
  });

  it('waits a frame before reading back', async () => {
    // Editors turn an input event into a transaction and re-render
    // asynchronously. Reading immediately can catch a half-applied state and
    // escalate away from a strategy that was about to work.
    const editor = makeTextarea(['input']);
    const nextFrame = vi.fn(() => Promise.resolve());

    await writeText(editor.el, 'patience', 'textarea', { nextFrame });

    expect(nextFrame).toHaveBeenCalled();
  });

  it('dispatches composed events, so they cross a shadow boundary', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const el = document.createElement('textarea');
    shadow.appendChild(el);

    // A framework listening from outside the shadow root only ever sees events
    // constructed with `composed: true`.
    const outside = vi.fn();
    document.addEventListener('input', outside);

    await writeText(el, 'crosses the boundary', 'textarea', { nextFrame: immediateFrame });

    expect(outside).toHaveBeenCalled();
    document.removeEventListener('input', outside);
  });
});

describe('readText', () => {
  it('reads a textarea through value', () => {
    const el = document.createElement('textarea');
    el.value = 'typed';
    expect(readText(el, 'textarea')).toBe('typed');
  });

  it('reads a contenteditable without running paragraphs together', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>one</p><p>two</p>';
    // happy-dom derives innerText from textContent, so this asserts the read
    // path rather than the browser's line-break behaviour; the real behaviour
    // is covered in the browser suite.
    expect(readText(el, 'prosemirror')).toContain('one');
  });
});

describe('textMatches', () => {
  it('accepts the non-breaking spaces editors substitute for real ones', () => {
    expect(textMatches('a b', 'a b')).toBe(true);
  });

  it('accepts normalised line endings', () => {
    expect(textMatches('a\r\nb', 'a\nb')).toBe(true);
  });

  it('accepts the zero-width marks used to keep empty nodes selectable', () => {
    expect(textMatches('hello​', 'hello')).toBe(true);
  });

  it('accepts a trailing newline from a trailing block element', () => {
    expect(textMatches('hello\n', 'hello')).toBe(true);
  });

  it('still rejects a genuinely different string', () => {
    expect(textMatches('hello world', 'hello')).toBe(false);
  });

  it('rejects a truncated write, which is the failure that matters', () => {
    expect(textMatches('lorem-1 lorem-2', 'lorem-1 lorem-2 lorem-3')).toBe(false);
  });

  it('preserves a paragraph break rather than collapsing it away', () => {
    expect(normalize('a\n\nb')).toBe('a\n\nb');
  });

  /**
   * `innerText` emits a newline per block boundary *and* one for the `<br>`
   * inside an empty paragraph, so a correctly structured paragraph break reads
   * back as five newlines. Comparing raw sends a perfectly good write down the
   * whole fallback chain and out the other side as "copied — paste it in".
   */
  it('accepts the newline inflation innerText applies to a blank paragraph', () => {
    expect(textMatches('one\n\n\n\n\ntwo', 'one\n\ntwo')).toBe(true);
  });

  it('still rejects a paragraph break flattened into a line break', () => {
    // Section boundaries are the structure of a framework-shaped prompt, so
    // losing them is a real failure rather than a serialisation quirk.
    expect(textMatches('one\ntwo', 'one\n\ntwo')).toBe(false);
  });
});
