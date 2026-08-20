/**
 * Values that more than one layer needs to agree on. Anything tunable that is
 * not a user setting lives here so the numbers quoted in tests match the
 * numbers the runtime actually uses.
 */

/** Widget geometry, in CSS pixels. */
export const HALO_SIZE = 22;

/** Below this, a position change is not worth a style write. */
export const POSITION_EPSILON_PX = 0.5;

/** The polling fallback that catches what no observer reports. */
export const ANCHOR_FALLBACK_INTERVAL_MS = 1000;

/** Occlusion probing is a hit-test; it runs far less often than measurement. */
export const OCCLUSION_PROBE_INTERVAL_MS = 250;

/**
 * The smallest slice of composer we will still anchor to, in CSS pixels.
 *
 * An absolute minimum rather than a ratio: a long prompt scrolling inside its
 * own max-height wrapper is mostly clipped by definition, and a ratio test
 * would hide the widget exactly when the user is writing the most.
 */
export const MIN_TARGET_VISIBLE_PX = 10;

/** Typing debounce before local analysis runs. Layer 1 only — never network. */
export const ANALYSIS_DEBOUNCE_MS = 400;

/** Prompts shorter than this are not worth scoring. */
export const MIN_ANALYZE_LENGTH = 15;

/** The one element we are allowed to append to the host page. */
export const HOST_ELEMENT_NAME = 'forge-ui';

/** Site-level opt-out attribute, mirroring Grammarly's `data-gramm`. */
export const OPT_OUT_ATTRIBUTE = 'data-forge';
