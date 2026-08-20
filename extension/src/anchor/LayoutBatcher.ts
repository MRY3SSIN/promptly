/**
 * A single rAF shared by everything that touches layout.
 *
 * The rule this enforces is the one that keeps us out of the host page's
 * performance profile: reads never interleave with writes. Every
 * `getBoundingClientRect` in the extension runs in the read phase, every
 * `style.transform` in the write phase that follows it, and both happen inside
 * one frame. Interleaving them is what produces "forced reflow" warnings, and
 * a scroll handler that forces reflow on a page like Claude's is immediately
 * visible to the user as jank.
 *
 * Callers never call `requestAnimationFrame` themselves. That is the point.
 */

export type LayoutJob = () => void;

export interface FrameScheduler {
  request(cb: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const defaultScheduler: FrameScheduler = {
  request: (cb) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(cb)
      : (setTimeout(() => cb(Date.now()), 16) as unknown as number),
  cancel: (handle) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

export class LayoutBatcher {
  readonly #reads = new Set<LayoutJob>();
  readonly #writes = new Set<LayoutJob>();
  readonly #scheduler: FrameScheduler;
  #frame: number | null = null;
  #disposed = false;
  #flushing = false;

  constructor(scheduler: FrameScheduler = defaultScheduler) {
    this.#scheduler = scheduler;
  }

  /** Queue a job that measures. Runs before every write in the same frame. */
  read(job: LayoutJob): void {
    if (this.#disposed) return;
    this.#reads.add(job);
    this.#schedule();
  }

  /** Queue a job that mutates style. Runs after every read in the frame. */
  write(job: LayoutJob): void {
    if (this.#disposed) return;
    this.#writes.add(job);
    this.#schedule();
  }

  /** True while a frame is pending — used by tests and by the idle throttle. */
  get pending(): boolean {
    return this.#frame !== null;
  }

  /**
   * True while jobs are running. Every layout read in the extension should
   * happen with this set; a read taken with it clear is a read that escaped
   * the batcher, which is what the e2e instrumentation asserts against.
   */
  get flushing(): boolean {
    return this.#flushing;
  }

  #schedule(): void {
    if (this.#frame !== null) return;
    this.#frame = this.#scheduler.request(() => {
      this.#frame = null;
      this.flush();
    });
  }

  /**
   * Run one full read-then-write cycle. Exposed so tests can drive frames
   * deterministically instead of waiting on a real rAF.
   */
  flush(): void {
    const wasFlushing = this.#flushing;
    this.#flushing = true;
    try {
      this.#runQueues();
    } finally {
      this.#flushing = wasFlushing;
    }
  }

  #runQueues(): void {
    // Snapshot and clear before running: a read that enqueues a write must
    // land in *this* frame's write phase, and a write that enqueues a read
    // must schedule the *next* frame rather than looping here forever.
    const reads = [...this.#reads];
    this.#reads.clear();
    for (const job of reads) runSafely(job);

    const writes = [...this.#writes];
    this.#writes.clear();
    for (const job of writes) runSafely(job);
  }

  /**
   * Run the pending frame *now*, cancelling the scheduled one.
   *
   * Only correct from a callback that the browser already runs inside its
   * rendering steps with layout clean — a ResizeObserver or
   * IntersectionObserver callback, both of which fire after animation frames
   * but before paint. From there a rect read is free (the browser just
   * computed layout to deliver the callback) and a style write still lands in
   * the frame about to be painted.
   *
   * Never call this from a scroll or input handler. There, layout is dirty,
   * the read forces a synchronous reflow, and this becomes the exact thing the
   * batcher exists to prevent.
   */
  flushSync(): void {
    if (this.#disposed) return;
    if (this.#frame !== null) {
      this.#scheduler.cancel(this.#frame);
      this.#frame = null;
    }
    this.flush();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#frame !== null) {
      this.#scheduler.cancel(this.#frame);
      this.#frame = null;
    }
    this.#reads.clear();
    this.#writes.clear();
  }
}

/**
 * One job throwing must not strand the jobs queued behind it — a half-applied
 * frame leaves the widget somewhere it does not belong.
 */
function runSafely(job: LayoutJob): void {
  try {
    job();
  } catch (err) {
    console.error('[forge] layout job failed', err);
  }
}

/** The batcher every content-script module shares. */
export const layoutBatcher = new LayoutBatcher();
