export {};

declare global {
  interface Window {
    /** Mock editor models exposed by `tests/fixtures/editors.html`. */
    __models: Record<string, { doc: string; accepted: string[] }>;
  }
}
