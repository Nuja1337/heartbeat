import { describe, expect, it } from 'vitest';
import { createRng, hash32, splitmix32 } from './rng';

describe('rng', () => {
  it('repeats for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('keeps values in range', () => {
    const r = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const k = r.int(3, 6);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(6);
    }
  });

  it('is roughly uniform', () => {
    const r = createRng(99);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += r.next();
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('forks do not depend on draws made by the parent', () => {
    const a = createRng(5);
    const b = createRng(5);
    for (let i = 0; i < 50; i++) a.next();
    expect(a.fork('x').next()).toBe(b.fork('x').next());
  });

  it('forks with different labels are independent streams', () => {
    const r = createRng(5);
    expect(r.fork('a').next()).not.toBe(r.fork('b').next());
  });

  it('weighted picks follow the weights', () => {
    const r = createRng(11);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[r.weighted([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.5);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.5);
  });

  it('hashes the same input to the same value', () => {
    expect(hash32(1, 'a', 3)).toBe(hash32(1, 'a', 3));
    expect(hash32(1, 'a', 3)).not.toBe(hash32(1, 'a', 4));
    expect(splitmix32(3)()).toBe(splitmix32(3)());
  });

  it('draws normals with unit spread', () => {
    const r = createRng(21);
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = r.normal();
      s += x;
      s2 += x * x;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.05);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.07);
  });
});
