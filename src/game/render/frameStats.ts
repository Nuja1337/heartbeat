// Frame times for the frame graph and for InputInfo.frameP99Ms (PLAN-2 5.4). Pure, and nothing here allocates once built.

/** Frames the graph shows. */
export const GRAPH_FRAMES = 120;
/** Histogram bins of 0.1 ms, up to 100 ms. Longer frames land in the last bin. */
const BINS = 1001;
/** The p99 needs this many frames behind it. */
const MIN_FRAMES = 30;
/** A gap longer than this is a hidden tab or a pause, not a frame. */
export const MAX_FRAME_MS = 250;

export class FrameStats {
  /** The last `GRAPH_FRAMES` frame times, as a ring. */
  readonly recent = new Float32Array(GRAPH_FRAMES);
  private head = 0;
  private filled = 0;
  private bins = new Uint32Array(BINS);
  private total = 0;
  private worst = 0;

  /** Add one frame time, ms. Zero, negative and very long gaps are ignored. */
  push(dt: number): void {
    if (!(dt > 0) || dt > MAX_FRAME_MS) return;
    this.recent[this.head] = dt;
    this.head = (this.head + 1) % GRAPH_FRAMES;
    if (this.filled < GRAPH_FRAMES) this.filled++;
    const bin = Math.min(BINS - 1, Math.floor(dt * 10));
    this.bins[bin] = (this.bins[bin] as number) + 1;
    this.total++;
    if (dt > this.worst) this.worst = dt;
  }

  get count(): number {
    return this.total;
  }

  /** How many of the recent frames the graph has. */
  get shown(): number {
    return this.filled;
  }

  /** The k-th oldest of the recent frames. */
  recentAt(k: number): number {
    return this.recent[(this.head - this.filled + k + GRAPH_FRAMES) % GRAPH_FRAMES] as number;
  }

  /** The 99th percentile of every frame so far, ms, rounded up to 0.1. null until there are enough frames. */
  p99(): number | null {
    if (this.total < MIN_FRAMES) return null;
    const need = Math.ceil(this.total * 0.99);
    let seen = 0;
    for (let i = 0; i < BINS; i++) {
      seen += this.bins[i] as number;
      if (seen >= need) return Math.min(this.worst, (i + 1) / 10);
    }
    return this.worst;
  }

  reset(): void {
    this.recent.fill(0);
    this.bins.fill(0);
    this.head = 0;
    this.filled = 0;
    this.total = 0;
    this.worst = 0;
  }
}
