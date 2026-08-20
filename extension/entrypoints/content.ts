import { resolveAdapter } from '../src/adapters/registry';
import { ForgeController } from '../src/content/ForgeController';
import { mountWidget } from '../src/ui/mountWidget';
import { ScoreHalo } from '../src/ui/ScoreHalo';
import { widgetStore } from '../src/store/widgetStore';
import { log } from '../src/util/logger';
import { createElement } from 'react';

/*
 * The stylesheet is imported as a string rather than emitted as a file we
 * fetch at runtime. That keeps the shadow root's styles out of
 * `web_accessible_resources` entirely — nothing about our UI is reachable
 * from the page — and means the widget has no network dependency at all,
 * not even a local one.
 */
import cssText from '../src/ui/style.css?inline';

export default defineContentScript({
  // M1 ships on Claude only. Each additional site lands with its own
  // hand-written adapter and its own fixture test, never as a wildcard.
  matches: ['*://claude.ai/*'],
  // Styles belong to the shadow root; nothing is injected into the page.
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  main() {
    const adapter = resolveAdapter(new URL(location.href));
    if (!adapter) {
      log.debug('no adapter for this origin');
      return;
    }

    // Site-level opt-out, mirroring the `data-gramm` convention. Checked
    // before we touch the DOM at all.
    if (document.documentElement.getAttribute('data-forge') === 'false') {
      log.debug('site opted out via data-forge="false"');
      return;
    }

    const widget = mountWidget(cssText, createElement(ScoreHalo));
    const controller = new ForgeController({ adapter, widget });
    controller.start();

    /*
     * M1 placeholder. The analyzer arrives in M3; until then the halo shows a
     * fixed score so the anchoring work is actually visible — an idle ring
     * with an empty arc is hard to tell apart from a widget that failed to
     * mount. Delete this block when `analyze()` starts feeding the store.
     */
    widgetStore.getState().setScore(64, 3);

    log.info(`active on ${adapter.label}`);
  },
});
