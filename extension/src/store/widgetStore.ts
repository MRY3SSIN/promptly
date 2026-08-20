import { create } from 'zustand';
import type { Theme } from '../ui/theme';

/**
 * Content-script UI state.
 *
 * Deliberately holds no prompt text. The analyzer reads the composer directly
 * and reports a score and a rule-id list; keeping the body out of the store
 * means there is no path by which a future feature accidentally serialises a
 * user's draft into storage or a message.
 */

export type HaloStatus = 'idle' | 'analyzing' | 'issues' | 'clean' | 'error';

export interface WidgetState {
  /** 5..100. Never 0 — see `score.ts`. */
  score: number;
  issueCount: number;
  status: HaloStatus;
  /** Anchoring says there is somewhere valid to draw. */
  placed: boolean;
  /** The composer has focus or holds text. */
  active: boolean;
  /** Dimmed while keys are actually landing. */
  typing: boolean;
  theme: Theme;
  /** Set when the adapter could not resolve a composer; the UI stays hidden. */
  disabled: boolean;

  /**
   * Transient message shown near the halo. The only thing that currently
   * raises one is an exhausted write chain, which must never fail silently.
   */
  toast: string | null;

  setScore: (score: number, issueCount: number) => void;
  setStatus: (status: HaloStatus) => void;
  setPlaced: (placed: boolean) => void;
  setActive: (active: boolean) => void;
  setTyping: (typing: boolean) => void;
  setTheme: (theme: Theme) => void;
  setDisabled: (disabled: boolean) => void;
  setToast: (toast: string | null) => void;
}

export const useWidgetStore = create<WidgetState>((set) => ({
  score: 100,
  issueCount: 0,
  status: 'idle',
  placed: false,
  active: false,
  typing: false,
  theme: 'light',
  disabled: false,
  toast: null,

  setScore: (score, issueCount) =>
    set({
      score,
      issueCount,
      status: issueCount === 0 ? 'clean' : 'issues',
    }),
  setStatus: (status) => set({ status }),
  setPlaced: (placed) => set({ placed }),
  setActive: (active) => set({ active }),
  setTyping: (typing) => set({ typing }),
  setTheme: (theme) => set({ theme }),
  setDisabled: (disabled) => set({ disabled }),
  setToast: (toast) => set({ toast }),
}));

/** Non-React readers (the anchor controller) use the vanilla API. */
export const widgetStore = useWidgetStore;
