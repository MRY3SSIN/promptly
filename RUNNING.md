# Running Forge locally

The extension has to be loaded into a browser on your own machine, so the first
step is getting the branch there.

## 1. Get the code

```bash
git clone https://github.com/MRY3SSIN/promptly.git
cd promptly
git checkout claude/forge-browser-extension-ydz7pi
```

## 2. Install

Node 20+ and pnpm. If you don't have pnpm: `corepack enable` or
`npm i -g pnpm`.

```bash
cd extension
pnpm install
```

`pnpm install` runs `wxt prepare`, which generates the `.wxt/` types the
TypeScript config extends. If you skip it, `tsc` will complain about a missing
config — rerun `pnpm exec wxt prepare` and it goes away.

## 3. Run it

Two ways. Start with the second if the first gives you trouble.

### Dev mode — auto-reloads as you edit

```bash
pnpm dev
```

WXT builds to `.output/chrome-mv3-dev`, launches a fresh Chrome profile with
the extension already loaded, and hot-reloads on save. It needs a Chrome or
Chromium it can find; if it can't, use the manual path below.

### Manual — the reliable path

```bash
pnpm build
```

Then in Chrome:

1. `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `promptly/extension/.output/chrome-mv3`

Re-run `pnpm build` and hit the reload icon on the extension card after
changes.

## 4. See it working

Go to **claude.ai** and click into the message box.

A small ring appears just inside the composer's bottom-right corner, showing
`3`. That is the M1 placeholder score (64/100, 3 issues) — the real analyzer
lands in M3. Hover it and an "Improve" label slides out to the left.

What to try:

- **Scroll** the conversation, **resize** the window, **open Claude's
  sidebar**, **switch Claude between light and dark** — the ring should stay
  welded to the corner and re-theme itself.
- **Type** — it fades to 30% while keys are landing and comes back after a
  400ms pause.
- **Click away** — it disappears when the composer has neither focus nor text.
- Open DevTools → **Network**, type a long prompt. Nothing should be sent.
  Layer 1 is entirely local.

The panel and the `Cmd/Ctrl+Shift+K` shortcut are wired to the service worker
but have nothing to open yet — that is M4.

## If the ring never appears

Almost certainly a selector miss: the adapter's composer selectors were written
against a saved DOM fixture and have **not** been verified against a live,
signed-in claude.ai. Paste this into the DevTools console on claude.ai:

```js
[
  'fieldset div.ProseMirror[contenteditable="true"]',
  'div.ProseMirror[contenteditable="true"][aria-label]',
  '[data-testid="chat-input-container"] div[contenteditable="true"]',
  '[data-testid="chat-input"]',
  'div.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
].forEach((s) => console.log(document.querySelectorAll(s).length, s));
```

If every line is `0`, the selectors need updating — send me the output of
`document.querySelector('[contenteditable="true"]')?.outerHTML.slice(0, 400)`
and I will fix the chain.

Also check the console for `[forge]` lines: `active on Claude` means we
mounted, and a warning about no composer means the chain missed.

## Running the tests instead

No browser setup needed beyond Playwright's Chromium.

```bash
pnpm check      # typecheck + 64 unit tests + 11 e2e tests
pnpm test       # unit only, fast
pnpm test:e2e   # Playwright: anchoring + built-extension suites
pnpm test:soak  # the 60-second anchoring soak
```
