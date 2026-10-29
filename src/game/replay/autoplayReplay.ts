// A replay made by a simulated player, for the skin preview and the replay viewer's demo (PLAN-2 5.2). Pure.

import type { LaunchRequest, ReplayData } from '../../shared/types';
import { PERFECT_PLAYER } from '../sim/autoplay';
import type { PlayerModel } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';

/**
 * Plays `launch` headless with `model` and returns the recording. `stepMs` is the time between two advances,
 * and so between two cursor samples. Throws when the play could not be recorded.
 */
export function autoplayReplay(launch: LaunchRequest, model: PlayerModel = PERFECT_PLAYER, stepMs = 4): ReplayData {
  const { result } = runHeadless({ launch, model, stepMs });
  if (!result.replay) throw new Error('The autoplay could not be recorded.');
  return result.replay;
}
