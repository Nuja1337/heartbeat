// Today's daily map: the level picker, the best play so far, the daily streak and the Play button.
// Home shows the short form and the Daily page adds the share button.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Analysis } from '../state/analysis';
import { bestOfDay, dailyHistory, dailyLaunch, dailyLevel } from '../state/daily';
import { startWithCurrentLevels } from '../state/launch';
import { getAppState, updatePrefs, usePrefs } from '../state/store';
import { localDateKey } from '../../shared/codes';
import { DAILY_LENGTH_SEC, GRADES } from '../../shared/catalog';
import { dayName, pct } from '../format';
import { t } from '../i18n';
import { ShareButton } from './ShareButton';
import { Button, GradeBadge, Notice, Panel, SectionTitle, Segmented } from './ui';

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }));

export function DailyCard({ data, full = false }: { data: Analysis; full?: boolean }) {
  const navigate = useNavigate();
  const [prefs] = usePrefs();
  const [error, setError] = useState<string | null>(null);
  const date = localDateKey(data.now);
  const level = dailyLevel(prefs.daily.level, data.suggestedLevel);
  const best = bestOfDay(dailyHistory(data.summaries), date);
  const launch = dailyLaunch(date, level, {});
  const grade = best ? GRADES.find((g) => g.id === best.grade) : undefined;

  const play = () => {
    // The date is read again here, so a page left open past midnight starts the new day's map.
    const today = localDateKey(Date.now());
    startWithCurrentLevels(navigate, dailyLaunch(today, level, {}), '/daily', getAppState().prefs.fullscreen, false).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : t('Could not read your module levels.')),
    );
  };

  return (
    <Panel marks className="flex h-full flex-col">
      <SectionTitle aside={dayName(data.now)}>{t('Daily map')}</SectionTitle>
      <div className="flex-1 space-y-4">
        <div>
          <div className="mb-1.5 text-sm text-ink-2">{t('Level')}</div>
          <Segmented
            legend={t('Daily map level')}
            value={level}
            options={LEVELS}
            onChange={(v) => updatePrefs((p) => ({ ...p, daily: { level: v } }))}
          />
          <p className="mt-1.5 text-sm text-ink-3">
            {t('Dynamic, {seconds} seconds, no mods.', { seconds: DAILY_LENGTH_SEC })}{' '}
            {prefs.daily.level === null ? t('The level is suggested from your recent plays.') : t('The map stays the same until midnight.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-micro uppercase text-ink-3">{t('Best today')}</div>
            {best && grade ? (
              <div className="flex items-center gap-3">
                <span className="font-display text-xl tabular-nums">{pct(best.accuracy)}</span>
                <GradeBadge grade={grade.id} />
              </div>
            ) : (
              <div className="text-ink-2">{t('Not played yet')}</div>
            )}
          </div>
          <div>
            <div className="text-micro uppercase text-ink-3">{t('Daily streak')}</div>
            <div className="font-display text-xl tabular-nums">
              {data.dailyStreak.current}{' '}
              <span className="font-sans text-base text-ink-2">
                {t('{n, plural, one {day} other {days}}', { n: data.dailyStreak.current })}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={play}>
          {best ? t("Play today's map again") : t("Play today's map")}
        </Button>
        {full && <ShareButton launch={launch} label={t("Share today's map")} />}
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}
