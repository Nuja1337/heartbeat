// One block per section of a map, as wide as the section is long and coloured by its role,
// with the accuracy under it. Training sets have no role and are drawn as plain blocks.

import type { SectionStat } from '../../data/schema';
import type { SectionRole } from '../../shared/types';
import { pct0 } from '../format';
import { msg, t } from '../i18n';

const ROLE_COLOR: Record<SectionRole, string> = {
  intro: 'var(--color-ink-3)',
  build: 'var(--color-data)',
  peak: 'var(--color-accent)',
  rest: 'var(--color-ink-2)',
  outro: 'var(--color-ink-3)',
};
const ROLE_LABEL: Record<SectionRole, string> = {
  intro: msg('Intro'),
  build: msg('Build'),
  peak: msg('Peak'),
  rest: msg('Rest'),
  outro: msg('Outro'),
};
const NEUTRAL = 'var(--color-line-2)';

export interface StripBlock {
  start: number;
  end: number;
  label: string;
  /** The section's role in words, or null for a plain block. A set can have one as well. */
  roleLabel: string | null;
  color: string;
  accuracy: number | null;
  misses: number;
  n: number;
}

/** The blocks of a strip. Sections with no length are dropped, and a set is named by its place in the play. */
export function stripBlocks(sections: readonly SectionStat[] | null): StripBlock[] {
  if (!sections) return [];
  let sets = 0;
  const out: StripBlock[] = [];
  for (const s of sections) {
    if (!(s.end > s.start)) continue;
    const isSet = s.focus === 'set';
    if (isSet) sets += 1;
    out.push({
      start: s.start,
      end: s.end,
      label: isSet ? t('Set {n}', { n: sets }) : s.role ? t(ROLE_LABEL[s.role]) : t('Section'),
      roleLabel: s.role ? t(ROLE_LABEL[s.role]) : null,
      color: s.role ? ROLE_COLOR[s.role] : NEUTRAL,
      accuracy: s.accuracy,
      misses: s.misses,
      n: s.n,
    });
  }
  return out;
}

/** What a screen reader says for a block: its name, its role when that adds to the name, then its numbers. */
export function blockName(b: Pick<StripBlock, 'label' | 'roleLabel' | 'accuracy' | 'misses'>): string {
  const role = b.roleLabel && b.roleLabel !== b.label ? b.roleLabel : null;
  if (b.accuracy === null) {
    return role ? t('{label}, {role}, no objects', { label: b.label, role }) : t('{label}, no objects', { label: b.label });
  }
  const values = { label: b.label, role: role ?? undefined, accuracy: pct0(b.accuracy), misses: b.misses };
  return role
    ? t('{label}, {role}, {accuracy} accuracy, {misses, plural, one {# miss} other {# misses}}', values)
    : t('{label}, {accuracy} accuracy, {misses, plural, one {# miss} other {# misses}}', values);
}

export function SectionStrip({ sections }: { sections: readonly SectionStat[] | null }) {
  const blocks = stripBlocks(sections);
  if (blocks.length === 0) return <p className="text-ink-2">{t('This play has no section data.')}</p>;
  const roles = new Set(blocks.map((b) => b.roleLabel));
  return (
    <figure className="m-0">
      <ol className="m-0 flex list-none gap-0.5 p-0" aria-label={t('Sections of the map in order')}>
        {blocks.map((b, i) => (
          <li key={i} style={{ flexGrow: b.end - b.start, flexBasis: 0, minWidth: 0 }} title={blockName(b)}>
            <span className="sr-only">{blockName(b)}</span>
            <div
              aria-hidden
              className="h-7 rounded-sm"
              style={{ background: `color-mix(in srgb, ${b.color} 28%, var(--color-surface-2))`, borderTop: `2px solid ${b.color}` }}
            />
            <div aria-hidden className="mt-1 truncate text-center text-xs text-ink-2">
              {b.accuracy === null ? t('none') : pct0(b.accuracy)}
            </div>
          </li>
        ))}
      </ol>
      {[...roles].some(Boolean) && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
          {(['intro', 'build', 'peak', 'rest', 'outro'] as const)
            .filter((r) => roles.has(t(ROLE_LABEL[r])))
            .map((r) => (
              <span key={r} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: ROLE_COLOR[r] }} />
                {t(ROLE_LABEL[r])}
              </span>
            ))}
        </figcaption>
      )}
    </figure>
  );
}
