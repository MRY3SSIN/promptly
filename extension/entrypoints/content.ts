import { createElement } from 'react';
import { resolveAdapterWithFallback } from '../src/adapters/registry';
import { ForgeController } from '../src/content/ForgeController';
import { getSettings, isEnabledFor, isGenericAllowedFor } from '../src/settings/settings';
import { widgetStore } from '../src/store/widgetStore';
import { mountWidget } from '../src/ui/mountWidget';
import { WidgetRoot } from '../src/ui/WidgetRoot';
import { log } from '../src/util/logger';

/*
 * The stylesheet is imported as a string rather than emitted as a file we
 * fetch at runtime. That keeps the shadow root's styles out of
 * `web_accessible_resources` entirely — nothing about our UI is reachable
 * from the page — and means the widget has no network dependency at all,
 * not even a local one.
 */
import cssText from '../src/ui/style.css?inline';

export default defineContentScript({
  /*
   * One entry per site we ship a hand-written adapter for. Never a wildcard:
   * `host_permissions` has to match this list, and a wildcard there is the
   * fastest way to fail the Chrome Web Store's single-purpose review.
   *
   * Sites the user opts into for the generic fallback are granted at runtime
   * through `optional_host_permissions`, one domain at a time.
   */
  matches: [
    '*://claude.ai/*',
    '*://chatgpt.com/*',
    '*://chat.openai.com/*',
    '*://gemini.google.com/*',
    '*://*.perplexity.ai/*',
    '*://aistudio.google.com/*',
  ],
  // Styles belong to the shadow root; nothing is injected into the page.
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main() {
    const url = new URL(location.href);

    // Site-level opt-out, mirroring the `data-gramm` convention. Checked
    // before we touch the DOM at all.
    if (document.documentElement.getAttribute('data-forge') === 'false') {
      log.debug('site opted out via data-forge="false"');
      return;
    }

    /*
     * Settings are read from storage on every page load rather than cached in
     * the service worker, which MV3 terminates after 30 seconds idle. The
     * global pause and the per-site kill switch both have to be honoured
     * before anything is mounted — a "paused" extension that still appends its
     * host element has not really paused.
     */
    const settings = await getSettings();
    if (!isEnabledFor(settings, url)) {
      log.debug('disabled here by settings');
      return;
    }

    const adapter = resolveAdapterWithFallback(url, isGenericAllowedFor(settings, url));
    if (!adapter) {
      log.debug('no adapter for this origin');
      return;
    }

    const widget = mountWidget(cssText, createElement(WidgetRoot, { adapter }));
    const controller = new ForgeController({ adapter, widget });
    controller.start();

    /*
     * M1/M2 placeholder. The analyzer arrives in M3; until then the halo shows
     * a fixed score so the anchoring and IO work is visible — an idle ring with
     * an empty arc is hard to tell apart from a widget that failed to mount.
     * Delete this line when `analyze()` starts feeding the store.
     */
    widgetStore.getState().setScore(64, 3);

    log.info(`active on ${adapter.label}`);
  },
});
