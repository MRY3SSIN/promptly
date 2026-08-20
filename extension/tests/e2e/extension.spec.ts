import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the real built extension into Chromium and checks it on a page served
 * at the origin its manifest actually matches.
 *
 * The anchor spec exercises the engine through a harness bundle; this one
 * exercises the shipped artefact — manifest match patterns, the MV3 service
 * worker, shadow-root mounting, and the inlined stylesheet. Those only fail
 * once everything is assembled, which is exactly when a harness test cannot
 * see them.
 *
 * `claude.ai` is intercepted and fulfilled with the saved fixture, so the URL
 * matches the manifest while the markup stays the deterministic snapshot.
 */

const EXTENSION_PATH = resolve(import.meta.dirname, '../../.output/chrome-mv3');
const FIXTURE_HTML = readFileSync(resolve(import.meta.dirname, '../fixtures/claude.html'), 'utf8');

const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
      viewport: { width: 1280, height: 800 },
    });

    await context.route('https://claude.ai/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML }),
    );

    await use(context);
    await context.close();
  },
  // The default `page` fixture would open its own context.
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

test.describe('built extension', () => {
  test('mounts on claude.ai and anchors to the composer', async ({ page }) => {
    await page.goto('https://claude.ai/chat/test');

    // The widget only appears once the composer has focus or holds text.
    await page.click('div.ProseMirror');

    const host = page.locator('[data-forge-host]');
    await expect(host).toHaveCount(1);

    await page.waitForFunction(
      () => document.querySelector<HTMLElement>('[data-forge-host]')?.style.visibility === 'visible',
      undefined,
      { timeout: 10_000 },
    );

    const placed = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-forge-host]')!;
      const composer = document.querySelector('div.ProseMirror')!;
      const h = el.getBoundingClientRect();
      const c = composer.getBoundingClientRect();
      return {
        // Anchored inside the composer's bottom-right, per the Claude adapter.
        dx: Math.round(h.right - c.right),
        dy: Math.round(h.bottom - c.bottom),
        size: { w: Math.round(h.width), h: Math.round(h.height) },
        hasShadow: el.shadowRoot != null,
      };
    });

    expect(placed.dx).toBe(-8);
    expect(placed.dy).toBe(-8);
    expect(placed.size).toEqual({ w: 22, h: 22 });
    expect(placed.hasShadow).toBe(true);
  });

  test('keeps its styles and fonts inside the shadow root', async ({ page }) => {
    await page.goto('https://claude.ai/chat/test');
    await page.click('div.ProseMirror');
    await page.locator('[data-forge-host]').waitFor({ state: 'attached' });

    const leakage = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('[data-forge-host]')!;
      const shadowCss = [...host.shadowRoot!.querySelectorAll('style')]
        .map((s) => s.textContent ?? '')
        .join('');
      return {
        // The fixture ships one <style>; nothing of ours may join it, which is
        // what WXT's shadow-root helper would have done with our @font-face.
        pageStyleSheets: document.querySelectorAll('style, link[rel="stylesheet"]').length,
        /*
         * Our typefaces must not be registered in the page's font registry.
         * Enumerating the set rather than calling `document.fonts.check()`:
         * `check` reports true when the family is absent and a fallback would
         * be substituted, so it answers "can this text be painted", not "does
         * the page have this font" — and it passes either way.
         */
        pageFontFamilies: [...document.fonts].map((f) => f.family),
        shadowHasFontFace: shadowCss.includes('@font-face'),
        shadowHasInlinedFont: shadowCss.includes('data:font/woff2;base64'),
        shadowReferencesCdn: /fonts\.(googleapis|gstatic)\.com/.test(shadowCss),
      };
    });

    expect(leakage.pageStyleSheets).toBe(1);
    expect(leakage.pageFontFamilies).toEqual([]);
    expect(leakage.shadowHasFontFace).toBe(true);
    expect(leakage.shadowHasInlinedFont).toBe(true);
    expect(leakage.shadowReferencesCdn).toBe(false);
  });

  test('issues no network request while the user types', async ({ page }) => {
    await page.goto('https://claude.ai/chat/test');
    await page.click('div.ProseMirror');
    await page.locator('[data-forge-host]').waitFor({ state: 'attached' });

    // Layer 1 is local, offline and free. Anything leaving the browser on a
    // keystroke is the single worst bug this product could ship.
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));

    await page.type('div.ProseMirror', 'Write me something good about the thing', { delay: 15 });
    await page.waitForTimeout(1500);

    expect(requests).toEqual([]);
  });

  test('leaves the composer subtree untouched', async ({ page }) => {
    await page.goto('https://claude.ai/chat/test');

    const before = await page.evaluate(
      () => document.querySelector('div.ProseMirror')!.innerHTML,
    );

    await page.click('div.ProseMirror');
    await page.locator('[data-forge-host]').waitFor({ state: 'attached' });
    await page.waitForTimeout(1200);

    const after = await page.evaluate(() => {
      const composer = document.querySelector('div.ProseMirror')!;
      return {
        html: composer.innerHTML,
        // Rich text editors treat their subtree as private state; a node of
        // ours inside it corrupts the editor's model of the user's text.
        injectedNodes: composer.querySelectorAll('[data-forge-host]').length,
      };
    });

    expect(after.html).toBe(before);
    expect(after.injectedNodes).toBe(0);
  });
});
