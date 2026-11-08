import { afterEach, describe, expect, it } from 'vitest';
import { count, format, formatNumber, getLocale, placeholders, raw, setLocale, t } from './i18n';
import { pickLocale } from './locales';

afterEach(() => setLocale('en', {}));

describe('format', () => {
  it('fills values and writes numbers for the locale', () => {
    expect(format('Level {level}', { level: 4.2 })).toBe('Level 4.2');
    setLocale('de', {});
    expect(format('Level {level}', { level: 4.2 })).toBe('Level 4,2');
    expect(format('{n} plays', { n: 1234 })).toBe('1.234 plays');
  });

  it('leaves an unknown placeholder in place', () => {
    expect(format('Hold {key} for {n} seconds', { key: 'Z' })).toBe('Hold Z for {n} seconds');
  });

  it('chooses plural branches by the locale rules, with exact matches first', () => {
    const m = '{n, plural, =0 {No plays} one {# play} other {# plays}}';
    expect(format(m, { n: 0 })).toBe('No plays');
    expect(format(m, { n: 1 })).toBe('1 play');
    expect(format(m, { n: 2 })).toBe('2 plays');
    setLocale('ru', {});
    // Russian has one, few and many; a branch that is missing falls back to other.
    const ru = '{n, plural, one {# игра} few {# игры} many {# игр} other {# игры}}';
    expect(format(ru, { n: 1 })).toBe('1 игра');
    expect(format(ru, { n: 3 })).toBe('3 игры');
    expect(format(ru, { n: 5 })).toBe('5 игр');
    expect(format(ru, { n: 21 })).toBe('21 игра');
  });

  it('chooses select branches and nests them', () => {
    const m = 'You click {ms} ms {side, select, early {early} other {late}} on average.';
    expect(format(m, { ms: 12, side: 'early' })).toBe('You click 12 ms early on average.');
    expect(format(m, { ms: 12, side: 'late' })).toBe('You click 12 ms late on average.');
    const nested = '{n, plural, one {{side, select, early {an early click} other {a late click}}} other {# {side} clicks}}';
    expect(format(nested, { n: 1, side: 'early' })).toBe('an early click');
    expect(format(nested, { n: 3, side: 'late' })).toBe('3 late clicks');
  });

  it('keeps a hash outside a plural as text', () => {
    expect(format('Set #{n}', { n: 2 })).toBe('Set #2');
  });

  it('survives an unbalanced brace', () => {
    expect(format('Oops {n', { n: 1 })).toBe('Oops {n');
  });
});

describe('t', () => {
  it('returns English when there is no dictionary and the translation when there is', () => {
    expect(t('Play')).toBe('Play');
    setLocale('es', { Play: 'Jugar', 'Level {level}': 'Nivel {level}', 'Play##noun': 'Partida' });
    expect(t('Play')).toBe('Jugar');
    expect(t('Level {level}', { level: 3 })).toBe('Nivel 3');
    expect(t('Play', undefined, 'noun')).toBe('Partida');
    expect(t('Train')).toBe('Train');
    expect(raw('Level {level}')).toBe('Nivel {level}');
  });

  it('ignores an unknown locale', () => {
    setLocale('xx' as never, {});
    expect(getLocale()).toBe('en');
  });
});

describe('count', () => {
  it('builds a plural message from the noun', () => {
    expect(count(1, 'play')).toBe('1 play');
    expect(count(2, 'play')).toBe('2 plays');
    expect(count(2, 'best', 'bests')).toBe('2 bests');
    setLocale('fr', { '{n, plural, one {# play} other {# plays}}': '{n, plural, one {# partie} other {# parties}}' });
    expect(count(1, 'play')).toBe('1 partie');
    expect(count(2, 'play')).toBe('2 parties');
  });
});

describe('formatNumber and placeholders', () => {
  it('formats for the locale and lists placeholder names', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatNumber(0.5, { style: 'percent' })).toBe('50%');
    expect(placeholders('The {guide} explains {what}, and {guide} again.')).toEqual(['guide', 'what']);
    expect(placeholders('{n, plural, one {# play} other {# plays}}')).toEqual([]);
  });
});

describe('pickLocale', () => {
  it('matches exact tags, then the language, then falls back to English', () => {
    expect(pickLocale(['pt-BR'])).toBe('pt-BR');
    expect(pickLocale(['pt-PT', 'en'])).toBe('pt-BR');
    expect(pickLocale(['zh-TW'])).toBe('zh-CN');
    expect(pickLocale(['es-MX'])).toBe('es');
    expect(pickLocale(['nl', 'de-AT'])).toBe('de');
    expect(pickLocale(['nl'])).toBe('en');
    expect(pickLocale([])).toBe('en');
  });
});
