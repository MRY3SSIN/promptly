/**
 * MV3 service worker.
 *
 * This worker is terminated after 30 seconds idle, so it holds no state. Every
 * value that must survive lives in `chrome.storage`; anything cached in a
 * module-level variable here is a bug waiting for a slow afternoon.
 *
 * In M1 its only job is relaying the keyboard command, because `chrome.commands`
 * fires here and nowhere else. From M4 it also owns the auth token and the
 * streaming port, so that the content script — which runs inside a page we do
 * not control — never sees a credential.
 */

export default defineBackground(() => {
  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== 'open-panel') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await browser.tabs.sendMessage(tab.id, { type: 'forge:open-panel' });
    } catch {
      // No content script on this tab — the user pressed the shortcut
      // somewhere we do not run. Nothing to do and nothing to report.
    }
  });
});
