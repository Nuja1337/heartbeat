// Runs a whole play in Node: runner, session and a simulated player. No DOM, no real time.

import { INPUT_SLOT_ORDER } from '../../shared/catalog';
import type { InputInfo, LaunchRequest, PlayResult, PlayStatus, Vec2 } from '../../shared/types';
import { GameSession } from '../engine/session';
import type { FeedbackListener } from '../engine/session';
import { createRng } from '../map/rng';
import { hash32 } from '../map/rng';
import { setupPlay } from '../modes/runner';
import { AutoPlayer } from './autoplay';
import type { PlayerModel } from './autoplay';

export interface HeadlessOptions {
  launch: LaunchRequest;
  model: PlayerModel;
  /** Stop after this much play time even if the play is not over. */
  maxMs?: number;
  /** Seed of the simulated player's noise. */
  playerSeed?: number;
  /** Play time between two session advances, ms. Default 1. The player moves the cursor at every step. */
  stepMs?: number;
  /** Log the input so the result carries a replay. Default true. */
  record?: boolean;
  /**
   * Play times at which the player pauses and resumes at once, like the game does: advance, let go of held keys,
   * notePause, then (play time stands still) noteResume and a cursor move that puts the cursor where it is.
   */
  pauses?: number[];
  listener?: FeedbackListener;
  /** Called about every 16 ms of play time, for tests that draw. */
  onFrame?: (t: number, session: GameSession) => void;
}

export interface HeadlessRun {
  result: PlayResult;
  session: GameSession;
}

const INPUT: InputInfo = { pointer: 'mouse', rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: 1000, displayHz: 240 };

export function runHeadless(opts: HeadlessOptions): HeadlessRun {
  const { launch, model } = opts;
  const setup = setupPlay(launch);
  const session = new GameSession({ map: setup.map, launch, controller: setup.controller, progressMs: setup.progressMs, record: opts.record });
  if (opts.listener) session.on(opts.listener);
  const player = new AutoPlayer(model, createRng(opts.playerSeed ?? hash32(launch.seed, 'player')));
  const pos: Vec2 = { x: 0, y: 0 };
  let planned = 0;
  const limit = opts.maxMs ?? launch.lengthSec * 1000 * 3 + 60000;
  const step = Math.max(1, opts.stepMs ?? 1);
  const pauses = (opts.pauses ?? []).slice().sort((a, b) => a - b);
  let nextPause = 0;
  let t = 0;
  let nextFrame = 16;
  while (t < limit && !session.over && !session.failed) {
    t += step;
    while (planned < session.objs.length) {
      player.plan(session.map.objects[planned]!, session.features[planned]!);
      planned++;
    }
    player.posAt(t, pos);
    session.move(t, pos);
    player.drain(t, (e) => (e.kind === 'press' ? session.press(e.slot, e.t, null) : session.release(e.slot, e.t)));
    session.advance(t);
    if (nextPause < pauses.length && t >= (pauses[nextPause] as number)) {
      nextPause++;
      for (let i = 0; i < INPUT_SLOT_ORDER.length; i++) if (session.mask & (1 << i)) session.release(INPUT_SLOT_ORDER[i] as (typeof INPUT_SLOT_ORDER)[number], t);
      session.notePause(t);
      session.noteResume(t);
      session.move(t, pos);
    }
    if (opts.onFrame && t >= nextFrame) {
      opts.onFrame(t, session);
      nextFrame = t - (t % 16) + 16;
    }
  }
  const status: PlayStatus = session.failed ? 'failed' : session.over ? 'completed' : 'quit';
  const result = session.finish(status, { startedAt: 0, endedAt: 0, input: INPUT });
  return { result, session };
}
