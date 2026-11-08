import { t } from '../i18n';
import { Button, Notice } from './ui';

/** Shown when the saved plays can't be read. The retry reads them again. */
export function AnalysisError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <Notice tone="bad">
      <span className="flex flex-wrap items-center gap-3">
        <span>{t('Your plays could not be read. {message}', { message })}</span>
        <Button size="sm" onClick={onRetry}>
          {t('Try again')}
        </Button>
      </span>
    </Notice>
  );
}
