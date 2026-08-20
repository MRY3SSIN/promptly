# Forge — extension

WXT · MV3 · React 18 · TypeScript (strict) · Tailwind · Zustand.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Chrome with HMR |
| `pnpm build` | Production bundle into `.output/chrome-mv3` |
| `pnpm compile` | `tsc --noEmit` |
| `pnpm test` | Vitest unit suite |
| `pnpm test:e2e` | Playwright: anchoring + built-extension suites |
| `pnpm test:soak` | The 60-second anchoring soak |
| `pnpm icons` | Regenerate `public/icon/*.png` from the design tokens |

## What M1 established

### One element, and nothing else

The extension's entire footprint on the host page is a single `<div>` appended
to the end of `<body>`, with everything else sealed in its shadow root. That is
enforced by a test, not by discipline.

The shadow root is mounted by hand in `src/ui/mountWidget.tsx` rather than via
WXT's `createShadowRootUi`. That helper splits `@font-face` and `@property`
rules out of the shadow CSS and appends them as a second `<style>` in
`document.head` — a second node in someone else's document, and a registration
of our two typefaces in the *page's* font registry, where the page can use and
detect them. Chromium honours `@font-face` inside a shadow root (verified
against the bundled Chromium and asserted in `tests/e2e/extension.spec.ts`), so
the split costs isolation and buys nothing.

Both typefaces are inlined as data URIs at build time. No CDN request — these
sites' CSP would block it and it would leak a request per pageview — and no
`web_accessible_resources` entry, so nothing about our UI is reachable from the
page.

### Anchoring

There is no "this element moved" event in the platform, so `AnchorEngine`
synthesises one from seven signals, all funnelling into a single
`scheduleMeasure()`:

1. `ResizeObserver` on the composer **and its ancestor chain**
2. `IntersectionObserver` on the composer (its callback carries a free rect)
3. `scroll`, passive and capturing, on every scrollable ancestor
4. `window.resize` and `visualViewport` resize/scroll
5. `MutationObserver` scoped to the composer's grandparent
6. a 1000ms interval
7. a **position sentinel**: an `IntersectionObserver` re-framed around the
   composer's exact rect, so any movement at all drops its ratio below 1

Signals 1 (ancestors) and 7 were added during M1 because the six original ones
demonstrably could not hold the 1px budget. The case that forced it: Claude's
own side panel opens, every container between the composer and `<body>` gets
narrower, and the composer — still the same width inside a `max-width` form —
slides 140px sideways. It does not resize, does not scroll, does not change its
viewport intersection, and the mutation is on `body`, outside the narrowly
scoped observer. Signals 2–6 are all silent; the interval leaves the halo
visibly displaced for up to a second.

Watching ancestor resizes fixes it *in the same painted frame*, which matters:
`ResizeObserver` callbacks run inside the browser's rendering steps before
paint, while `IntersectionObserver` callbacks are delivered in a later task.
The sentinel is the backstop for a pure translation that resizes nothing, and
it costs one frame.

Reads and writes are separated by `LayoutBatcher`: every `getBoundingClientRect`
runs in a read phase, every `style.transform` in the write phase after it, both
in one frame. Position is written with `transform` only — never `top`/`left` —
so it stays on the compositor.

The engine also flushes *synchronously* from `ResizeObserver` and sentinel
callbacks. That is not a violation of the batching rule: the browser has just
completed layout in order to deliver those callbacks, so the read is free and
the write still lands before paint. From a scroll handler the same call would
force a reflow, which is why `flushSync` is documented as forbidden there.

### What the tests actually assert

`tests/e2e/anchor.spec.ts` drives the real engine against a saved Claude DOM
fixture:

- **Drift** ≤ 1px from the settled composer-relative offset, over 60 seconds of
  interaction. Measuring the *offset* rather than an absolute position is what
  keeps this from re-implementing the placement solver it is checking.

  Samples are judged only where the composer held still since the previous
  sample. There is no API for "read the state that was just painted": the
  sampler runs in a task after the frame, and a layout change driven from the
  test process can be applied by the browser between that frame and the task,
  so the sampler compares a moved composer against a transform computed for
  where it used to be — drift for a frame that was never rendered. That was
  confirmed directly rather than assumed: at a reported 62px peak, the engine's
  committed placement matched the widget's actual position exactly, and the
  only stale value was the composer rect the engine had not been told about
  yet. The test asserts that most samples survive the gate, so it cannot go
  vacuous, and logs the transient peak so mid-motion regressions stay visible.
- **No forced reflow**, checked structurally rather than by scraping Chrome's
  console heuristic: instrumentation counts every `getBoundingClientRect` and
  `getComputedStyle` taken outside a batched flush, and the count must be zero.
- **Transform only**, **one element**, **clipping**, **composer replacement**,
  and **suspension while the tab is hidden**.

Page-local mutations in that suite are driven from inside the page's own
animation frame, one per frame. Driving them from the test process instead
produced phantom drift of up to 280px: a `page.evaluate` runs as its own task,
so a mutation can land between the last paint and the sampler, and the sampler
then compares a moved composer against a frame that was never rendered. Two of
M1's three "failures" were that artefact; the third was real.

`tests/e2e/extension.spec.ts` loads the **built** extension into Chromium with
`claude.ai` intercepted and served the fixture, so the manifest match pattern,
the service worker and the shadow-root mount are exercised as shipped. It also
asserts the two privacy claims directly: zero network requests while typing,
and zero nodes injected into the composer's subtree.

### Dodging the site's own controls

`avoidSelectors` keeps the halo off Claude's send and attach buttons. The
decision is a Schmitt trigger, not a threshold, because engaging it costs a
~50px sideways move and the halo rests only a few pixels above the button row:
a bare threshold turns pixel-level layout noise into a visible hop back and
forth. Two details make it stable — the collision is tested from the widget's
*undisplaced* position (testing from where it currently sits is a feedback
loop, since a widget that moved to avoid a button no longer overlaps it), and
the release margin applies to the decision while the destination is computed
from the raw zone, so the resting position is the same whether it just engaged
or has been engaged for a while.

`tests/unit/placement.test.ts` jitters the composer around the crossing point
and asserts a single transition. An earlier version of that test *swept* across
the boundary instead, which passes against the broken implementation — a sweep
is satisfied by one transition in each direction. Jitter is what the real
failure looks like.

## Known limits

- Composer selectors are written against the structure in
  `tests/fixtures/claude.html` and have **not** been verified against a live
  authenticated claude.ai session — that needs a signed-in browser. Each
  adapter declares an ordered fallback chain, and the weekly selector-drift job
  (M2) is what will make rot visible rather than silent.
- A pure translation that resizes no ancestor is corrected one frame late, via
  the position sentinel. No pre-paint signal exists for that case, and it is
  why the drift test judges only samples where the composer held still.
- **The halo overlaps the end of a long single-line prompt on Claude.**
  Confirmed against the live site. Claude's `div.ProseMirror` *is* the text
  line — the `+ / Chat / Cowork / model / mic / send` row is a sibling below it
  — so the composer's bottom-right corner falls at the end of the user's text
  rather than in padding. It is the Grammarly pattern, but it bites harder
  here. Dropping into the control row was tried and reverted in M1: it put the
  widget on the boundary of the avoid-zone test, which made the position
  bistable. That is now fixed by the Schmitt trigger, so the placement is worth
  revisiting in M5 with real measurements of Claude's live layout rather than a
  third guess at the geometry.
- Clicking the halo does nothing yet, and the hover label says "Improve"
  regardless. `content.ts` mounts `ScoreHalo` with no `onOpen`, because there
  is nothing to open until `IssuePopover` (M3) and `RewritePanel` (M4).
