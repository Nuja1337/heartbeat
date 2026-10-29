// Play time is real milliseconds: play(t) = t - startPerf - pausedTotal. Pure, so tests can drive it.

export class Clock {
  private startPerf = Number.NaN;
  private pausedTotal = 0;
  private pausedAt = Number.NaN;
  private frozen = 0;

  get started(): boolean {
    return !Number.isNaN(this.startPerf);
  }

  get paused(): boolean {
    return !Number.isNaN(this.pausedAt);
  }

  /** The first input. Play time 0. */
  start(perfNow: number): void {
    this.startPerf = perfNow;
    this.pausedTotal = 0;
    this.pausedAt = Number.NaN;
  }

  /** Play time for a performance.now() style timestamp. Frozen while paused. */
  play(t: number): number {
    if (!this.started) return 0;
    if (this.paused) return this.frozen;
    return t - this.startPerf - this.pausedTotal;
  }

  pause(perfNow: number): void {
    if (!this.started || this.paused) return;
    this.frozen = perfNow - this.startPerf - this.pausedTotal;
    this.pausedAt = perfNow;
  }

  /** End a pause. The whole pause, countdown included, stays out of play time. */
  resume(perfNow: number): void {
    if (!this.paused) return;
    this.pausedTotal += perfNow - this.pausedAt;
    this.pausedAt = Number.NaN;
  }
}
