# Forge

Grammarly for AI prompts. A browser extension that watches you type into an AI
chat interface and helps you write a better prompt.

Two layers, and the distinction between them is the product:

- **Layer 1 — local analysis.** Free, instant, offline. As you type, an
  anchored widget shows a prompt-quality score and a count of detected issues,
  computed entirely in the content script by deterministic rules in under 5ms.
  No prompt text ever leaves the browser.
- **Layer 2 — LLM rewrite.** Only when you click *Improve*. The prompt goes to
  our backend, is rewritten against a prompt-engineering framework, and streams
  back into a preview panel with a diff. It never fires automatically: not on
  blur, not on a timer, not on Enter.

## Layout

```
extension/     the browser extension (WXT · MV3 · React · TypeScript)
backend/       Vercel Edge Functions + Supabase          (M4)
web/           marketing, dashboard, Stripe              (M6)
```

## Status

| Milestone | Scope | State |
|---|---|---|
| M1 | Skeleton and anchoring | **done** |
| M2 | Read and write across four editor engines | not started |
| M3 | Local analysis: 12 rules, intent, scoring | not started |
| M4 | Backend and streaming rewrite | not started |
| M5 | Clarification, frameworks, polish | not started |
| M6 | Monetization and store | not started |

## Working on it

```bash
cd extension
pnpm install
pnpm dev            # loads into Chrome with HMR
pnpm check          # typecheck + unit tests + e2e
pnpm test:soak      # the 60-second anchoring soak
```

See [`extension/README.md`](extension/README.md) for how the anchoring engine
works and why it is shaped the way it is.
