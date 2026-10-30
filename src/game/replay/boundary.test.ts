// Adaptive replays must see a set only when the live play did (PLAN-2 4.11, "Playback"). Two cases from the review
// of the first playback step, where a replay that had every set from the start judged differently.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, MODES, PLAYFIELD_CENTER } from '../../shared/catalog';
import { decodeReplay, encodeReplay } from '../../shared/replay';
import type { InputInfo, LaunchRequest, PlayResult, ReplayData, SpinnerObject, Vec2 } from '../../shared/types';
import { GameSession } from '../engine/session';
import { createRng, hash32 } from '../map/rng';
import { openSetLevel, setupPlay } from '../modes/runner';
import { AutoPlayer, NOISY_PLAYER, PERFECT_PLAYER } from '../sim/autoplay';
import { runHeadless } from '../sim/headless';
import { launchFor } from '../testing/fixtures';
import { ReplayRunner } from './feed';

const INFO: InputInfo = { pointer: 'mouse', rawInput: false, unadjusted: false, sensitivity: 1, pointerHz: 1000, displayHz: 240 };

function open(launch: LaunchRequest) {
  const setup = setupPlay(launch);
  const session = new GameSession({ map: setup.map, launch, controller: setup.controller, progressMs: setup.progressMs });
  const player = new AutoPlayer(PERFECT_PLAYER, createRng(hash32(launch.seed, 'player')));
  return { session, player };
}

function replayOf(result: PlayResult): ReplayData {
  return decodeReplay(encodeReplay(result.replay as ReplayData));
}

/** Run the replay through a fresh session and finish it. */
function rerun(replay: ReplayData): { result: PlayResult; judgments: string } {
  const run = new ReplayRunner(replay);
  run.feedAll();
  return { result: run.session.finish(replay.status, { startedAt: 0, endedAt: 0, input: INFO }), judgments: run.judgments() };
}

describe('a pause at a set boundary', () => {
  const launch: LaunchRequest = { ...launchFor(DEFAULT_DIFFICULTY, 31, 40, [], 'jumps'), options: MODES.jumps.defaultOptions, levels: { jumps: 4 } };

  it('marks the same objects afterPause in the replay as in the live play', () => {
    const { session, player } = open(launch);
    const lastOfSet0 = session.objs[session.objs.length - 1]!.obj;
    const pauseAt = lastOfSet0.time;
    expect(session.objs.length).toBeGreaterThan(5);
    const pos: Vec2 = { x: 0, y: 0 };
    let planned = 0;
    let paused = false;
    let sawNextSet = false;
    for (let t = 1; t < 200000 && !session.over && !session.failed; t++) {
      while (planned < session.objs.length) {
        player.plan(session.map.objects[planned]!, session.features[planned]!);
        planned++;
      }
      player.posAt(t, pos);
      session.move(t, pos);
      if (!paused && t >= pauseAt) {
        paused = true;
        session.advance(t);
        // The next set does not exist yet, so the pause cannot mark its first object.
        sawNextSet = session.objs.some((o) => o.obj.set > 0);
        session.notePause(t);
        session.noteResume(t);
      }
      player.drain(t, (e) => (e.kind === 'press' ? session.press(e.slot, e.t, null) : session.release(e.slot, e.t)));
      session.advance(t);
    }
    expect(paused).toBe(true);
    expect(sawNextSet).toBe(false);
    const live = session.finish('completed', { startedAt: 0, endedAt: 0, input: INFO });
    const replay = replayOf(live);
    const again = rerun(replay);
    expect(live.records.length).toBeGreaterThan(40);
    expect(again.result.records).toEqual(live.records);
    expect(again.result.score).toBe(live.score);
    expect(again.judgments).toBe(replay.judgments);
    // The first object after the pause is in set 1, and it was not marked.
    const firstOfSet1 = live.records.find((r) => r.set === 1);
    expect(firstOfSet1?.afterPause).toBe(false);
  });
});

describe('a long stall across a set boundary', () => {
  const launch: LaunchRequest = {
    ...launchFor(DEFAULT_DIFFICULTY, 77, 60, [], 'mix'),
    options: { ...MODES.mix.defaultOptions, mixModules: ['jumps', 'spinning'] },
    levels: { jumps: 4, spinning: 3 },
  };

  it('judges the spinner of the next set the same in the replay as live', () => {
    const { session, player } = open(launch);
    const n0 = session.objs.length;
    const last = session.objs[n0 - 1]!.obj;
    const pos: Vec2 = { x: 0, y: 0 };
    let planned = 0;
    let t = 0;
    let stalled = false;
    let ang = 0;
    let spinnerAppendedAtPress = true;
    const around = (): Vec2 => {
      ang += 0.02;
      return { x: PLAYFIELD_CENTER.x + 100 * Math.cos(ang), y: PLAYFIELD_CENTER.y + 100 * Math.sin(ang) };
    };
    while (t < 300000 && !session.over && !session.failed) {
      t += 1;
      if (!stalled && t >= last.time - 30) {
        // One long frame: the last jump of set 0 is never pressed, a key goes down, and 2.5 s of coalesced moves
        // circling the centre arrive before the next advance.
        stalled = true;
        session.move(t, { x: PLAYFIELD_CENTER.x + 100, y: PLAYFIELD_CENTER.y });
        session.press('key1', t, null);
        spinnerAppendedAtPress = session.objs.length > n0;
        for (let k = 1; k <= 2500; k++) session.move(t + k, around());
        t += 2500;
        session.advance(t);
        const spinner = session.objs[n0]!.obj as SpinnerObject;
        expect(spinner.kind).toBe('spinner');
        let held = true;
        while (t < spinner.endTime + 50) {
          t += 1;
          session.move(t, around());
          if (held && session.activeSpin?.spinner && session.activeSpin.spinner.rotations >= spinner.rotationsRequired - 0.15) {
            session.release('key1', t);
            held = false;
          }
          session.advance(t);
        }
        if (held) session.release('key1', t);
        // The player skips the rest of set 1.
        planned = session.objs.length;
        continue;
      }
      while (planned < session.objs.length) {
        player.plan(session.map.objects[planned]!, session.features[planned]!);
        planned++;
      }
      player.posAt(t, pos);
      session.move(t, pos);
      player.drain(t, (e) => (e.kind === 'press' ? session.press(e.slot, e.t, null) : session.release(e.slot, e.t)));
      session.advance(t);
      if (stalled && t > (session.objs[n0]!.obj as SpinnerObject).endTime + 3000) break;
    }
    expect(stalled).toBe(true);
    // The live play had no spinner yet while the stall's moves arrived, so none of them could start it early.
    expect(spinnerAppendedAtPress).toBe(false);
    const live = session.finish('quit', { startedAt: 0, endedAt: 0, input: INFO });
    const replay = replayOf(live);
    const again = rerun(replay);
    const a = live.records.find((r) => r.index === n0);
    const b = again.result.records.find((r) => r.index === n0);
    expect(a?.spinner).toBeDefined();
    // The review found 'solid' live and 'crisp' in the replay.
    expect(b?.judgment).toBe(a?.judgment);
    expect(b?.spinner?.rotations).toBe(a?.spinner?.rotations);
    expect(again.result.records).toEqual(live.records);
    expect(again.judgments).toBe(replay.judgments);
  });
});

describe('the level of a set that was still open', () => {
  it('is rebuilt from the closed sets and matches what the live runner had', () => {
    const launch: LaunchRequest = {
      ...launchFor(DEFAULT_DIFFICULTY, 8, 60, [], 'mix'),
      options: { ...MODES.mix.defaultOptions, mixModules: ['jumps', 'streams', 'tracking'] },
      levels: { jumps: 4, streams: 4, tracking: 3 },
    };
    const seen = new Set<number>();
    // Stop at several times, so different sets are open at the end.
    for (const maxMs of [9000, 17000, 26000, 38000]) {
      const { result, session } = runHeadless({ launch, model: NOISY_PLAYER, stepMs: 4, maxMs });
      const replay = replayOf(result);
      const live = session.levelStatus() as { level: number; set: number };
      const run = new ReplayRunner(replay);
      run.feedAll();
      expect(run.session.levelStatus(), `stop at ${maxMs}`).toEqual(live);
      expect(openSetLevel(launch, replay.levels, live.set), `stop at ${maxMs}`).toBe(live.level);
      seen.add(live.set);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
