import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,

  manifest: {
    name: 'Forge — Prompt Quality',
    short_name: 'Forge',
    description:
      'Scores your prompt as you type, entirely on your machine, and rewrites it on request.',
    version: '0.1.0',

    /*
     * Every permission here has to be justified in the store listing, and the
     * single-purpose policy is the most common rejection cause in this
     * category. So: no `<all_urls>`, no `tabs`, no `webRequest`.
     *
     *   storage    — settings, quota cache, dismissed rules. Nothing else is
     *                allowed to hold state, since MV3 kills the worker at 30s.
     *   activeTab  — lets the popup act on the tab the user is looking at.
     *   scripting  — re-injection after an extension update, without which the
     *                widget silently dies on every already-open tab.
     */
    permissions: ['storage', 'activeTab', 'scripting'],

    /*
     * Scoped to the sites we ship a hand-written adapter for. Additional
     * domains are requested through `optional_host_permissions` at the moment
     * the user enables them, never up front.
     */
    host_permissions: ['https://claude.ai/*'],
    optional_host_permissions: ['https://*/*'],

    commands: {
      'open-panel': {
        suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
        description: 'Open the Forge prompt panel',
      },
    },
  },

  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      /*
       * Force the bundled typefaces inline as data URIs. A content script
       * cannot resolve a relative asset URL — it would resolve against the
       * host page's origin, not the extension's — and the alternative,
       * `web_accessible_resources`, makes our fonts fetchable and
       * fingerprintable by any page. Inlining costs ~60KB and removes the
       * whole class of problem.
       */
      assetsInlineLimit: (filePath: string, content: Buffer) => {
        if (/\.woff2?$/i.test(filePath)) return true;
        return content.length < 4096;
      },
    },
  }),
});
