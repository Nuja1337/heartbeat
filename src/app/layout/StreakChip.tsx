// The streak chip sits on the right of the top bar, next to the settings icon. It shows the current play streak
// and renders nothing at 0, so the bar reserves no space for it.

import { Link } from 'react-router';
import { IconFlame } from '../components/icons';
import { useStreak } from '../state/analysis';

export function StreakChip() {
  const streak = useStreak();
  if (!streak || streak.current === 0) return null;
  const label = `${streak.current} ${streak.current === 1 ? 'day' : 'days'} in a row${streak.atRisk ? '. Play today to keep it.' : ''}`;
  return (
    <Link
      to="/"
      aria-label={label}
      title={label}
      // Hidden on the narrowest phones, where the tabs need the room. The streak is on Home as well.
      className={`flex h-7 shrink-0 items-center max-[380px]:hidden gap-1 rounded-full border px-2.5 font-display text-sm tabular-nums transition ${
        streak.atRisk ? 'border-line-2 text-ink-2 hover:text-ink' : 'border-accent/40 bg-accent/10 text-accent'
      }`}
    >
      <IconFlame size={16} />
      {streak.current}
    </Link>
  );
}
