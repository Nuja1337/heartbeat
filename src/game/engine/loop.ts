// requestAnimationFrame loop at the display rate, with a refresh-rate estimate.

export class Loop {
  private id = 0;
  private running = false;
  private last = 0;
  private deltas = new Float32Array(240);
  private n = 0;
  private i = 0;
  private scratch = new Float32Array(240);

  constructor(private cb: (ts: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.id = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.id);
  }

  private tick = (ts: number): void => {
    if (!this.running) return;
    if (this.last > 0) {
      const d = ts - this.last;
      // Ignore gaps from a hidden tab or a pause.
      if (d > 0 && d < 100) {
        this.deltas[this.i] = d;
        this.i = (this.i + 1) % this.deltas.length;
        if (this.n < this.deltas.length) this.n++;
      }
    }
    this.last = ts;
    this.id = requestAnimationFrame(this.tick);
    this.cb(ts);
  };

  /** Median frame rate, Hz. null until enough frames were seen. */
  displayHz(): number | null {
    if (this.n < 30) return null;
    const s = this.scratch.subarray(0, this.n);
    s.set(this.deltas.subarray(0, this.n));
    s.sort();
    const med = s[this.n >> 1] as number;
    return med > 0 ? 1000 / med : null;
  }
}
