import { beforeEach, describe, expect, it } from 'vitest';
import { claudeAdapter } from '../../src/adapters/claude';
import { resolveAdapter } from '../../src/adapters/registry';
import { isUsableComposer, resolveFirst } from '../../src/adapters/types';

describe('resolveAdapter', () => {
  it('matches claude.ai and its subdomains', () => {
    expect(resolveAdapter(new URL('https://claude.ai/chat/abc'))?.id).toBe('claude');
    expect(resolveAdapter(new URL('https://app.claude.ai/'))?.id).toBe('claude');
  });

  it('does not match a lookalike domain', () => {
    // `endsWith('.claude.ai')` rather than `includes('claude.ai')`, or
    // `claude.ai.evil.com` would get an adapter and a widget.
    expect(resolveAdapter(new URL('https://claude.ai.evil.com/'))).toBeNull();
    expect(resolveAdapter(new URL('https://notclaude.ai/'))).toBeNull();
  });

  it('returns null for unrelated sites rather than a generic fallback', () => {
    expect(resolveAdapter(new URL('https://example.com/'))).toBeNull();
  });
});

describe('composer resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds the composer through the primary selector', () => {
    document.body.innerHTML = `
      <form><fieldset><div class="wrap">
        <div class="ProseMirror" contenteditable="true" aria-label="Write your prompt to Claude"></div>
      </div></fieldset></form>`;

    expect(claudeAdapter.getComposer()?.className).toBe('ProseMirror');
  });

  it('falls back down the chain when the primary structure has changed', () => {
    // No fieldset — the shape a redesign leaves behind. The later, looser
    // selectors are the entire reason the chain is ordered.
    document.body.innerHTML = `
      <div><div class="ProseMirror" contenteditable="true"></div></div>`;

    expect(claudeAdapter.getComposer()).not.toBeNull();
  });

  it('returns null rather than guessing when nothing matches', () => {
    document.body.innerHTML = '<div><textarea></textarea></div>';
    expect(claudeAdapter.getComposer()).toBeNull();
  });

  it('honours a data-forge="false" opt-out on an ancestor', () => {
    document.body.innerHTML = `
      <div data-forge="false"><form><fieldset><div>
        <div class="ProseMirror" contenteditable="true"></div>
      </div></fieldset></form></div>`;

    expect(claudeAdapter.getComposer()).toBeNull();
  });

  it('skips a malformed selector instead of abandoning the chain', () => {
    document.body.innerHTML = '<div id="real"></div>';
    expect(resolveFirst(['::::bogus', '#real'])?.id).toBe('real');
  });

  it('rejects a detached element', () => {
    const orphan = document.createElement('div');
    expect(isUsableComposer(orphan)).toBe(false);
  });

  it('reads text with innerText so paragraph breaks survive', () => {
    document.body.innerHTML = `
      <form><fieldset><div>
        <div class="ProseMirror" contenteditable="true"><p>one</p><p>two</p></div>
      </div></fieldset></form>`;

    const composer = claudeAdapter.getComposer()!;
    // happy-dom derives innerText from textContent, so this asserts the call
    // shape rather than the browser's line-break behaviour.
    expect(claudeAdapter.readText(composer)).toContain('one');
  });
});

describe('claude anchor spec', () => {
  it('insets from the composer corner rather than reaching past it', () => {
    // A positive vertical offset would put the widget in Claude's control row,
    // straddling the composer's edge — and a widget resting on that boundary
    // makes the avoid-zone overlap test bistable.
    expect(claudeAdapter.anchor.offset.y).toBeLessThan(0);
    expect(claudeAdapter.anchor.offset.x).toBeLessThan(0);
  });

  it('names the send button so the widget can never cover it', () => {
    expect(claudeAdapter.anchor.avoidSelectors.some((s) => /send/i.test(s))).toBe(true);
  });
});
