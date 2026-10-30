// Number and date formatting for display.

import { MODES, MODS } from '../shared/catalog';
import type { ModId } from '../shared/types';
import type { PlaySummary } from '../data/schema';

/** "1 play", "2 plays". Pass `many` for an irregular plural. */
export const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const AND = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });
/** "a", "a and b", "a, b and c". */
export const andList = (items: readonly string[]): string => AND.format(items);

/** A share 0..1 as a percentage. */
export const pct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`;
export const pct0 = (v: number): string => `${Math.round(v * 100)}%`;
/** Aim error in radii shown as a percentage of a target's width. */
export const widthPct = (radii: number, signed = false): string => {
  const v = Math.round(radii * 50);
  return `${signed && v > 0 ? '+' : ''}${v}%`;
};
export const ms = (v: number, signed = false): string => {
  const r = Math.round(v * 10) / 10;
  return `${signed && r > 0 ? '+' : ''}${r} ms`;
};
export const int = (v: number): string => Math.round(v).toLocaleString('en-GB');
export const level = (v: number): string => v.toFixed(1);

export function duration(msValue: number): string {
  const s = Math.round(msValue / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
export const dateOf = (t: number): string => DATE.format(new Date(t));
export const timeOf = (t: number): string => TIME.format(new Date(t));
export const dateTime = (t: number): string => `${dateOf(t)}, ${timeOf(t)}`;

export function ago(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return 'a moment ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function modList(mods: readonly ModId[]): string {
  return mods.length ? mods.map((m) => MODS[m].label).join(', ') : 'No mods';
}

/** "Dynamic, Level 4" or "Jumps". */
export function playTitle(s: Pick<PlaySummary, 'modeId' | 'presetLevel'>): string {
  const mode = MODES[s.modeId].label;
  if (s.modeId !== 'dynamic') return mode;
  return s.presetLevel !== null ? `${mode}, Level ${s.presetLevel}` : `${mode}, custom`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Along-the-movement error in radii as words. */
export function alongText(radii: number): string {
  const v = Math.round(Math.abs(radii) * 50);
  return v === 0 ? 'on the center' : `${v}% ${radii < 0 ? 'short' : 'past'}`;
}

/** Across-the-movement error in radii as words. */
export function lateralText(radii: number): string {
  const v = Math.round(Math.abs(radii) * 50);
  return v === 0 ? 'on the line' : `${v}% ${radii < 0 ? 'left' : 'right'}`;
}

export function offsetText(msValue: number): string {
  const v = Math.round(Math.abs(msValue));
  return v === 0 ? 'on time' : `${v} ms ${msValue < 0 ? 'early' : 'late'}`;
}

/** A trend value with its unit, such as "88.1%", "12.0 ms" or "4.21" for a level. */
export function trendValue(unit: string, decimals: number, v: number): string {
  const n = (Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v).toFixed(decimals);
  if (unit === 'level') return n;
  return unit.startsWith('%') ? `${n}${unit}` : `${n} ${unit}`;
}
