import { aiStudioAdapter } from './aistudio';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import { genericAdapter } from './generic';
import { perplexityAdapter } from './perplexity';
import type { SiteAdapter } from './types';

/**
 * Adapter lookup.
 *
 * Order matters: the first adapter whose `matches` returns true wins.
 *
 * The generic heuristic adapter is deliberately absent from this list. It
 * cannot be reached by matching a URL at all — `resolveAdapter` returns null
 * for an unknown site, and a caller who wants the fallback has to ask for it by
 * name, having first checked that the user enabled it for that exact hostname.
 * Making it unreachable by accident is the point: a heuristic that guesses
 * which box holds your draft is one wrong guess away from destroying it.
 */
const ADAPTERS: readonly SiteAdapter[] = [
  claudeAdapter,
  chatgptAdapter,
  geminiAdapter,
  perplexityAdapter,
  aiStudioAdapter,
];

export function resolveAdapter(url: URL = new URL(location.href)): SiteAdapter | null {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.matches(url)) return adapter;
    } catch {
      // A throwing matcher is a bug in that adapter, not a reason to give up
      // on the rest of the registry.
    }
  }
  return null;
}

/**
 * The hand-written adapter for this URL, or the generic fallback when — and
 * only when — the user has switched it on for this hostname.
 */
export function resolveAdapterWithFallback(
  url: URL,
  genericAllowed: boolean,
): SiteAdapter | null {
  return resolveAdapter(url) ?? (genericAllowed ? genericAdapter : null);
}

export function listAdapters(): readonly SiteAdapter[] {
  return ADAPTERS;
}

export { genericAdapter };
