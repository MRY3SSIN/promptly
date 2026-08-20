import { useMemo, useState } from 'react';
import { HALO_SIZE } from '../config/constants';
import { useWidgetStore, type HaloStatus } from '../store/widgetStore';

/**
 * The anchored element — a ring, not a filled badge.
 *
 * A filled badge reads as a notification, and a notification on top of
 * somebody's text box is an interruption. A ring reads as a gauge: it reports
 * state without demanding a response. The arc fills in proportion to the score
 * and travels ochre → teal as the prompt improves, which is the one piece of
 * colour in the product that carries meaning.
 */

const STROKE = 2.5;
const RADIUS = (HALO_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ScoreHaloProps {
  onOpen?: () => void;
}

export function ScoreHalo({ onOpen }: ScoreHaloProps) {
  const score = useWidgetStore((s) => s.score);
  const issueCount = useWidgetStore((s) => s.issueCount);
  const status = useWidgetStore((s) => s.status);
  const typing = useWidgetStore((s) => s.typing);
  const active = useWidgetStore((s) => s.active);
  const disabled = useWidgetStore((s) => s.disabled);
  const [hovered, setHovered] = useState(false);

  const arc = useMemo(() => arcLength(status, score), [status, score]);
  const tone = useMemo(() => toneForScore(status, score), [status, score]);

  // The widget exists only while the composer has focus or holds text.
  // Kept mounted rather than unmounted so re-focusing does not cost a React
  // tree rebuild, and so the fade reads as the same object returning.
  const shown = active && !disabled;

  // Fade back while keys are landing so we are never the thing being read.
  // Hover always wins: a user reaching for the widget wants to see it.
  const opacity = !shown ? 0 : hovered ? 1 : typing ? 0.3 : status === 'idle' ? 0.4 : 1;

  return (
    <div
      className="forge-halo-root"
      style={{
        opacity,
        visibility: shown ? 'visible' : 'hidden',
        pointerEvents: shown ? 'auto' : 'none',
      }}
      aria-hidden={!shown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="forge-halo"
        aria-label={ariaLabel(status, score, issueCount)}
        onClick={onOpen}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <svg
          width={HALO_SIZE}
          height={HALO_SIZE}
          viewBox={`0 0 ${HALO_SIZE} ${HALO_SIZE}`}
          aria-hidden="true"
          focusable="false"
        >
          <circle
            className="forge-halo-track"
            cx={HALO_SIZE / 2}
            cy={HALO_SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
          />
          {status !== 'error' && (
            <circle
              className={`forge-halo-arc${status === 'analyzing' ? ' is-analyzing' : ''}`}
              cx={HALO_SIZE / 2}
              cy={HALO_SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              stroke={tone}
              strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
              // Start the arc at 12 o'clock rather than 3 o'clock; a gauge
              // that fills from the top reads as a gauge without a label.
              transform={`rotate(-90 ${HALO_SIZE / 2} ${HALO_SIZE / 2})`}
            />
          )}
        </svg>

        <span className="forge-halo-center" style={{ color: tone }}>
          <HaloCenter status={status} issueCount={issueCount} />
        </span>
      </button>

      {/* Hover reveals the action. Until then the widget says nothing. */}
      <span className={`forge-halo-label${hovered ? ' is-open' : ''}`} aria-hidden="true">
        Improve
      </span>
    </div>
  );
}

function HaloCenter({ status, issueCount }: { status: HaloStatus; issueCount: number }) {
  if (status === 'issues' && issueCount > 0) {
    return <>{issueCount > 9 ? '9+' : issueCount}</>;
  }
  if (status === 'clean') {
    return (
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
        <path
          d="M1 4.6 L3.4 7 L8 1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return null;
}

/**
 * Ochre → teal, interpolated rather than banded, so improving a prompt by a
 * few points is visible as movement instead of nothing-then-a-jump.
 * `color-mix` in oklab keeps the midpoint from going muddy the way sRGB
 * interpolation between a warm and a cool hue does.
 */
export function toneForScore(status: HaloStatus, score: number): string {
  if (status === 'error' || status === 'idle') return 'var(--forge-mute)';
  if (status === 'analyzing') return 'var(--forge-mute)';
  const t = Math.round(clamp01((score - 40) / 50) * 100);
  return `color-mix(in oklab, var(--forge-ochre), var(--forge-teal) ${t}%)`;
}

function arcLength(status: HaloStatus, score: number): number {
  if (status === 'idle') return 0;
  // A fixed short arc that spins; the value is meaningless mid-analysis.
  if (status === 'analyzing') return CIRCUMFERENCE * 0.25;
  return CIRCUMFERENCE * clamp01(score / 100);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function ariaLabel(status: HaloStatus, score: number, issueCount: number): string {
  if (status === 'analyzing') return 'Forge: analysing prompt';
  if (status === 'error') return 'Forge: analysis unavailable';
  if (status === 'idle') return 'Forge: open prompt panel';
  const band = score >= 80 ? 'strong' : score >= 50 ? 'decent' : 'needs work';
  const issues = issueCount === 1 ? '1 suggestion' : `${issueCount} suggestions`;
  return `Forge: prompt score ${score} of 100, ${band}, ${issues}. Open panel.`;
}
