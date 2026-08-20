import { claudeAdapter } from './claude';
import type { SiteAdapter } from './types';

/**
 * Adapter lookup.
 *
 * Order matters: the first adapter whose `matches` returns true wins, so
 * hand-written adapters must precede any fallback. The generic heuristic
 * adapter is intentionally absent from this list — it is opt-in per domain
 * and gets resolved separately (M2), never as an implicit default.
 */
const ADAPTERS: readonly SiteAdapter[] = [claudeAdapter];

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

export function listAdapters(): readonly SiteAdapter[] {
  return ADAPTERS;
}
