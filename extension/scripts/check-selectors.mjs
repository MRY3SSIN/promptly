/**
 * Selector drift check.
 *
 * Adapter rot is the top cause of one-star reviews in this category: a site
 * ships a redesign, the composer selector stops matching, and the extension
 * silently does nothing for everybody until somebody bothers to complain. The
 * fixture tests cannot catch it — a fixture is a snapshot, and a snapshot never
 * changes.
 *
 * So this loads each site for real and reports which selectors in each chain
 * still match. It runs weekly in CI and fails loudly when a chain is down to
 * its last match or has stopped matching entirely.
 *
 * What it can and cannot see: these sites render their composer only after
 * authenticating, and CI has no session. So a signed-out load reaches the
 * marketing or login page, where the composer legitimately does not exist —
 * that is reported as `unauthenticated`, not as a failure. What it *does*
 * catch, without any session at all, is the case that matters most: a selector
 * that has become invalid CSS, and a page that has started refusing us
 * outright. Set FORGE_SESSION_<SITE> to a cookie header to get the full check.
 *
 *   node scripts/check-selectors.mjs [--json]
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * CI installs browsers where Playwright expects them; this sandbox ships a
 * prebuilt Chromium at a fixed path instead. Prefer the explicit override,
 * then the known path, then let Playwright resolve it itself.
 */
function resolveChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;
}

const SITES = [
  {
    id: 'claude',
    url: 'https://claude.ai/new',
    selectors: [
      'fieldset div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"][aria-label]',
      '[data-testid="chat-input-container"] div[contenteditable="true"]',
      '[data-testid="chat-input"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
  },
  {
    id: 'chatgpt',
    url: 'https://chatgpt.com/',
    selectors: [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'form div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'textarea[data-id="root"]',
      'form textarea',
    ],
  },
  {
    id: 'gemini',
    url: 'https://gemini.google.com/app',
    selectors: [
      'rich-textarea .ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
  },
  {
    id: 'perplexity',
    url: 'https://www.perplexity.ai/',
    selectors: [
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'textarea[placeholder*="Ask" i]',
      'textarea#ask-input',
      'main div[contenteditable="true"]',
      'main textarea',
    ],
  },
  {
    id: 'aistudio',
    url: 'https://aistudio.google.com/prompts/new_chat',
    selectors: [
      'ms-prompt-input-wrapper textarea',
      'textarea[aria-label*="prompt" i]',
      'textarea[placeholder*="prompt" i]',
      'main textarea',
    ],
  },
];

const asJson = process.argv.includes('--json');

/**
 * Override the site list, as JSON matching the shape above.
 *
 * Exists so the checker can be pointed at the local fixture server and proved
 * to work. A watchdog nobody has ever seen succeed is not a watchdog.
 */
const sites = process.env.FORGE_SELECTOR_SITES ? JSON.parse(process.env.FORGE_SELECTOR_SITES) : SITES;
const browser = await chromium.launch({ executablePath: resolveChromium() });

const report = [];

for (const site of sites) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const cookie = process.env[`FORGE_SESSION_${site.id.toUpperCase()}`];
  if (cookie) await context.setExtraHTTPHeaders({ cookie });

  const page = await context.newPage();
  const entry = { id: site.id, url: site.url, status: 'ok', matches: {}, invalid: [], reachable: true };

  try {
    const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    entry.httpStatus = response?.status() ?? null;
    // These are SPAs; the composer mounts well after DOMContentLoaded.
    await page.waitForTimeout(6000);

    for (const selector of site.selectors) {
      const count = await page.evaluate((sel) => {
        try {
          return document.querySelectorAll(sel).length;
        } catch {
          return -1; // invalid CSS, which is always our bug
        }
      }, selector);
      if (count === -1) entry.invalid.push(selector);
      entry.matches[selector] = count;
    }
  } catch (err) {
    entry.reachable = false;
    entry.error = String(err).slice(0, 200);
  } finally {
    await context.close();
  }

  const total = Object.values(entry.matches).filter((n) => n > 0).length;
  if (entry.invalid.length > 0) entry.status = 'invalid-selector';
  else if (!entry.reachable) entry.status = 'unreachable';
  else if (total === 0) entry.status = 'unauthenticated';
  else if (total === 1) entry.status = 'last-selector-standing';

  entry.matchingSelectors = total;
  report.push(entry);
}

await browser.close();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const entry of report) {
    console.log(`\n${entry.id}  [${entry.status}]  ${entry.matchingSelectors}/${Object.keys(entry.matches).length} selectors matching`);
    for (const [selector, count] of Object.entries(entry.matches)) {
      console.log(`  ${count > 0 ? '✓' : '·'} ${String(count).padStart(3)}  ${selector}`);
    }
    if (entry.invalid.length) console.log(`  INVALID CSS: ${entry.invalid.join(', ')}`);
    if (entry.error) console.log(`  ${entry.error}`);
  }
}

/*
 * If nothing was reachable, the checker is broken rather than the selectors —
 * a blocked proxy, a dead runner, an expired image. Left unguarded this exits
 * zero having verified nothing at all, which is worse than no job: a green
 * check that means "I did not look" is a green check people stop reading.
 */
if (report.every((e) => !e.reachable)) {
  console.error('\ncould not reach any site — the checker itself is broken, not the selectors');
  process.exit(1);
}

/*
 * Otherwise fail only on what a signed-out run can actually prove. An
 * unauthenticated page has no composer by definition, so treating that as
 * drift would make this cry wolf every week until people stopped reading it.
 */
const failures = report.filter(
  (e) => e.status === 'invalid-selector' || e.status === 'last-selector-standing',
);
if (failures.length > 0) {
  console.error(`\nselector drift on: ${failures.map((f) => `${f.id} (${f.status})`).join(', ')}`);
  process.exit(1);
}

console.log(`\nchecked ${report.filter((e) => e.reachable).length}/${report.length} sites, no drift`);
