// Number and date formatting for display, in the player's language.

import { MODES, MODS } from '../shared/catalog';
import { formatNumber, getLocale, intlTag, t } from '../shared/i18n';
import type { ModId } from '../shared/types';
import type { PlaySummary } from '../data/schema';

export { count } from '../shared/i18n';

/** One Intl formatter per locale and purpose, built when first asked for. */
function perLocale<T>(make: (tag: string) => T): () => T {
  let tag = '';
  let value: T | null = null;
  return () => {
    const now = intlTag(getLocale());
    if (value === null || tag !== now) {
      tag = now;
      value = make(now);
    }
    return value;
  };
}

const AND = perLocale((tag) => new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' }));
/** "a", "a and b", "a, b and c". */
export const andList = (items: readonly string[]): string => AND().format(items);

/** A share 0..1 as a percentage. */
export const pct = (v: number, digits = 1): string =>
  `${formatNumber(v * 100, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const pct0 = (v: number): string => `${formatNumber(Math.round(v * 100))}%`;
/** Aim error in radii shown as a percentage of a target's width. */
export const widthPct = (radii: number, signed = false): string => {
  const v = Math.round(radii * 50);
  return `${signed && v > 0 ? '+' : ''}${formatNumber(v)}%`;
};
export const ms = (v: number, signed = false): string => {
  const r = Math.round(v * 10) / 10;
  return `${signed && r > 0 ? '+' : ''}${formatNumber(r)} ms`;
};
export const int = (v: number): string => formatNumber(Math.round(v));
export const level = (v: number): string => formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function duration(msValue: number): string {
  const s = Math.round(msValue / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DATE = perLocale((tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }));
const TIME = perLocale((tag) => new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }));
const SHORT_DATE = perLocale((tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }));
const DAY_NAME = perLocale((tag) => new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' }));
export const dateOf = (time: number): string => DATE().format(new Date(time));
export const timeOf = (time: number): string => TIME().format(new Date(time));
export const dateTime = (time: number): string => `${dateOf(time)}, ${timeOf(time)}`;
/** "7 Nov". */
export const shortDate = (time: number): string => SHORT_DATE().format(new Date(time));
/** "Friday 7 November". */
export const dayName = (time: number): string => DAY_NAME().format(new Date(time));

export function ago(t0: number, now = Date.now()): string {
  const m = Math.round((now - t0) / 60_000);
  if (m < 1) return t('a moment ago');
  if (m < 60) return t('{n} min ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('yesterday') : t('{n} days ago', { n: d });
}

export function modList(mods: readonly ModId[]): string {
  return mods.length ? mods.map((m) => t(MODS[m].label)).join(', ') : t('No mods');
}

/** "Dynamic, Level 4" or "Jumps". */
export function playTitle(s: Pick<PlaySummary, 'modeId' | 'presetLevel'>): string {
  const mode = t(MODES[s.modeId].label);
  if (s.modeId !== 'dynamic') return mode;
  return s.presetLevel !== null ? t('{mode}, Level {level}', { mode, level: s.presetLevel }) : t('{mode}, custom', { mode });
}

export function bytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  if (n < 1024 ** 2) return `${formatNumber(n / 1024, { maximumFractionDigits: 1 })} KB`;
  if (n < 1024 ** 3) return `${formatNumber(n / 1024 ** 2, { maximumFractionDigits: 1 })} MB`;
  return `${formatNumber(n / 1024 ** 3, { maximumFractionDigits: 2 })} GB`;
}

/** Along-the-movement error in radii as words. */
export function alongText(radii: number): string {
  const v = Math.round(Math.abs(radii) * 50);
  if (v === 0) return t('on the center');
  return t('{pct}% {side, select, short {short} other {past}}', { pct: v, side: radii < 0 ? 'short' : 'past' });
}

/** Across-the-movement error in radii as words. */
export function lateralText(radii: number): string {
  const v = Math.round(Math.abs(radii) * 50);
  if (v === 0) return t('on the line');
  return t('{pct}% {side, select, left {left} other {right}}', { pct: v, side: radii < 0 ? 'left' : 'right' });
}

export function offsetText(msValue: number): string {
  const v = Math.round(Math.abs(msValue));
  if (v === 0) return t('on time');
  return t('{ms} ms {side, select, early {early} other {late}}', { ms: v, side: msValue < 0 ? 'early' : 'late' });
}

/**
 * A trend value with its unit, such as "88.1%", "12.0 ms" or "4.21" for a level. The unit is the English name the
 * metric table uses, and each one has its own message, because some languages put the unit before the number.
 */
export function trendValue(unit: string, decimals: number, v: number): string {
  const n = formatNumber(Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  switch (unit) {
    case 'level':
      return n;
    case '%':
      return `${n}%`;
    case 'ms':
      return t('{ms} ms', { ms: n });
    case '% of a width':
      return t('{n}% of a width', { n });
    case 'plays':
      return t('{n} plays', { n });
    case 'min':
      return t('{n} min', { n });
    default:
      return `${n} ${t(unit)}`;
  }
}

/** A label used in the middle of a sentence. German keeps its capital letters, because they belong to the noun. */
export const lowerLabel = (s: string): string => (getLocale() === 'de' ? s : s.toLocaleLowerCase(intlTag()));
