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
    .trim();
}
