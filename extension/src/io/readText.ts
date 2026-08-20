import type { EditorEngine } from '../adapters/types';

/**
 * Getting the user's draft back out of a composer.
 *
 * Simpler than writing, but not trivial: the obvious `textContent` runs every
 * paragraph of a rich-text editor together into one line, which turns a
 * structured prompt into a wall of text and makes the wall-of-text rule fire
 * on prompts that are properly formatted.
 */

export function readText(el: HTMLElement, engine: EditorEngine): string {
  if (engine === 'textarea' || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return (el as HTMLTextAreaElement | HTMLInputElement).value ?? '';
  }

  /*
   * `innerText` for everything contenteditable. It is layout-aware, so it
   * reproduces the line breaks the user actually sees — block children become
   * newlines, `<br>` becomes a newline, and hidden nodes are skipped.
   * `textContent` does none of that.
   */
  return el.innerText ?? el.textContent ?? '';
}

/**
 * Compare what we meant to write against what the editor kept.
 *
 * Editors legitimately alter text on insertion: ProseMirror emits non-breaking
 * spaces to preserve runs of whitespace, `innerText` adds a trailing newline
 * for a trailing block, and line endings get normalised. None of that is a
 * failed write, so comparing raw strings would send us down the fallback chain
 * for writes that in fact succeeded — and each unnecessary fallback dispatches
 * more synthetic events at somebody else's editor.
 */
export function textMatches(actual: string, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Editors substitute NBSP for significant spaces; the user typed a space.
    .replace(/ /g, ' ')
    // Zero-width marks some editors use to keep empty nodes selectable.
    .replace(/[​‌﻿]/g, '')
    .replace(/[ \t]+$/gm, '')
    /*
     * Collapse runs of blank lines to a single paragraph break.
     *
     * A paragraph break inserted into a contenteditable becomes
     * `<p>one</p><p><br></p><p>two</p>` — structurally exactly right, one empty
     * paragraph between two full ones. But `innerText` serialises that as five
     * newlines: one per block boundary, plus one for the `<br>`. Compared raw,
     * a perfectly good write reads back as a mismatch, and the chain escalates
     * through every remaining strategy before landing on "copied — paste it in"
     * for text that is already sitting in the box.
     *
     * Found by the dev round-trip bar on a real build. The automated tests
     * missed it because their 500-word probe was a single paragraph — chosen,
     * at the time, specifically to avoid whitespace quirks.
     *
     * Applied to both sides, so it cannot mask a difference in wording, and a
     * paragraph break flattened all the way to a line break is still a
     * mismatch: section boundaries are the structure of a framework-shaped
     * prompt, and losing them is a real failure.
     */
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
