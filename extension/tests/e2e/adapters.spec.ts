import { expect, test, type Page } from '@playwright/test';

/**
 * One fixture and one test per supported site.
 *
 * Adapter rot is the failure mode that produces one-star reviews in this
 * category: a site ships a redesign, the composer selector stops matching, and
 * the extension silently does nothing for everyone until somebody complains.
 * These fixtures are saved snapshots, so they will themselves go stale — that
 * is expected, and the weekly selector-drift job in CI is what turns the rot
 * into a failing build instead of a support queue.
 *
 * What each case asserts is deliberately narrow: the adapter finds *a*
 * composer, identifies the right engine for it, finds the submit button it
 * promises never to click, and can round-trip text through it.
 */

const HARNESS = '/e2e/.build/harness.js';

interface AdapterCase {
  id: string;
  fixture: string;
  /** A URL the adapter must claim, so match patterns are covered too. */
  url: string;
  /** What the composer should look like once resolved. */
  expect: { tag: string; engine: string; elementId?: string | null };
  submitLabel: string | null;
}

const CASES: AdapterCase[] = [
  {
    id: 'claude',
    fixture: '/fixtures/claude.html',
    url: 'https://claude.ai/chat/abc',
    expect: { tag: 'DIV', engine: 'prosemirror' },
    submitLabel: 'Send message',
  },
  {
    id: 'chatgpt',
    fixture: '/fixtures/chatgpt.html',
    url: 'https://chatgpt.com/',
    expect: { tag: 'DIV', engine: 'prosemirror', elementId: 'prompt-textarea' },
    submitLabel: 'Send prompt',
  },
  {
    id: 'gemini',
    fixture: '/fixtures/gemini.html',
    url: 'https://gemini.google.com/app',
    expect: { tag: 'DIV', engine: 'quill' },
    submitLabel: 'Send message',
  },
  {
    id: 'perplexity',
    fixture: '/fixtures/perplexity.html',
    url: 'https://www.perplexity.ai/search/x',
    expect: { tag: 'DIV', engine: 'lexical' },
    submitLabel: 'Submit',
  },
  {
    id: 'aistudio',
    fixture: '/fixtures/aistudio.html',
    url: 'https://aistudio.google.com/prompts/new_chat',
    expect: { tag: 'TEXTAREA', engine: 'textarea' },
    submitLabel: 'Run',
  },
];

async function boot(page: Page, fixture: string) {
  await page.goto(fixture);
  await page.addScriptTag({ url: HARNESS });
  await page.waitForFunction(() => typeof window.__forgeAdapters === 'object');
}

for (const site of CASES) {
  test.describe(site.id, () => {
    test('claims its own URLs and no one else\'s', async ({ page }) => {
      await boot(page, site.fixture);

      const claimed = await page.evaluate((url) => window.__forgeAdapters.idFor(url), site.url);
      expect(claimed).toBe(site.id);

      // A lookalike hostname must not be claimed by anyone. `endsWith` on a
      // dotted suffix rather than `includes`, or `claude.ai.evil.com` gets an
      // adapter and a widget on somebody's phishing page.
      const lookalike = await page.evaluate(
        (url) => window.__forgeAdapters.idFor(url),
        site.url.replace(/^https:\/\/([^/]+)/, 'https://$1.evil.example'),
      );
      expect(lookalike).toBeNull();
    });

    test('resolves the composer and identifies its engine', async ({ page }) => {
      await boot(page, site.fixture);

      const probe = await page.evaluate((id) => window.__forgeAdapters.probe(id), site.id);

      expect(probe.found, `${site.id}: composer selector chain matched nothing`).toBe(true);
      expect(probe.tag).toBe(site.expect.tag);
      expect(probe.engine).toBe(site.expect.engine);
      if (site.expect.elementId !== undefined) expect(probe.elementId).toBe(site.expect.elementId);
    });

    test('finds the submit button it promises never to click', async ({ page }) => {
      await boot(page, site.fixture);

      const probe = await page.evaluate((id) => window.__forgeAdapters.probe(id), site.id);
      expect(probe.submit).toBe(site.submitLabel);
    });

    test('round-trips text through the composer', async ({ page }) => {
      await boot(page, site.fixture);

      const text = `probe for ${site.id}: the quick brown fox`;
      const result = await page.evaluate(
        ({ id, text }) => window.__forgeAdapters.roundTrip(id, text),
        { id: site.id, text },
      );

      expect(result.ok).toBe(true);
      expect(result.read?.trim()).toBe(text);
    });
  });
}
