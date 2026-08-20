import { useEffect } from 'react';
import { useWidgetStore } from '../store/widgetStore';

/**
 * The message shown when a write could not be verified.
 *
 * This exists so the give-up path is honest. Every write strategy can fail
 * against an editor that has locked itself down, and the alternative to saying
 * so is a button that appears to work and does nothing — which costs the user
 * their rewritten prompt and their trust in the same click. The text is on the
 * clipboard by the time this renders, so the instruction it gives is accurate.
 */

const DISMISS_AFTER_MS = 6000;

export function Toast() {
  const toast = useWidgetStore((s) => s.toast);
  const setToast = useWidgetStore((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  if (!toast) return null;

  return (
    <div
      className="forge-toast"
      // `status` rather than `alert`: this reports the outcome of something the
      // user just did. `alert` interrupts, and interrupting is the whole
      // problem we are apologising for.
      role="status"
      aria-live="polite"
    >
      <span>{toast}</span>
      <button
        type="button"
        className="forge-toast-close"
        aria-label="Dismiss message"
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}

/** Platform-correct paste hint, since the toast tells the user to press it. */
export function pasteShortcutLabel(platform: string = navigator.platform): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘V' : 'Ctrl+V';
}
