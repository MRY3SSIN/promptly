/**
 * The contract every supported site implements.
 *
 * There is deliberately no "find the biggest contenteditable" path here. Each
 * site gets hand-written selectors, because a heuristic that is right 90% of
 * the time is a heuristic that corrupts somebody's draft 10% of the time. The
 * generic adapter exists as an explicit, per-domain opt-in fallback only.
 */

/** Which editor engine backs the composer. This picks the write strategy. */
export type EditorEngine = 'prosemirror' | 'quill' | 'lexical' | 'textarea' | 'unknown';

export type AnchorCorner = 'bottom-right' | 'top-right';

export interface AnchorSpec {
  corner: AnchorCorner;
  /** Nudge from the chosen corner, in CSS pixels. Positive x moves right. */
  offset: { x: number; y: number };
  /**
   * Selectors for the site's own controls — send button, attachment tray,
   * model picker. The anchor solver treats their rects as no-go zones and
   * slides the widget clear rather than covering them.
   */
  avoidSelectors: string[];
}

export interface SiteAdapter {
  /** Stable id. Used in telemetry and per-site settings keys. */
  id: string;

  /** Human-readable, for the popup's "active on" line. */
  label: string;

  matches: (url: URL) => boolean;

  /**
   * Resolve the live composer element. Called on focus and after DOM
   * mutations — never cached across those events, because these apps swap the
   * composer out on navigation without a page load.
   */
  getComposer(): HTMLElement | null;

  engine: EditorEngine;

  readText(el: HTMLElement): string;

  writeText(el: HTMLElement, text: string): Promise<boolean>;

  anchor: AnchorSpec;

  /**
   * The site's send button. Used only to observe that a submit happened so we
   * can close our panels. We never click it and never intercept its events.
   */
  getSubmitButton?(): HTMLElement | null;
}

/**
 * Ordered selector list. Try each in turn; first match wins. Every adapter
 * declares its selectors this way so that when a site ships a redesign the
 * older selector is still sitting there as a fallback.
 */
export type SelectorChain = readonly string[];

/**
 * Walk a selector chain against a root, returning the first element that
 * matches and is actually usable (attached, rendered, not opted out).
 */
export function resolveFirst(
  chain: SelectorChain,
  root: ParentNode = document,
): HTMLElement | null {
  for (const selector of chain) {
    let candidates: NodeListOf<Element>;
    try {
      candidates = root.querySelectorAll(selector);
    } catch {
      // A malformed selector must not take down the whole chain.
      continue;
    }
    for (const candidate of candidates) {
      if (candidate instanceof HTMLElement && isUsableComposer(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * A match is only useful if it is on screen and the site has not opted out.
 * `display: none` composers are common — these apps keep a hidden one mounted
 * for the "new chat" state — and anchoring to one puts the halo at 0,0.
 */
export function isUsableComposer(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (el.closest('[data-forge="false"]')) return false;
  // offsetParent is null for display:none, and cheap — no style resolution.
  // position:fixed also reports null, so fall back to a box check.
  if (el.offsetParent === null && el.getClientRects().length === 0) return false;
  return true;
}
