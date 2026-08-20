import { expect, test, type Page } from '@playwright/test';

/**
 * M1's done-criteria, as executable tests.
 *
 *   "the halo never drifts more than 1px during 60 seconds of aggressive
 *    interaction, and Performance profiling shows no forced-reflow warnings"
 *
 * Drift is measured as deviation from the settled composer-relative offset —
 * that is what "glued" means, and measuring the offset rather than an absolute
 * position keeps the test from re-implementing the placement solver it is
 * supposed to be checking.
 *
 * The forced-reflow half is checked structurally rather than by scraping
 * Chrome's console heuristic: the harness patches `getBoundingClientRect` and
 * `getComputedStyle` and counts calls that happen outside an animation frame.
 * Zero out-of-frame reads is the property the warning is a proxy for.
 */

const FIXTURE = '/fixtures/claude.html';
const HARNESS = '/e2e/.build/harness.js';

/** Max allowed deviation from the settled offset. */
const DRIFT_BUDGET_PX = 1;

async function boot(page: Page) {
  await page.goto(FIXTURE);
  await page.addScriptTag({ url: HARNESS });
  await page.evaluate(() => window.__forge.start());
  // Let the first measurement land and the fonts settle.
  await page.waitForFunction(() => {
    const host = document.querySelector<HTMLElement>('[data-forge-host]');
    return host?.style.visibility === 'visible';
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__forge.reset();
    window.__forge.baseline();
  });
}

test.describe('AnchorEngine', () => {
  test('mounts exactly one element and adds nothing else to the page', async ({ page }) => {
    await boot(page);

    const footprint = await page.evaluate(() => {
      const host = document.querySelector('[data-forge-host]');
      return {
        hosts: document.querySelectorAll('[data-forge-host]').length,
        tagName: host?.tagName ?? null,
        isLastChildOfBody: document.body.lastElementChild === host,
        // Nothing of ours may reach <head> — that is where WXT's shadow-root
        // helper would have put our @font-face rules.
        headStyles: document.head.querySelectorAll('style').length,
        // The shadow root must be the only place our UI exists.
        shadowAttached: host?.shadowRoot != null,
        // Nothing injected inside the composer's subtree.
        nodesInsideComposer: document
          .querySelector('div.ProseMirror')!
          .querySelectorAll('[data-forge-host]').length,
      };
    });

    expect(footprint.hosts).toBe(1);
    expect(footprint.tagName).toBe('DIV');
    expect(footprint.isLastChildOfBody).toBe(true);
    expect(footprint.shadowAttached).toBe(true);
    expect(footprint.nodesInsideComposer).toBe(0);
    // The fixture ships exactly one <style> of its own; we add none.
    expect(footprint.headStyles).toBe(1);
  });

  test('stays glued through aggressive interaction', async ({ page }) => {
    await boot(page);
    await aggressiveInteraction(page, 12_000);

    const report = await page.evaluate(() => window.__forge.report());

    expect(report.visibleSamples).toBeGreaterThan(200);
    expect(
      report.maxDrift,
      `geometry at drift peak: ${JSON.stringify(report.worstDetail)}`,
    ).toBeLessThanOrEqual(DRIFT_BUDGET_PX);
  });

  test('batches every layout read into an animation frame', async ({ page }) => {
    await boot(page);
    await aggressiveInteraction(page, 8_000);

    const report = await page.evaluate(() => window.__forge.report());

    // The engine measured — otherwise the zero below would be vacuous.
    expect(report.inFrameRectReads).toBeGreaterThan(50);
    expect(report.outOfFrameRectReads).toBe(0);
    expect(report.outOfFrameStyleReads).toBe(0);
  });

  test('positions with transform only, never top or left', async ({ page }) => {
    await boot(page);
    await aggressiveInteraction(page, 4_000);

    const report = await page.evaluate(() => window.__forge.report());
    expect(report.usedTopLeft).toBe(false);

    const inline = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('[data-forge-host]')!;
      return { top: host.style.top, left: host.style.left, transform: host.style.transform };
    });
    expect(inline.top).toBe('0px');
    expect(inline.left).toBe('0px');
    expect(inline.transform).toMatch(/translate3d\(/);
  });

  test('hides when the composer is scrolled out of its clipping ancestor', async ({ page }) => {
    await boot(page);

    // Squeeze the composer's own max-height wrapper down to a sliver. This is
    // the shape of the real failure: the composer element itself still has a
    // full-size rect, but almost none of it is on screen, so anchoring to its
    // bottom edge would put the halo somewhere the user cannot see.
    await page.evaluate(() => {
      const wrapper = document.querySelector<HTMLElement>('.composer-wrapper')!;
      wrapper.style.height = '4px';
    });
    await page.waitForTimeout(1200);

    const visibility = await page.evaluate(
      () => document.querySelector<HTMLElement>('[data-forge-host]')!.style.visibility,
    );
    expect(visibility).toBe('hidden');
  });

  test('recovers when the composer is replaced without a page load', async ({ page }) => {
    await boot(page);

    const before = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('[data-forge-host]')!;
      const composer = document.querySelector('div.ProseMirror')!;
      const h = host.getBoundingClientRect();
      const c = composer.getBoundingClientRect();
      return { dx: h.right - c.right, dy: h.bottom - c.bottom };
    });

    // These apps swap the composer node on navigation without a page load.
    // A detached element fires nothing, so re-resolution is the only recovery.
    await page.evaluate(() => {
      const old = document.querySelector('div.ProseMirror')!;
      const fresh = old.cloneNode(true) as HTMLElement;
      old.replaceWith(fresh);
    });

    // Recovery means landing back on the *same* offset from the new element,
    // which is a much tighter claim than landing somewhere nearby.
    await page.waitForFunction(
      (expected) => {
        const host = document.querySelector<HTMLElement>('[data-forge-host]');
        const composer = document.querySelector('div.ProseMirror');
        if (!host || !composer || host.style.visibility !== 'visible') return false;
        const h = host.getBoundingClientRect();
        const c = composer.getBoundingClientRect();
        return (
          Math.abs(h.right - c.right - expected.dx) <= 1 &&
          Math.abs(h.bottom - c.bottom - expected.dy) <= 1
        );
      },
      before,
      { timeout: 5000 },
    );
  });

  test('suspends its observers while the tab is hidden', async ({ page }) => {
    await boot(page);

    // `boot` zeroes the counters, so give the sampler a moment to record that
    // it is in fact running before we compare against the suspended state.
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => window.__forge.report());

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => window.__forge.reset());
    await page.waitForTimeout(3000);

    const during = await page.evaluate(() => window.__forge.report());
    // The harness's own sampler is excluded from these counters, so a
    // suspended engine should have measured nothing at all.
    expect(during.inFrameRectReads).toBe(0);
    expect(before.samples).toBeGreaterThan(0);
  });

  test('@soak holds alignment for a full minute', async ({ page }) => {
    test.slow();
    await boot(page);
    await aggressiveInteraction(page, 60_000);

    const report = await page.evaluate(() => window.__forge.report());
    expect(report.visibleSamples).toBeGreaterThan(1000);
    expect(
      report.maxDrift,
      `geometry at drift peak: ${JSON.stringify(report.worstDetail)}`,
    ).toBeLessThanOrEqual(DRIFT_BUDGET_PX);
    expect(report.outOfFrameRectReads).toBe(0);
    expect(report.usedTopLeft).toBe(false);
  });
});

/**
 * Everything that moves a composer on a real chat page, run far faster than a
 * human could.
 *
 * The page-local mutations — transcript scrolling, the side panel opening, the
 * composer growing as text is typed, the theme flipping — are driven from
 * inside the page's own animation frame, one per frame. Viewport resizes and
 * wheel scrolling are driven from here, because only the test process can do
 * them, and both deliver their events *before* animation frames so the engine
 * corrects within the same painted frame.
 */
async function aggressiveInteraction(page: Page, durationMs: number): Promise<void> {
  await page.evaluate(() => window.__forge.drive(true));

  const deadline = Date.now() + durationMs;
  let step = 0;
  while (Date.now() < deadline) {
    step += 1;
    if (step % 2 === 0) {
      await page.setViewportSize({
        width: 900 + ((step * 53) % 500),
        height: 700 + ((step * 31) % 300),
      });
    } else {
      await page.mouse.wheel(0, 240);
    }
    await page.waitForTimeout(80);
  }

  await page.evaluate(() => window.__forge.drive(false));
  // Let the last movement settle before the caller reads the report.
  await page.waitForTimeout(300);
}
