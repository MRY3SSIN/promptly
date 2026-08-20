import { expect, test, type Page } from '@playwright/test';

/**
 * The write chain against editors that behave like the real ones, in a real
 * browser.
 *
 * The unit suite covers the chain's control flow, but it runs in happy-dom
 * where `document.execCommand` does not exist — so the single most important
 * strategy is never exercised there. `execCommand('insertText')` matters
 * because it is the only route that makes the browser emit a *trusted*
 * `beforeinput`, and that is what ProseMirror, Lexical and Quill build their
 * transactions from. A synthetic one is not the same event and these editors
 * check. That claim can only be tested where the real thing exists.
 */

const FIXTURE = '/fixtures/editors.html';
const HARNESS = '/e2e/.build/harness.js';

/** ~500 words, one paragraph — the size M2 has to survive. */
const LONG_PROMPT = Array.from({ length: 500 }, (_, i) => `lorem-${i + 1}`).join(' ');

async function boot(page: Page) {
  await page.goto(FIXTURE);
  await page.addScriptTag({ url: HARNESS });
  await page.waitForFunction(() => typeof window.__forgeIO === 'object');
}

/** What the editor *believes*, which is the only thing that survives Enter. */
function model(page: Page, id: string) {
  return page.evaluate((key) => window.__models[key]?.doc ?? null, id);
}

test.describe('writeText', () => {
  test.beforeEach(async ({ page }) => boot(page));

  test('reaches a ProseMirror-style model through execCommand', async ({ page }) => {
    const result = await page.evaluate(
      (text) => window.__forgeIO.write('#prosemirror', text),
      'a rewritten prompt',
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('exec-command');
    // The DOM agreeing is not enough — this editor only trusts what reached
    // its document, and only that survives the next render.
    expect(await model(page, 'prosemirror')).toBe('a rewritten prompt');
  });

  test('a 500-word prompt survives, and survives the next render', async ({ page }) => {
    const result = await page.evaluate((text) => window.__forgeIO.write('#prosemirror', text), LONG_PROMPT);
    expect(result.ok).toBe(true);

    // Several frames later — long enough for any re-render to discard a write
    // that only ever touched the DOM.
    await page.waitForTimeout(400);

    expect(await model(page, 'prosemirror')).toBe(LONG_PROMPT);
    expect(await page.evaluate(() => window.__forgeIO.read('#prosemirror'))).toBe(LONG_PROMPT);
  });

  test('escalates to a synthetic paste when the editor ignores keyboard input', async ({ page }) => {
    const result = await page.evaluate(
      (text) => window.__forgeIO.write('#paste-only', text),
      'delivered by paste',
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('synthetic-paste');
    expect(result.attempts).toEqual(['exec-command', 'synthetic-paste']);
    expect(await model(page, 'paste-only')).toBe('delivered by paste');
  });

  test('writes a textarea through the prototype value setter', async ({ page }) => {
    const result = await page.evaluate(
      (text) => window.__forgeIO.write('#react-textarea', text),
      'typed into a textarea',
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('value-setter');
    expect(await model(page, 'react-textarea')).toBe('typed into a textarea');
  });

  test('gives up honestly when no strategy reaches the editor', async ({ page }) => {
    const result = await page.evaluate(
      (text) => window.__forgeIO.write('#stubborn', text),
      'nothing will take this',
    );

    expect(result.ok).toBe(false);
    expect(result.strategy).toBe('clipboard-fallback');
    expect(result.fellBack).toBe(true);
    // Never claim a write that did not happen.
    expect(await model(page, 'stubborn')).toBe('');
  });

  /**
   * The failure this guards against is catastrophic rather than annoying.
   * `selectAll` is scoped to the focused editable, so if focus never lands it
   * selects the entire document — and the `insertText` that follows replaces
   * the page with the prompt.
   */
  test('never replaces the document when focus does not land', async ({ page }) => {
    await page.evaluate((text) => window.__forgeIO.write('#unfocusable', text), 'must not escape');

    const canary = await page.evaluate(() => document.getElementById('canary')?.textContent);
    expect(canary).toBe('canary-text-must-survive');

    // And the other editors are untouched.
    expect(await model(page, 'prosemirror')).toBe('');
    expect(await page.evaluate(() => document.querySelectorAll('.editor').length)).toBe(5);
  });

  test('replaces existing content rather than appending to it', async ({ page }) => {
    await page.evaluate(() => window.__forgeIO.write('#prosemirror', 'first draft'));
    await page.evaluate(() => window.__forgeIO.write('#prosemirror', 'second draft'));

    expect(await model(page, 'prosemirror')).toBe('second draft');
  });

  test('detects the engine from the element rather than trusting the site', async ({ page }) => {
    expect(await page.evaluate(() => window.__forgeIO.engineOf('#react-textarea'))).toBe('textarea');
    expect(await page.evaluate(() => window.__forgeIO.engineOf('#prosemirror'))).toBe('unknown');

    // A Lexical marker is what its adapter keys off, so it must win.
    const lexical = await page.evaluate(() => {
      const el = document.getElementById('stubborn')!;
      el.setAttribute('data-lexical-editor', 'true');
      return window.__forgeIO.engineOf('#stubborn');
    });
    expect(lexical).toBe('lexical');
  });
});
