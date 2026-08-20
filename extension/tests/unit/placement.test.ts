import { describe, expect, it } from 'vitest';
import type { AnchorSpec } from '../../src/adapters/types';
import type { Box } from '../../src/anchor/geometry';
import { centerOf, oppositeCorner, solvePlacement } from '../../src/anchor/placement';

const VIEWPORT: Box = { x: 0, y: 0, width: 1280, height: 800 };
const WIDGET = { width: 22, height: 22 };

const spec = (over: Partial<AnchorSpec> = {}): AnchorSpec => ({
  corner: 'bottom-right',
  offset: { x: -8, y: -8 },
  avoidSelectors: [],
  ...over,
});

/** Inclusive numeric range with a fractional step, for threshold walks. */
function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  const count = Math.round(Math.abs(to - from) / Math.abs(step));
  for (let i = 0; i <= count; i++) out.push(from + i * step);
  return out;
}

/** A typical single-line composer, comfortably inside the viewport. */
const COMPOSER: Box = { x: 273, y: 620, width: 734, height: 24 };

describe('solvePlacement', () => {
  it('insets the widget from the composer corner', () => {
    const p = solvePlacement({ target: COMPOSER, widget: WIDGET, spec: spec(), clip: VIEWPORT, viewport: VIEWPORT });

    expect(p.visible).toBe(true);
    expect(p.x + WIDGET.width).toBe(COMPOSER.x + COMPOSER.width - 8);
    expect(p.y + WIDGET.height).toBe(COMPOSER.y + COMPOSER.height - 8);
  });

  it('anchors to the top edge when the spec asks for top-right', () => {
    const p = solvePlacement({
      target: COMPOSER, widget: WIDGET, spec: spec({ corner: 'top-right' }),
      clip: VIEWPORT, viewport: VIEWPORT,
    });
    expect(p.y).toBe(COMPOSER.y - 8);
  });

  /**
   * The relationship to the anchor corner must not depend on the composer's
   * height. It used to: a clamp kept the widget inside the composer's box,
   * which bound while the composer was a single short line and released on the
   * second line — so the widget hopped the first time the user pressed Enter.
   */
  it('holds the same corner offset at every composer height', () => {
    // Anchored high enough that every height stays inside the viewport —
    // otherwise the clip would legitimately change the reference edge and the
    // test would be measuring something else.
    const top = 200;
    const heights = [16, 22, 24, 60, 240];
    const offsets = heights.map((height) => {
      const p = solvePlacement({
        target: { ...COMPOSER, y: top, height }, widget: WIDGET, spec: spec(),
        clip: VIEWPORT, viewport: VIEWPORT,
      });
      return p.y + WIDGET.height - (top + height);
    });
    expect(new Set(offsets).size).toBe(1);
    expect(offsets[0]).toBe(-8);
  });

  it('anchors to the visible slice when the composer overflows its wrapper', () => {
    // A long prompt scrolling inside a max-height wrapper: the composer's own
    // bottom is far below the window the user can see.
    const tall: Box = { x: 273, y: 400, width: 734, height: 900 };
    const clip: Box = { x: 273, y: 400, width: 734, height: 240 };

    const p = solvePlacement({ target: tall, widget: WIDGET, spec: spec(), clip, viewport: VIEWPORT });

    expect(p.visible).toBe(true);
    expect(p.y + WIDGET.height).toBe(clip.y + clip.height - 8);
  });

  it('hides when the composer is clipped down to a sliver', () => {
    const clip: Box = { x: 273, y: 620, width: 734, height: 4 };
    const p = solvePlacement({ target: COMPOSER, widget: WIDGET, spec: spec(), clip, viewport: VIEWPORT });

    expect(p.visible).toBe(false);
    expect(p.reason).toBe('clipped');
  });

  it('hides when the composer is scrolled entirely out of its container', () => {
    const clip: Box = { x: 273, y: 0, width: 734, height: 300 };
    const p = solvePlacement({ target: COMPOSER, widget: WIDGET, spec: spec(), clip, viewport: VIEWPORT });

    expect(p.visible).toBe(false);
    expect(p.reason).toBe('clipped');
  });

  it('reports target-empty for a zero-area composer rather than drawing at 0,0', () => {
    const p = solvePlacement({
      target: { x: 0, y: 0, width: 0, height: 0 }, widget: WIDGET, spec: spec(),
      clip: VIEWPORT, viewport: VIEWPORT,
    });
    expect(p.visible).toBe(false);
    expect(p.reason).toBe('target-empty');
  });

  describe('avoid zones', () => {
    it('slides left of a control that would be covered', () => {
      const sendButton: Box = { x: 960, y: 618, width: 30, height: 30 };
      const p = solvePlacement({
        target: COMPOSER, widget: WIDGET, spec: spec(), avoid: [sendButton],
        clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(p.x + WIDGET.width).toBeLessThanOrEqual(sendButton.x);
    });

    it('clears a whole row of controls, not just the first', () => {
      const upload: Box = { x: 920, y: 618, width: 30, height: 30 };
      const send: Box = { x: 960, y: 618, width: 30, height: 30 };
      const p = solvePlacement({
        target: COMPOSER, widget: WIDGET, spec: spec(), avoid: [upload, send],
        clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(p.x + WIDGET.width).toBeLessThanOrEqual(upload.x);
    });

    it('ignores controls that do not overlap, so placement stays put', () => {
      const below: Box = { x: 960, y: 700, width: 30, height: 30 };
      const withZone = solvePlacement({
        target: COMPOSER, widget: WIDGET, spec: spec(), avoid: [below],
        clip: VIEWPORT, viewport: VIEWPORT,
      });
      const without = solvePlacement({
        target: COMPOSER, widget: WIDGET, spec: spec(), clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(withZone.x).toBe(without.x);
    });

    /*
     * The defect this pins down showed up as an intermittent 62px jump in the
     * anchoring soak, roughly one run in fifteen — the width of Claude's
     * control row.
     *
     * The widget rests a few pixels above the top edge of the send button, and
     * whether it dodges was a bare overlap threshold. Layout noise pushes the
     * geometry back and forth across that line, and each crossing costs a
     * ~60px sideways move, so the widget hops between two positions while
     * nothing the user did has changed.
     *
     * The test jitters the composer around the crossing point rather than
     * sweeping past it once: a sweep is satisfied by one transition in each
     * direction and passes against the broken implementation, which is exactly
     * the mistake the first version of this test made. Jitter is what the
     * real failure looks like, and it is deterministic where the soak was not.
     */
    it('does not chatter when geometry jitters across the overlap threshold', () => {
      const button: Box = { x: 960, y: 640, width: 30, height: 30 };
      // The widget's lower edge crosses the button's upper edge at dy = 4.5.
      const jitter = [0, 6, 4, 6, 4, 6, 4, 6, 4, 6];

      const positions: number[] = [];
      let slid = false;
      for (const dy of jitter) {
        const p = solvePlacement({
          target: { ...COMPOSER, y: 620 + dy }, widget: WIDGET, spec: spec(),
          avoid: [button], slid, clip: VIEWPORT, viewport: VIEWPORT,
        });
        slid = p.slid;
        positions.push(p.x);
      }

      const transitions = positions.filter((x, i) => i > 0 && x !== positions[i - 1]).length;
      // One move away from the button is correct. Anything more is chatter.
      expect(transitions, `positions: ${positions.join(', ')}`).toBe(1);
    });

    it('holds the slide once engaged, rather than releasing on a one-pixel retreat', () => {
      const button: Box = { x: 960, y: 634, width: 30, height: 30 };
      const engaged = solvePlacement({
        target: { ...COMPOSER, y: 630 }, widget: WIDGET, spec: spec(),
        avoid: [button], slid: false, clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(engaged.slid).toBe(true);

      // One pixel back the way it came must not undo a 60px move.
      const nudged = solvePlacement({
        target: { ...COMPOSER, y: 629 }, widget: WIDGET, spec: spec(),
        avoid: [button], slid: true, clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(nudged.slid).toBe(true);
      expect(nudged.x).toBe(engaged.x);
    });

    it('releases the slide once the control is clearly out of the way', () => {
      const button: Box = { x: 960, y: 634, width: 30, height: 30 };
      const released = solvePlacement({
        target: { ...COMPOSER, y: 560 }, widget: WIDGET, spec: spec(),
        avoid: [button], slid: true, clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(released.slid).toBe(false);
    });

    it('ignores zero-area zones from controls the site has hidden', () => {
      const hidden: Box = { x: 960, y: 618, width: 0, height: 0 };
      const p = solvePlacement({
        target: COMPOSER, widget: WIDGET, spec: spec(), avoid: [hidden],
        clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(p.x + WIDGET.width).toBe(COMPOSER.x + COMPOSER.width - 8);
    });
  });

  describe('viewport bounds', () => {
    it('keeps the widget on screen when the composer runs past the right edge', () => {
      const wide: Box = { x: 1000, y: 620, width: 900, height: 24 };
      const p = solvePlacement({
        target: wide, widget: WIDGET, spec: spec({ offset: { x: 40, y: 0 } }),
        clip: VIEWPORT, viewport: VIEWPORT,
      });
      expect(p.x + WIDGET.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(p.x).toBeGreaterThanOrEqual(0);
    });

    it('does not clamp against the clip region, only the viewport', () => {
      // A single-line composer's clip box is shorter than the widget. Clamping
      // into it would silently override the anchor offset until the composer
      // grew a second line.
      const clip: Box = { x: 273, y: 620, width: 734, height: 24 };
      const p = solvePlacement({ target: COMPOSER, widget: WIDGET, spec: spec(), clip, viewport: VIEWPORT });

      expect(p.visible).toBe(true);
      expect(p.y + WIDGET.height).toBe(COMPOSER.y + COMPOSER.height - 8);
    });
  });
});

describe('centerOf', () => {
  it('returns the hit-test point at the widget centre', () => {
    expect(centerOf({ x: 100, y: 200, corner: 'bottom-right', visible: true, reason: 'ok', slid: false }, WIDGET))
      .toEqual({ x: 111, y: 211 });
  });
});

describe('oppositeCorner', () => {
  it('flips between the two supported corners', () => {
    expect(oppositeCorner('bottom-right')).toBe('top-right');
    expect(oppositeCorner('top-right')).toBe('bottom-right');
  });
});
