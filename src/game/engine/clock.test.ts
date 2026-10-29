import { describe, expect, it } from 'vitest';
import { Clock } from './clock';

describe('Clock', () => {
  it('starts at the first input', () => {
    const c = new Clock();
    expect(c.started).toBe(false);
    expect(c.play(5000)).toBe(0);
    c.start(1000);
    expect(c.play(1000)).toBe(0);
    expect(c.play(1750)).toBe(750);
  });

  it('freezes while paused and leaves the pause out of play time', () => {
    const c = new Clock();
    c.start(1000);
    c.pause(2000);
    expect(c.paused).toBe(true);
    expect(c.play(9000)).toBe(1000);
    c.resume(5000);
    expect(c.play(5000)).toBe(1000);
    expect(c.play(5500)).toBe(1500);
  });

  it('counts the countdown into the pause', () => {
    const c = new Clock();
    c.start(0);
    c.pause(1000);
    // Resume is accepted at 3000, the countdown ends at 4000.
    c.resume(4000);
    expect(c.play(4000)).toBe(1000);
  });

  it('handles several pauses', () => {
    const c = new Clock();
    c.start(0);
    c.pause(100);
    c.resume(200);
    c.pause(300);
    c.resume(1300);
    expect(c.play(1400)).toBe(300);
  });

  it('ignores a second pause call', () => {
    const c = new Clock();
    c.start(0);
    c.pause(100);
    c.pause(500);
    c.resume(600);
    expect(c.play(600)).toBe(100);
  });
});
