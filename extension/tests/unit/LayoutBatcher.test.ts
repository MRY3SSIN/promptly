import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutBatcher, type FrameScheduler } from '../../src/anchor/LayoutBatcher';

/** A scheduler the test drives by hand, so no test waits on a real frame. */
function manualScheduler() {
  let next = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const scheduler: FrameScheduler = {
    request(cb) {
      const handle = next++;
      pending.set(handle, cb);
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    get pendingCount() {
      return pending.size;
    },
    runFrame() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, cb] of entries) cb(0);
    },
  };
}

describe('LayoutBatcher', () => {
  let clock: ReturnType<typeof manualScheduler>;
  let batcher: LayoutBatcher;

  beforeEach(() => {
    clock = manualScheduler();
    batcher = new LayoutBatcher(clock.scheduler);
  });

  it('runs every read before every write', () => {
    const order: string[] = [];
    batcher.write(() => order.push('write-1'));
    batcher.read(() => order.push('read-1'));
    batcher.write(() => order.push('write-2'));
    batcher.read(() => order.push('read-2'));

    clock.runFrame();

    expect(order).toEqual(['read-1', 'read-2', 'write-1', 'write-2']);
  });

  it('coalesces many requests into a single frame', () => {
    for (let i = 0; i < 50; i++) batcher.read(() => {});
    expect(clock.pendingCount).toBe(1);
  });

  it('lets a read enqueue a write that runs in the same frame', () => {
    // This is the whole measure-then-commit cycle: the engine measures in the
    // read phase and commits from inside it. Deferring that commit to the next
    // frame would paint one frame with a stale transform.
    const order: string[] = [];
    batcher.read(() => {
      order.push('measure');
      batcher.write(() => order.push('commit'));
    });

    clock.runFrame();

    expect(order).toEqual(['measure', 'commit']);
  });

  it('defers a read enqueued from a write to the next frame', () => {
    const order: string[] = [];
    batcher.write(() => {
      order.push('write');
      batcher.read(() => order.push('read'));
    });

    clock.runFrame();
    expect(order).toEqual(['write']);

    clock.runFrame();
    expect(order).toEqual(['write', 'read']);
  });

  it('deduplicates the same job queued twice', () => {
    const job = vi.fn();
    batcher.read(job);
    batcher.read(job);

    clock.runFrame();

    expect(job).toHaveBeenCalledTimes(1);
  });

  it('runs the jobs queued behind one that throws', () => {
    const after = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    batcher.read(() => {
      throw new Error('boom');
    });
    batcher.read(after);

    clock.runFrame();

    expect(after).toHaveBeenCalledTimes(1);
  });

  describe('flushSync', () => {
    it('runs the pending work immediately and cancels the scheduled frame', () => {
      const job = vi.fn();
      batcher.read(job);

      batcher.flushSync();

      expect(job).toHaveBeenCalledTimes(1);
      expect(clock.pendingCount).toBe(0);
    });

    it('does not run the same job again on the next frame', () => {
      const job = vi.fn();
      batcher.read(job);
      batcher.flushSync();
      clock.runFrame();

      expect(job).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushing flag', () => {
    it('is set while jobs run and clear outside them', () => {
      let duringRead = false;
      let duringWrite = false;

      expect(batcher.flushing).toBe(false);
      batcher.read(() => {
        duringRead = batcher.flushing;
      });
      batcher.write(() => {
        duringWrite = batcher.flushing;
      });

      clock.runFrame();

      expect(duringRead).toBe(true);
      expect(duringWrite).toBe(true);
      expect(batcher.flushing).toBe(false);
    });

    it('is restored correctly when a sync flush nests inside a frame', () => {
      let innerSaw = false;
      batcher.read(() => {
        batcher.flushSync();
        innerSaw = batcher.flushing;
      });

      clock.runFrame();

      expect(innerSaw).toBe(true);
      expect(batcher.flushing).toBe(false);
    });
  });

  it('ignores work queued after disposal', () => {
    const job = vi.fn();
    batcher.dispose();
    batcher.read(job);

    clock.runFrame();

    expect(job).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });
});
