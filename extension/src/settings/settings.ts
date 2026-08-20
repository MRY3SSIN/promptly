import { storage } from 'wxt/utils/storage';

/**
 * User settings.
 *
 * Two rules shape this file.
 *
 * The service worker is terminated after 30 seconds idle, so nothing may live
 * in a module variable there and be trusted later. Storage is the only durable
 * state, and every consumer reads it rather than caching it across events.
 *
 * And migrations ship from the first version, not from the first time we need
 * one. Changing a schema after launch without a migration path silently breaks
 * settings for existing installs, and there is no way to apologise for that in
 * a Chrome Web Store update.
 */

export const SETTINGS_VERSION = 1;

export interface ForgeSettings {
  /** Suspends the extension everywhere without uninstalling it. */
  globalPause: boolean;

  /**
   * Hostnames where the widget is switched off, matched exactly. Per-site kill
   * switch — a user who wants us on ChatGPT but not on their company's internal
   * Claude deployment should not have to choose.
   */
  disabledHosts: string[];

  /**
   * Hostnames where the generic heuristic adapter is allowed to run.
   *
   * Empty by default and it must stay that way. A "find the biggest
   * contenteditable" guess is right often enough to be tempting and wrong often
   * enough to corrupt somebody's draft, so it runs only where a user has
   * explicitly asked for it, one domain at a time.
   */
  genericEnabledHosts: string[];

  /** Prompt bodies are never retained server-side. On by default. */
  zeroRetention: boolean;

  /** Overrides the framework the rewrite pipeline picks. M5. */
  preferredFramework: string | null;
}

export const DEFAULT_SETTINGS: ForgeSettings = {
  globalPause: false,
  disabledHosts: [],
  genericEnabledHosts: [],
  zeroRetention: true,
  preferredFramework: null,
};

export const settingsItem = storage.defineItem<ForgeSettings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
  version: SETTINGS_VERSION,
  migrations: {
    /*
     * v1 is the first shipped schema, so there is nothing to migrate to it yet
     * — this entry exists so the mechanism is wired, tested and proven before
     * the first schema change rather than during it. Later versions add their
     * own numbered entry here and WXT runs them in order on extension update.
     */
    1: (old: Partial<ForgeSettings> | null): ForgeSettings => ({ ...DEFAULT_SETTINGS, ...(old ?? {}) }),
  },
});

export async function getSettings(): Promise<ForgeSettings> {
  try {
    return await settingsItem.getValue();
  } catch {
    // A corrupt or unavailable store must not take the extension down with it.
    return DEFAULT_SETTINGS;
  }
}

export async function patchSettings(patch: Partial<ForgeSettings>): Promise<ForgeSettings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

export function watchSettings(cb: (settings: ForgeSettings) => void): () => void {
  return settingsItem.watch((value) => cb(value ?? DEFAULT_SETTINGS));
}

/** Should we run on this page at all? */
export function isEnabledFor(settings: ForgeSettings, url: URL): boolean {
  if (settings.globalPause) return false;
  return !settings.disabledHosts.includes(url.hostname);
}

export function isGenericAllowedFor(settings: ForgeSettings, url: URL): boolean {
  return settings.genericEnabledHosts.includes(url.hostname);
}
