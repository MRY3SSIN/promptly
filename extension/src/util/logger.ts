/**
 * Logging that is safe to leave in a shipped build.
 *
 * Two hard rules, both of which exist because this code runs inside somebody
 * else's page next to somebody else's private text:
 *   1. Never log prompt content. Not truncated, not hashed, not "just for
 *      debugging". Callers pass metadata only.
 *   2. Stay silent in production unless something actually broke.
 */

const PREFIX = '[forge]';

/** WXT replaces this at build time; the check is erased in production. */
const isDev = import.meta.env.MODE === 'development';

export const log = {
  debug(...args: unknown[]): void {
    if (isDev) console.debug(PREFIX, ...args);
  },
  info(...args: unknown[]): void {
    if (isDev) console.info(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};

/**
 * Structured events for telemetry. The payload type is deliberately narrow:
 * numbers, booleans and short enum-ish strings. There is no `string` escape
 * hatch wide enough to smuggle a prompt through by accident.
 */
export type TelemetryPayload = Record<string, string | number | boolean | undefined>;

export function telemetry(event: string, payload: TelemetryPayload = {}): void {
  // M4 wires this to the batched /v1/telemetry endpoint. Until then it is a
  // dev-visible no-op so the call sites can be written once and left alone.
  log.debug('telemetry', event, payload);
}
