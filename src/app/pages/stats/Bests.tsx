import { Link } from 'react-router';
import { computeBests } from '../../../analytics/bests';
import { MODES } from '../../../shared/catalog';
import { Card, PageHeader, SectionTitle } from '../../components/ui';
import { EMPTY_STATS, INTRO } from '../../copy';
import { dateOf, int, level, pct } from '../../format';
import { useAnalysis } from '../../state/analysis';
import { t } from '../../i18n';

export function Bests() {
  const { data } = useAnalysis();
  if (!data) return <p className="text-ink-2">{t('Loading.')}</p>;
  const bests = computeBests(data.summaries);
  return (
    <>
      <PageHeader title={t('Bests')} intro={INTRO.bests} />
      {bests.dynamic.length === 0 && bests.modules.length === 0 ? (
        <Card>
          <p className="text-ink-2">
            {data.summaries.length === 0 ? t(EMPTY_STATS) : t('Only completed plays count. Finish a map to set a best.')}
          </p>
        </Card>
      ) : (
        <div className="space-y-8">
          <section>
            <SectionTitle aside={t('One row for each level, mod set and length')}>{MODES.dynamic.label}</SectionTitle>
            <Card className="overflow-x-auto">
              {bests.dynamic.length === 0 ? (
                <p className="text-ink-2">{t('No completed Dynamic plays yet.')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-2">
                      <th className="py-1 pr-4 font-normal">{t('Setting')}</th>
                      <th className="pr-4 font-normal">{t('Best score')}</th>
                      <th className="pr-4 font-normal">{t('Best accuracy')}</th>
                      <th className="pr-4 font-normal">{t('Best combo')}</th>
                      <th className="font-normal">{t('Plays')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bests.dynamic.map((b) => (
                      <tr key={b.key} className="border-t border-line">
                        <td className="py-1.5 pr-4">{b.label}</td>
                        <td className="pr-4">
                          <Link className="text-accent hover:underline" to={`/stats/play/${b.score.id}`}>
                            {int(b.score.score)}
                          </Link>
                        </td>
                        <td className="pr-4">
                          <Link className="text-accent hover:underline" to={`/stats/play/${b.accuracy.id}`}>
                            {pct(b.accuracy.accuracy)}
                          </Link>
                        </td>
                        <td className="pr-4">
                          <Link className="text-accent hover:underline" to={`/stats/play/${b.combo.id}`}>
                            {int(b.combo.maxCombo)}
                          </Link>
                        </td>
                        <td>{b.plays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
          <section>
            <SectionTitle aside={t('Plays with no mods, or with Mirror alone')}>{t('Modules')}</SectionTitle>
            <Card className="overflow-x-auto">
              {bests.modules.length === 0 ? (
                <p className="text-ink-2">{t('No completed module plays yet.')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-2">
                      <th className="py-1 pr-4 font-normal">{t('Module')}</th>
                      <th className="pr-4 font-normal">{t('Best level')}</th>
                      <th className="pr-4 font-normal">{t('Current level')}</th>
                      <th className="font-normal">{t('Reached')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bests.modules.map((m) => (
                      <tr key={m.moduleId} className="border-t border-line">
                        <td className="py-1.5 pr-4">{MODES[m.moduleId].label}</td>
                        <td className="pr-4">
                          <Link className="text-accent hover:underline" to={`/stats/play/${m.summary.id}`}>
                            {level(m.level)}
                          </Link>
                        </td>
                        <td className="pr-4">{data.progress[m.moduleId] ? level(data.progress[m.moduleId]!.level) : t('none')}</td>
                        <td className="text-ink-2">{dateOf(m.summary.endedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
