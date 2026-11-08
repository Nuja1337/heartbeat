# Heartbeat 2.0 plan

Repo: `C:\Users\Nuja\Documents\GitHub\heartbeat`. This plan builds on `docs/PLAN.md`, the 1.0 design. "PLAN §n" means a 1.0 section and "§n" means a section of this file. Code comments cite "PLAN-2 §n".

## 1. Summary

2.0 keeps the 1.0 core: the engine, judging, the contract ids and the local-first data. It adds five things on top.

- **Feel.** A new renderer with skins, colour-blind palettes, follow points, bursts, spinner art and a frame-time graph. Three synthesized sound sets, a metronome, and visual and audio offsets with a calibration screen.
- **Replays.** The engine logs every call it makes to the game session on a fixed time and position grid. Running the log through the same session reproduces the play exactly. That gives a replay viewer with scrubbing, speed control and "jump to this miss", plus new movement metrics: when you leave a target, where your first motion lands, and how much you correct afterwards.
- **Maps.** Generator 2 plans each map as intro, build, peak, rest and outro on a smooth intensity curve. It adds stacks, triples, cut and spaced streams, polygon jumps, new slider shapes and mirrored sections, and it never drops a spinner after placing it.
- **Coaching.** Insights get minimum-effect gates, better ranking and three movement rules. New views cover aim throughput, rating history, a skill radar and a weekly report. A first-run setup includes a placement test, and every day gets a training plan, plus streaks, a weekly goal, milestones, a daily challenge and share codes.
- **App.** A distinct visual system (§9), a home dashboard, Results 2.0, code-split routes, an error boundary and an offline PWA.

Formats change by addition only. The database goes from version 1 to 2 by adding a `replays` store, and 1.0 rows are lifted on read. 1.0 export files still import.

---

## 2. Phases

Rules for every phase:
- At most two builders at once, and they own disjoint files. Builders never deploy, push or touch remote resources.
- Every builder pastes the writing-rules block from PLAN §14 into its work and also follows these rules: never write "unstable rate", "pp", "Hidden", "Hard Rock", "Double Time", "300" (as a judgment) or "beatmap". Grade, milestone, mod, palette and sound-set names come only from `catalog.ts`.
- Every new pure module gets Vitest tests (node environment). `npm run check` stays green at the end of every brief.
- A reviewer checks each phase before the next starts. The app must be shippable after each phase.
- New contract entries that the engine doesn't support yet stay out of `allowedMods` and `MODE_ORDER` until the phase that implements them (see the main-session steps).

**Build order as run.** This replaces the pairing in the phases below. Each step's builders own the files their phase brief gives them, and a reviewer pass follows each step.

| Step | Builders | Notes |
|---|---|---|
| 1 | F1: §3 contract, `shared/replay.ts`, `shared/codes.ts` | Alone, because everything else codes against it |
| 2 | F2: `src/data/**`, `analytics/{summary,fixtures,bests}.ts` ∥ G1 | |
| 3 | U1 ∥ G2 | |
| 4 | U2 ∥ G3 | |
| 5 | U3 ∥ G4 | |
| 6 | U4 | |
| 7 | U5 | |
| 8 | Main session: review, browser pass, one deploy at the end | |

**Decisions taken by default** (§12, the owner can change any of them): bests keep comparing 1.0 and 2.0 plays through `scoringVersion`; the newest 100 replays plus kept ones; the daily map changes at local midnight; Space Grotesk is added; lime is the accent; 2.0 ships once at the end, after the owner exports a backup; the grade names as proposed; both new mods.

### Phase 0: golden fixtures, contract, formats

**0.1 Main session.** Tag the current commit `v1.0`. Get the architect review of §4 before anything below starts.

**0.2 Builder X (fixtures). Runs on unchanged 1.0 code.**
- Owns `src/integration/makeV1Fixture.test.ts` (new, `describe.skipIf(!process.env.MAKE_FIXTURE)`) and `src/data/fixtures/**` (new).
- Builds `src/data/fixtures/v1-export.json` with real 1.0 code paths (headless runner, `savePlay` on fake-indexeddb, `buildExport`). It holds 4 plays: Dynamic Level 3 with NOISY_PLAYER, Jumps, Mix, and one quit play with at least 20 objects. It also holds a drill, progress for 3 modules, a tier history, and settings that differ from the defaults in at least 5 fields.
- Check: the file exists, `validateExport` accepts it, and `npm run check` is green. The main session commits it. This file is the 1.0 reference forever and never gets regenerated.

**0.3 Main session.** Apply §3 to `src/shared/types.ts` and `src/shared/catalog.ts`, with these exceptions until their engine phases land: leave `bullseye` and `norings` out of `ALL_MODS` and `MODULE_MODS`, and keep `placement` out of `MODE_ORDER`. Bump `RECORD_VERSION` to 2. Then run `npm run check`.

**0.4 Builder F (formats and data).**
- Owns the new files `src/shared/replay.ts`, `src/shared/codes.ts` and their tests, plus `src/data/**`.
- May edit `src/analytics/summary.ts` and `src/analytics/fixtures.ts` only to emit the v2 summary shape with placeholder values: `sections`, `movement` and `throughput` are null, `milestones` is `[]`, `hasReplay` is false and `scoringVersion` is `SCORING_VERSION`.
- Builds everything in §4:
  - the replay codec (§4.3)
  - share codes, the daily seed and `localDateKey` (§4.8, §4.9)
  - DB v2 (§4.4), including the `onblocked` change
  - summary v2 and its upgrade step
  - the new object columns
  - `data/replays.ts`: `getReplay`, `getReplayRow`, `setReplayKeep`, `replayStorage`, `runReplayRetention`
  - `savePlay` storing `result.replay` (§4.4)
  - settings sanitizing (§4.6)
  - the meta helpers and the UiPrefs additions (§4.7)
  - export v2 with v1 import (§4.5)
  - the new `RuleId` values (§7.2) and the `DailyPlan` types (§4.7)
- Tests:
  1. Codec round trip on 50 random traces covering every op. A golden-bytes test on a fixed 5-event replay: the builder freezes the hex after review. Rejection of bad magic, newer versions, truncation, unknown ops and trailing bytes. A synthetic 1 kHz, 120 s human-like path (minimum-jerk plus noise) encodes at 4 bytes per event or less before gzip.
  2. Share codes: a round trip for every mode and option, preset and custom. The vector `AQABFc1bB1oAQAACBEM` decodes to Dynamic, preset 4, seed 123456789, 90 s, Mirror, generator 2. A single-character change fails the checksum. A newer version is rejected. Out-of-range values are clamped.
  3. `dailySeed('2026-11-01') === 1500758254` and `dailySeed('2027-01-01') === 2909596274`. `localDateKey` returns local dates.
  4. Migration: build a v1 database with `MIGRATIONS[1]` and the fixture rows, then open it at v2. Counts are equal, records unpack deep-equal to the fixture, summaries lift with the v2 defaults, settings keep their stored values and get defaults for the new fields, and `replays` exists and is empty.
  5. Importing the v1 fixture into a fresh v2 database gives the same result as test 4.
  6. `savePlay` with a synthetic `ReplayData` writes a gzip row and sets `hasReplay`. A PB is auto-kept. `getReplay` returns a deep-equal object. A failing encode still saves the play, without a replay.
  7. Export v2 with replays imports into a fresh database with equal bytes. With `includeReplays: false`, the imported plays have `hasReplay: false`.
  8. Retention with limit 2 and 5 replays, one of them kept, leaves the newest 2 plus the kept one, and the summaries are updated.
  9. Sanitizing: every new field accepts valid values and replaces invalid ones with the default, and a retry key equal to a hit key becomes `''`.
  10. While a v1 connection is open, the v2 open waits and then succeeds after the v1 connection closes.
- Check: `npm run check` is green, and the main session clicks through `?fake=1`.

**Phase 0 done:** tests green, the reviewer compares the code to §4 line by line, and the app behaves like 1.0. No deploy yet.

### Phase 1: recording and playback, plus the app foundation

**Builder G1 (engine).**
- Owns:
  - `src/game/engine/{session,game,input,cursor,clock}.ts`, a new `src/game/engine/decimate.ts`, and their tests
  - `src/game/rules/records.ts` and its test
  - `src/game/replay/**` (new: `recorder.ts`, `playback.ts`, `autoplayReplay.ts`)
  - `src/game/sim/**`
  - `src/game/index.ts`, `src/game/version.ts` (`ENGINE_VERSION = 2`) and `src/game/dev/harness.ts`
- Builds:
  - §5.1 quantization, decimation and recording
  - §5.2 playback, with both replay and autoplay sources
  - §5.3 movement metrics
  - §5.8 quick retry
  - passing `sections` and `beatOffsetMs` into `PlayMapInfo`, and the settings offsets into `InputInfo`
  - autoplay model knobs `leaveDelayMs` and `primaryShort` (a fraction) for planting data
  - exports `createPlayback` from `src/game/index.ts`
- Tests:
  1. Determinism. Run 20 headless plays (Dynamic L3 and L6, Jumps, Streams, Tracking, Spinning, Mix) with NOISY_PLAYER. Encode and decode the trace with `shared/replay.ts`, then re-run it through a fresh session. Records, score, counts and max combo must be deep-equal, and they must stay equal when the headless loop calls `advance` every 1 ms and the original every 7 ms.
  2. Every logged time sits on the 1/64 ms grid and every logged position on the 1/16 grid.
  3. `Decimator` feeds at most 2000 samples per second and flushes the pending sample before every press, release, advance and pause.
  4. The metric fixtures from §5.3.
  5. With the fake DOM, holding the retry key 300 ms calls `onRetry` once with status `quit`, and letting go at 200 ms calls nothing.
  6. Playback: seeking to T and then playing forward gives the same score, combo and judged count as a straight run to T.
- Check: `npm run check`. In the harness, "Watch last play" replays a real play.

**Builder U1 (app foundation).**
- Owns `src/app/**`, `src/index.css`, `public/**`, and a new `src/app/pwa.ts`.
- Builds:
  - §9 tokens, fonts and components. Restyle every existing page to them without changing what the pages say.
  - the new Shell and nav
  - an `ErrorBoundary` around each route and the session. Its fallback has Reload, Go home and "Export your data".
  - `React.lazy` routes in `App.tsx` with a skeleton fallback (§8.1)
  - palette CSS variables driven by `settings.skin.palette`
  - on first run, `display.reduceMotion` follows `prefers-reduced-motion`
  - `onRetry` in `PlayScreen`. Save when `shouldSave` allows it, then remount with the same launch.
  - the PWA (§8.3): `public/sw.js`, `public/manifest.webmanifest`, `public/icon.svg`, registration in production only, the update banner and install-prompt capture
- Tests: `assetsFromManifest(json)` in `pwa.ts` (pure). The boundary and copy tests stay green.
- Check: `?fake=1` flow. The main session runs `npm run build`. The entry chunk must be at most 200 kB and no chunk over 250 kB.

**Main session (root files).**
- Add the font package (decision 4).
- `vite.config.ts`: `build.manifest: 'asset-manifest.json'`.
- `index.html`: manifest link, `theme-color` #07090e and an apple-touch-icon.
- `main.tsx`: change the `vite:preloadError` handler so it stores a timestamp and reloads at most once per 10 s, instead of a flag that never clears.
- Render `public/icons/{192,512,maskable-512}.png` from U1's `icon.svg` with the e2e browser.

**Phase 1 done:** reviewer pass, and a real play in Chrome is saved with a replay that the harness plays back with 0 mismatches. First 2.0 deploy here if decision 6 goes that way (see the deploy steps in Phase 6).

### Phase 2: rendering, and analytics as pure logic

**Builder G2 (renderer).**
- Owns `src/game/render/**`, `src/game/engine/{game,loop,playfield}.ts` and `src/game/replay/playback.ts` (render wiring only).
- Builds:
  - §5.4 in full
  - the visual offset (§5.6)
  - No Rings drawing and the Bullseye inner ring (§5.7, drawing only)
  - the frame graph and `InputInfo.frameP99Ms`
  - skins and palettes
  - the canvas font stack
- Tests (pure):
  - approach geometry for all three styles
  - pop-up layout, where the label box never intersects the miss X box for r from 16 to 80
  - follow-point reveal
  - the palette resolver
  - renderer smoke tests for every style and palette with the fake canvas
  - a pool test: 600 frames on a busy Level 8 map leave the particle and pop-up pools at their fixed sizes
- Check: in the harness on a 240 Hz display, a Level 8 map keeps p99 frame time under 4.2 ms (main session).

**Builder U2 (analytics).**
- Owns `src/analytics/**`, plus `src/data/plays.ts` for wiring milestones into `savePlay`.
- Builds §7.1 to §7.6.
- Tests:
  - every function in §7
  - the bot fixture (records from PERFECT and NOISY players) fires no insight
  - a property test on contrast copy, so two displayed numbers are never equal
  - each new rule fires on planted data and stays silent below its minimum n and threshold
  - ratings recompute from `raw` and `performance`
  - grades, streaks across DST and month ends, the weekly goal, milestone detection, the daily plan for each insight situation
- Check: `npm run check`. Existing pages still render through `?fake=1`.

**Main session:** add `norings` to `ALL_MODS` and `MODULE_MODS`.

**Phase 2 done:** reviewer pass. The 1% against 1% insight can't appear, and Miss no longer overlaps its X.

### Phase 3: audio and calibration engine, and app pages A

**Builder G3 (engine).**
- Owns:
  - `src/game/audio/**`
  - `src/game/calibrate/**` (new)
  - `src/game/engine/session.ts` (Bullseye cap only) and `src/game/engine/game.ts` (metronome scheduler hook)
  - `src/game/modes/**` (placement)
  - `src/game/map/generator.ts` (set `beatOffsetMs = t0` only) and `src/game/map/mods.ts` (scale `beatOffsetMs` by rate)
  - `src/game/index.ts` (export `createCalibration`)
- Builds §5.5, §5.6 (calibration), §5.7 (Bullseye judging) and §5.9 (placement).
- Tests:
  - every feedback sound has a recipe in each set
  - `beatsInWindow` and the play-time to context-time mapping
  - `calibrationResult`
  - the Bullseye cap: radial 0.49r Crisp stays Crisp, 0.51r Crisp becomes Rough, misses are unchanged
  - placement: 10 sets in module order, step 1 at the start, final levels for all five modules, and the play ends after set 10
  - `applyMods` divides `beatOffsetMs` by the rate
- Check: harness buttons for the metronome and calibration (main session listens).

**Builder U3 (pages A).**
- Owns:
  - `src/app/pages/{Home,Results,Replay,Daily}.tsx` and `src/app/pages/stats/**`
  - `src/app/charts/**`
  - new components `src/app/components/{GradeBadge,Counter,SectionStrip,Radar,PlanCard,StreakCard,InsightCard}.tsx`
  - `src/app/state/{daily,plan,analysis}.ts`
  - `App.tsx` (routes `/replay/:id` and `/daily`)
- Builds §8.4 (Home), §8.5 (Results), §8.6 (Replay), §8.7 (Stats additions) and §8.8 (Daily).
- Tests (pure helpers): markers from records, seek target for a miss, counter easing, plan step status from summaries.
- Check: `?fake=1` flow. Real replays play in `/replay/:id`.

**Main session:** add `bullseye` to `ALL_MODS`.

**Phase 3 done:** reviewer pass.

### Phase 4: generator 2, and app pages B

**Builder G4 (generator).**
- Owns `src/game/map/**`, `src/game/modes/modules.ts`, `src/game/version.ts` (`GENERATOR_VERSION = 2`) and `src/integration/calibrate.test.ts`.
- Builds §6.
- Tests: the 1.0 constraint suite plus rules 9 to 14 from §6.4 on 8 presets × 50 seeds and 3 custom extremes, determinism, the speed budget, pattern frequencies by complexity, exactness of mirrored sections, and the calibration assertions in §6.5.
- Report: measured aim demand per preset and any `LEVEL_PRESETS` changes needed to hit the anchors.
- Check: `CALIBRATE=1 npx vitest run src/integration/calibrate.test.ts`.

**Builder U4 (pages B).**
- Owns:
  - `src/app/pages/{Settings,PlaySetup,Train,ModuleSetup,Share}.tsx`
  - `src/app/state/launch.ts`
  - new components `src/app/components/{SkinPreview,ModeCard,MapPreview,ShareBox,OffsetField}.tsx`
  - `App.tsx` (route `/s/:code`)
- Builds §8.9 (Settings), §8.10 (Play setup with preview and graph), §8.11 (Train cards) and §8.12 (share links).
- Tests: share text building, skin-preview launch, `demandTimeline` usage.
- Check: `?fake=1`. The skin preview runs autoplay. Share links round-trip.

**Main session:** apply G4's report. Set `DEMAND_ANCHORS.aim[0] = 4.6` and change `LEVEL_PRESETS` only as reported.

**Phase 4 done:** reviewer pass. The owner plays Level 3 and Level 6 maps and says whether they read as designed.

### Phase 5: onboarding, docs and integration

**Builder U5.**
- Owns:
  - `src/app/pages/{Welcome,Calibrate}.tsx` and `src/app/state/onboarding.ts`
  - `src/app/pages/Home.tsx` (first-run card only) and `App.tsx` (routes `/welcome` and `/calibrate`)
  - `README.md`
  - `src/app/copy.test.ts` (add "unstable rate", `/\bpp\b/i`, the case-sensitive `/\bHidden\b/`, and `public/manifest.webmanifest` to the targets)
  - `src/integration/pipeline.test.ts` (plant late leave and short first motion, and expect those rules at the top)
- Builds §8.13. The README covers 2.0, with no personal details.
- Check: `npm run check`. A first-run flow on an empty profile goes through calibration and placement and ends with levels set.

**Main session:** add `placement` where onboarding launches it. It stays out of `MODE_ORDER`.

### Phase 6: review, browser pass and deploy (main session)

1. Reviewer pass on the whole diff since `v1.0`. Architect "last review" of the migration, the formats and the service worker before the first deploy that contains DB v2.
2. Run the browser checklist (§10) and turn findings into bug briefs.
3. Before the first 2.0 deploy, ask the owner to export a backup from Settings, Data on the live site.
4. `npm run deploy`. Check the deep links `/stats`, `/replay/<id>` and `/s/<code>`, check that a 1.0 profile upgrades with its plays intact, and check the offline reload.

---

## 3. Contract changes

### 3.1 `src/shared/types.ts`: additions and changed lines

Everything not shown stays as it is.

```ts
/* ids: append only */
export type ModeId = /* 1.0 values */ | 'placement';
export type ModId = /* 1.0 values */ | 'bullseye' | 'norings';
export type PatternTag = /* 1.0 values */ | 'stack' | 'cutstream' | 'spacedstream' | 'polygon';
export type GradeId = 'pinpoint' | 'sharp' | 'clean' | 'steady' | 'loose' | 'scattered';
export type MilestoneId =
  | 'first-play' | 'plays-50' | 'plays-250' | 'hours-5' | 'hours-25' | 'streak-7' | 'streak-30'
  | 'combo-100' | 'combo-500' | 'no-miss' | 'daily-7' | 'drill-better' | 'placement'
  | 'clear-1' | 'clear-2' | 'clear-3' | 'clear-4' | 'clear-5' | 'clear-6' | 'clear-7' | 'clear-8';

/** Where a play was started. Absent on 1.0 plays, which count as manual. */
export type LaunchSource =
  | { kind: 'manual' }
  | { kind: 'daily'; date: string } // local date YYYY-MM-DD
  | { kind: 'plan'; date: string; step: number } // step is 0-based
  | { kind: 'share'; code: string };

export type SectionRole = 'intro' | 'build' | 'peak' | 'rest' | 'outro';

export interface MapSection {
  start: Ms;
  end: Ms;
  intensity: number;
  focus: SectionFocus;
  /** Dynamic maps from generator 2. Absent on adaptive sets and older maps. */
  role?: SectionRole;
  /** The second half of the section mirrors the first. */
  mirrored?: boolean;
}

export interface GeneratedMap {
  /* 1.0 fields */
  /** Play time of beat 0 of the beat grid, after rate. Absent when the map has no steady beat. */
  beatOffsetMs?: Ms;
}

// SliderObject.shape doc changes to: straight = one line, arc = one arc, curve = anything else.

export interface LaunchRequest {
  /* 1.0 fields */
  source?: LaunchSource;
}

export interface MovementMetrics {
  /* 1.0 fields */
  /** From the start of the movement window to the start of the move toward this target. */
  leaveMs?: Ms | null;
  /** End of the first (main) motion relative to the center, with the same axes and signs as aimAlong and aimLateral. */
  primaryAlong?: number | null;
  primaryLateral?: number | null;
  /** When the first motion ended, relative to this object's time. Negative = before it. */
  primaryEndMs?: Ms | null;
  /** Cursor path length from the end of the first motion to the press. */
  correctionPath?: number | null;
}

export interface InputInfo {
  /* 1.0 fields */
  visualOffsetMs?: number;
  audioOffsetMs?: number;
  /** 99th percentile frame time during play, ms. */
  frameP99Ms?: number | null;
}

export interface PlayMapInfo {
  /* 1.0 fields */
  sections?: MapSection[];
  beatOffsetMs?: Ms;
}

export interface PlayResult {
  /* 1.0 fields */
  /** Absent if recording failed. */
  replay?: ReplayData;
}

/* ------------------------------------------------------------ replay */

/** Every call the engine made to GameSession, in order. Times on a 1/64 ms grid, positions on a 1/16 unit grid. */
export interface InputTrace {
  count: number;
  /** TRACE_OP codes. */
  ops: Uint8Array;
  t: Float64Array;
  /** Set for ops that carry a position (move, pressAt). 0 elsewhere. */
  x: Float32Array;
  y: Float32Array;
}

export interface ReplayData {
  /** REPLAY_FORMAT. */
  format: number;
  engineVersion: number;
  launch: LaunchRequest;
  /** The map as played: mods applied and every adaptive set included. */
  map: PlayableMap;
  progressMs: Ms;
  status: PlayStatus;
  /** Session time at the end. Equals PlayResult.playedMs. */
  endT: Ms;
  /** Final judgment per object index: c, s, r, m, or '-' when not judged. */
  judgments: string;
  levels: LevelStep[];
  trace: InputTrace;
}

/* ---------------------------------------------------------- settings */

export type SoundSetId = 'glass' | 'wood' | 'pulse';
export type PaletteId = 'heartbeat' | 'classic' | 'clearview' | 'contrast';
export type CursorStyle = 'ring' | 'cross' | 'dot';
export type ApproachStyle = 'ring' | 'fill' | 'brackets';
export type MetronomeMode = 'off' | 'beat' | 'bar';

export interface Settings {
  v: 1;
  input: {
    /* 1.0 fields */
    /** KeyboardEvent.code held 0.3 s to restart. '' = off. Never Escape or a hit key. */
    retryKey: string;
  };
  audio: {
    /* 1.0 fields */
    soundSet: SoundSetId;
    metronome: MetronomeMode;
    /** 0..1 */
    metronomeVolume: number;
    /** -100..300. The metronome plays this many ms earlier. */
    offsetMs: number;
  };
  display: {
    /* 1.0 fields */
    /** -50..150. Objects are drawn this many ms ahead of play time. */
    visualOffsetMs: number;
    frameGraph: boolean;
  };
  skin: {
    palette: PaletteId;
    cursorStyle: CursorStyle;
    approach: ApproachStyle;
    fieldGrid: boolean;
    clickRipple: boolean;
  };
  goals: {
    /** 0 = no goal. 0..600, step 15. */
    weeklyMinutes: number;
  };
  data: {
    /* 1.0 fields */
    /** Newest replays kept, besides kept ones. null = all. */
    replayLimit: number | null;
  };
  updatedAt: number;
}

/* ----------------------------------------------------------- game API */

export interface GameCallbacks {
  /* 1.0 members */
  /** The player held the retry key. The play ended with status 'quit'. When absent, the key does nothing. */
  onRetry?(result: PlayResult): void;
}

export type TestSound = 'hit' | 'miss' | 'combo' | 'tick' | 'metronome' | 'countdown';
export type PlayTestSound = (settings: Settings, sound: TestSound) => void;

export type PlaybackSource =
  | { kind: 'replay'; replay: ReplayData }
  | { kind: 'autoplay'; launch: LaunchRequest; loop: boolean };
export interface PlaybackInfo {
  durationMs: Ms;
  /** Objects whose judgment in this run differs from ReplayData.judgments. 0 for autoplay. */
  mismatches: number;
}
export interface PlaybackCallbacks {
  onReady(info: PlaybackInfo): void;
  /** At most 10 times a second while playing, and after every seek. */
  onTime(t: Ms): void;
  onEnd(): void;
  onError(message: string): void;
}
export interface PlaybackHandle {
  play(): void;
  pause(): void;
  seek(t: Ms): void;
  /** 0.25..2 */
  setSpeed(speed: number): void;
  setSettings(settings: Settings): void;
  destroy(): void;
}
export type CreatePlayback = (
  canvas: HTMLCanvasElement,
  source: PlaybackSource,
  settings: Settings,
  callbacks: PlaybackCallbacks,
) => PlaybackHandle;

export type CalibrationKind = 'visual' | 'audio';
export interface CalibrationResult {
  kind: CalibrationKind;
  /** Median of press time minus beat time, ms. Positive = late. */
  offsetMs: number;
  sdMs: number;
  taps: number;
}
export interface CalibrationCallbacks {
  onTap(taps: number, needed: number): void;
  onDone(result: CalibrationResult): void;
  onError(message: string): void;
}
export interface CalibrationHandle {
  restart(): void;
  destroy(): void;
}
export type CreateCalibration = (
  canvas: HTMLCanvasElement,
  kind: CalibrationKind,
  settings: Settings,
  callbacks: CalibrationCallbacks,
) => CalibrationHandle;
```

`src/game/index.ts` exports `createGame`, `previewLaunch`, `playTestSound`, `createPlayback`, `createCalibration`, `ENGINE_VERSION` and `GENERATOR_VERSION`.

### 3.2 `src/shared/catalog.ts`: additions and changed lines

```ts
export const RECORD_VERSION = 2;          // was 1
export const REPLAY_FORMAT = 1;
export const SCORING_VERSION = 1;         // bests compare within one scoring version (decision 1)
export const SHARE_CODE_VERSION = 1;

export const TRACE = { timeSteps: 64, posSteps: 16, maxSampleHz: 2000, chunkEvents: 65536 } as const;
/** Op codes in InputTrace.ops. pressAt + slot, press + slot and release + slot use INPUT_SLOT_ORDER. */
export const TRACE_OP = { move: 0, pressAt: 1, press: 5, release: 9, advance: 13, pause: 14, resume: 15 } as const;
export const INPUT_SLOT_ORDER: readonly InputSlot[] = ['key1', 'key2', 'mouse1', 'mouse2'];

/* Append only. Share codes store indexes into these. */
export const SHARE_MODE_ORDER: readonly ModeId[] = [
  'dynamic', 'jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing', 'stamina', 'warmup', 'mix', 'placement',
];
export const SHARE_MOD_ORDER: readonly ModId[] = [
  'fade', 'spotlight', 'fast', 'slow', 'tight', 'wide', 'mirror', 'nofail', 'onelife', 'bullseye', 'norings',
];
export const DIFFICULTY_KEYS: readonly (keyof DifficultySettings)[] = [
  'radius', 'approachMs', 'bpm', 'density', 'spacing', 'complexity', 'streams', 'streamMaxLength', 'sliders', 'spinners', 'timing',
];

// MODS: fade.conflicts becomes ['norings']. New entries:
//   bullseye: { id: 'bullseye', label: 'Bullseye', description: 'A hit outside the inner half of a target counts as Rough at best.',
//               multiplier: 1.1, conflicts: [], scope: 'dynamic' },
//   norings:  { id: 'norings', label: 'No Rings', description: 'Targets show no approach ring, so you read the timing from the spacing and the beat.',
//               multiplier: 1.05, conflicts: ['fade'], scope: 'all' },
// ALL_MODS gains 'norings' (end of Phase 2) and 'bullseye' (end of Phase 3). MODULE_MODS gains 'norings' (end of Phase 2).
export const BULLSEYE = { innerRadii: 0.5 } as const;

// MODES: new entry, not in MODE_ORDER.
//   placement: moduleMode('placement', 'Placement', 'Two short sets of each of five modules. It sets your starting level in each.',
//     ['aim', 'speed', 'tracking', 'precision', 'timing'], { lengthOptions: [240], defaultLengthSec: 240, setSize: 0, allowedMods: [] }),
export const PLACEMENT = {
  modules: ['jumps', 'streams', 'tracking', 'precision', 'timing'] as readonly ModuleId[],
  setsPerModule: 2,
  startLevel: 3,
  firstStep: 1,
  setSize: { jumps: 12, streams: 24, tracking: 4, precision: 8, timing: 12 } as Partial<Record<ModuleId, number>>,
} as const;

export const RETRY_HOLD_MS = 300;
export const DAILY_LENGTH_SEC = 90;

export function readingDemand(approachMs: number, mods: readonly ModId[]): number {
  return (1000 / approachMs) *
    (1 + (mods.includes('fade') ? 0.5 : 0) + (mods.includes('spotlight') ? 0.3 : 0) + (mods.includes('norings') ? 0.25 : 0));
}

// Phase 4, main session: DEMAND_ANCHORS.aim[0] becomes 4.6 (was 3.28). The other aim anchors stay.

export const GRADES: readonly { id: GradeId; label: string; minAccuracy: number; noMisses: boolean }[] = [
  { id: 'pinpoint', label: 'Pinpoint', minAccuracy: 0.97, noMisses: true },
  { id: 'sharp', label: 'Sharp', minAccuracy: 0.95, noMisses: false },
  { id: 'clean', label: 'Clean', minAccuracy: 0.9, noMisses: false },
  { id: 'steady', label: 'Steady', minAccuracy: 0.82, noMisses: false },
  { id: 'loose', label: 'Loose', minAccuracy: 0.7, noMisses: false },
  { id: 'scattered', label: 'Scattered', minAccuracy: 0, noMisses: false },
];
/** The first grade whose conditions hold. null for failed and quit plays. Grades are never stored. */
export function gradeFor(accuracy: number, misses: number, status: PlayStatus): GradeId | null {
  if (status !== 'completed') return null;
  return GRADES.find((g) => accuracy >= g.minAccuracy && (!g.noMisses || misses === 0))!.id;
}

export interface Palette {
  label: string;
  description: string;
  groups: readonly [string, string, string, string];
  judgments: Record<Judgment, string>;
}
export const PALETTES: Record<PaletteId, Palette> = {
  heartbeat: { label: 'Heartbeat', description: 'The default colours.', groups: ['#5ee7f2', '#ff7ab8', '#c9f25c', '#eef1f6'],
    judgments: { crisp: '#b49bff', solid: '#36d6b0', rough: '#ffb340', miss: '#ff4f6a' } },
  classic: { label: 'Classic', description: 'The colours from Heartbeat 1.0.', groups: ['#7dd3fc', '#f9a8d4', '#fde68a', '#e5e7eb'],
    judgments: { crisp: '#a78bfa', solid: '#2dd4bf', rough: '#f59e0b', miss: '#f43f5e' } },
  clearview: { label: 'Clear view', description: 'Easier to tell apart with red-green colour blindness.', groups: ['#56b4e9', '#e69f00', '#f0e442', '#ffffff'],
    judgments: { crisp: '#56b4e9', solid: '#ffffff', rough: '#e69f00', miss: '#cc79a7' } },
  contrast: { label: 'High contrast', description: 'Bright colours on a dark field.', groups: ['#ffffff', '#ffe600', '#00e5ff', '#ff5cf0'],
    judgments: { crisp: '#00e5ff', solid: '#ffffff', rough: '#ffe600', miss: '#ff3b3b' } },
};

export const SOUND_SETS: Record<SoundSetId, { label: string; description: string }> = {
  glass: { label: 'Glass', description: 'Bright, short tones, as in Heartbeat 1.0.' },
  wood: { label: 'Wood', description: 'Soft clicks with little pitch.' },
  pulse: { label: 'Pulse', description: 'Square-wave blips.' },
};

export const MILESTONES: Record<MilestoneId, { label: string; description: string }> = {
  'first-play': { label: 'First play', description: 'You finished your first play.' },
  'plays-50': { label: 'Fifty plays', description: 'You finished 50 plays.' },
  'plays-250': { label: '250 plays', description: 'You finished 250 plays.' },
  'hours-5': { label: 'Five hours of practice', description: 'Your plays add up to five hours.' },
  'hours-25': { label: '25 hours of practice', description: 'Your plays add up to 25 hours.' },
  'streak-7': { label: 'A week in a row', description: 'You played on seven days in a row.' },
  'streak-30': { label: 'A month in a row', description: 'You played on 30 days in a row.' },
  'combo-100': { label: 'Combo of 100', description: 'You reached a combo of 100.' },
  'combo-500': { label: 'Combo of 500', description: 'You reached a combo of 500.' },
  'no-miss': { label: 'No misses', description: 'You finished a Dynamic play of a minute or more without a miss.' },
  'daily-7': { label: 'Seven daily maps', description: 'You finished seven daily maps.' },
  'drill-better': { label: 'A drill that worked', description: 'One of your drills measured better than before.' },
  placement: { label: 'Starting levels set', description: 'You finished the placement test.' },
  'clear-1': { label: 'Level 1 cleared', description: 'You finished Level 1 with 90% accuracy or more.' },
  // 'clear-2' to 'clear-8' follow the same pattern.
};

export const SETTING_RANGES = {
  metronomeVolume: { min: 0, max: 1, step: 0.05 },
  audioOffsetMs: { min: -100, max: 300, step: 1 },
  visualOffsetMs: { min: -50, max: 150, step: 1 },
  weeklyMinutes: { min: 0, max: 600, step: 15 },
} as const;
export const REPLAY_LIMIT_CHOICES: readonly (number | null)[] = [25, 100, 300, null];

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  language: 'auto',
  input: { rawInput: false, sensitivity: 1, keys: ['KeyZ', 'KeyX'], mouseButtons: true, cursor: 'system', cursorScale: 1, cursorTrail: false, retryKey: 'Backquote' },
  audio: { master: 0.6, muted: false, hits: 0.8, effects: 0.8, ambient: 0.5, soundSet: 'glass', metronome: 'off', metronomeVolume: 0.5, offsetMs: 0 },
  display: { errorBar: true, pathHints: true, crispPopups: false, earlyLate: true, reduceMotion: false, lowLatency: true, showFps: false, visualOffsetMs: 0, frameGraph: false, theme: 'system', textSize: 'default', highContrast: false },
  skin: { palette: 'heartbeat', cursorStyle: 'ring', approach: 'ring', fieldGrid: true, clickRipple: true },
  goals: { weeklyMinutes: 60 },
  data: { detailRetentionDays: 365, replayLimit: 100 },
  updatedAt: 0,
};
```

`JUDGMENTS` keeps its labels and weights. Its colours become the fallback, and drawing code uses the active palette.

---

## 4. Data formats: REVIEW BEFORE BUILD

Everything in this section is costly to change once the owner has data. The architect reviews it before Phase 0, and again in code before the first deploy.

### 4.1 Versions

| Constant | 1.0 | 2.0 | Meaning of the change |
|---|---|---|---|
| `DB_VERSION` | 1 | 2 | Adds the `replays` store |
| `SUMMARY_VERSION` | 1 | 2 | New fields, lifted on read |
| `DETAIL_VERSION` | 1 | 1 | Only new optional columns, which readers already tolerate |
| `EXPORT_VERSION` | 1 | 2 | Optional `replay` per play, and more meta |
| `RECORD_VERSION` | 1 | 2 | Optional MovementMetrics and InputInfo fields |
| `MAP_FORMAT` | 1 | 1 | Optional `beatOffsetMs`, `role` and `mirrored` |
| `ENGINE_VERSION` | 1 | 2 | Quantized input and recording |
| `GENERATOR_VERSION` | 1 | 2 | §4.10 |
| `REPLAY_FORMAT` | none | 1 | §4.3 |
| `SCORING_VERSION` | none | 1 | Bests compare within one scoring version |
| `SHARE_CODE_VERSION` | none | 1 | §4.8 |

HitRecord meanings and signs are unchanged: along positive is overshoot, lateral positive is right of movement, turn 0 is straight. New metrics use the same axes.

### 4.2 Stored records and summaries

**New object columns** (append to `OBJECT_COLUMNS`; missing columns read as NaN, which becomes null): `leaveMs`, `primaryAlong`, `primaryLateral`, `primaryEndMs` and `correctionPath`, all `'f32'`.

**`PATTERNS`** appends `'stack', 'cutstream', 'spacedstream', 'polygon'` in that order. `KINDS`, `JUDGMENT_ORDER`, `MISS_REASONS`, `INPUT_SLOTS` and `SHAPES` don't change.

**PlaySummary v2** (`src/data/schema.ts`):

```ts
export interface SectionStat {
  start: number; end: number; role: SectionRole | null; focus: SectionFocus;
  n: number; accuracy: number | null; misses: number;
}
/** Means over jumps from 2.0 records. Distances in target radii. */
export interface MoveStat {
  n: number;
  leaveFrac: number | null;     // mean leaveMs / gapMs
  primaryAlong: number | null;  // mean, radii
  correctionPath: number | null; // mean, radii
  correctionShare: number | null; // share with corrections >= 1
  efficiency: number | null;
}
export interface PlaySummary {
  /* every 1.0 field, with */ v: 2;
  hasReplay: boolean;
  sections: SectionStat[] | null;
  movement: MoveStat | null;
  throughput: { n: number; bitsPerSec: number } | null;
  scoringVersion: number;
  /** Milestones first reached with this play. */
  milestones: MilestoneId[];
}
export const SUMMARY_VERSION = 2;
SUMMARY_UPGRADES[1] = (raw) => ({
  ...raw, hasReplay: false, sections: null, movement: null, throughput: null, scoringVersion: 1, milestones: [],
});
export type RuleId = /* 1.0 values */ | 'late-leave' | 'first-motion' | 'corrections';
```

### 4.3 Replay encoding

`ReplayRow.bytes = gzip(container)`, made with `CompressionStream('gzip')`. The container is little-endian.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | Magic `48 42 52 50` ("HBRP") |
| 4 | 1 | Container version = `REPLAY_FORMAT` (1) |
| 5 | 1 | Flags = 0 |
| 6 | 2 | Reserved = 0 |
| 8 | 4 | H = header length in bytes |
| 12 | H | Header: UTF-8 JSON of `ReplayData` without `trace` |
| then | 4 | N = event count |
| then | 4 | P = count of events with ops 0 to 4 (positioned) |
| then | N | `ops`, one byte each |
| then | 4 + LT | LT, then the t stream: N varints |
| then | 4 + LX | LX, then the x stream: P varints |
| then | 4 + LY | LY, then the y stream: P varints |

How the streams are encoded:
- Values are integers: `round(t × 64)` for t, `round(v × 16)` for x and y. The engine already quantizes before use (§5.1), so this is exact.
- Each stream stores second differences. With `q₋₁ = 0` and `d₋₁ = 0`: `dᵢ = qᵢ − qᵢ₋₁` and `ddᵢ = dᵢ − dᵢ₋₁`.
- Each `dd` is written as unsigned LEB128 of `zigzag(n) = n ≥ 0 ? 2n : −2n − 1`. Both use arithmetic, never 32-bit bitwise operators, so any |n| < 2⁵² works.

Op codes come from `TRACE_OP`:

| Op | Meaning |
|---|---|
| 0 | move (t, x, y) |
| 1 to 4 | press with a position, slot = op − 1 |
| 5 to 8 | press without a position (keys), slot = op − 5 |
| 9 to 12 | release, slot = op − 9 |
| 13 | advance |
| 14 | pause, which calls `notePause` |
| 15 | resume, which calls `noteResume` |

Decoding rules:
- The decoder rejects unknown ops, a version above `REPLAY_FORMAT`, length mismatches and trailing bytes. It throws `ReplayFormatError` with the message "This replay is damaged." or "This replay was made by a newer version of Heartbeat."
- In memory, x and y are 0 for events without a position.
- Size target: 4 bytes or less per event before gzip on 1 kHz human-like movement. Expect about 150 to 300 KB per 120 s play at 1 kHz after gzip.

Both `encodeReplay(data): Uint8Array` and `decodeReplay(bytes): ReplayData` live in `src/shared/replay.ts`, are synchronous, and exclude gzip. Gzip is the data layer's job.

### 4.4 IndexedDB v1 to v2

```ts
export const DB_VERSION = 2;
export type StoreName = /* 1.0 */ | 'replays';
MIGRATIONS[2] = (db) => {
  const r = db.createObjectStore('replays', { keyPath: 'playId' });
  r.createIndex('startedAt', 'startedAt');
  r.createIndex('keep_startedAt', ['keep', 'startedAt']);
};

export interface ReplayRow {
  playId: string;      // same id as the play
  v: 1;
  startedAt: number;   // the play's, for retention order
  keep: 0 | 1;         // numbers, because booleans can't be index keys
  bytes: Uint8Array;   // gzip(container)
  rawBytes: number;
  events: number;
  engineVersion: number;
}
```

- The migration only adds a store. Existing rows are never rewritten. Readers and import lift summaries through `upgradeSummary`, as in 1.0.
- `onblocked` no longer rejects. The open stays pending and the app shows "Close other Heartbeat tabs to finish the update." A 1.0 tab receives `versionchange`, closes its connection and shows its own reload message.
- **One way.** After v2 opens on a profile, 1.0 code gets a VersionError. Fix forward and never roll back the deploy.
- `savePlay` order:
  1. Summarize and pack the records.
  2. Encode and gzip the replay **before** the transaction, because awaiting non-IDB work inside `withTx` commits it early. On any error, save without a replay.
  3. One transaction writes `plays`, `playDetails`, `replays`, `progress` and `meta`.
  4. A replay is auto-kept when `pb.score` or `pb.level` is set.
  5. Replay retention runs afterwards in its own transaction.
- `deletePlay` and `deleteAllData` also remove replays.
- `runReplayRetention(limit)` keeps every row with `keep = 1` plus the newest `limit` of the others. It deletes the rest and sets `hasReplay: false` on their summaries. It runs at idle after start-up and after each save.

### 4.5 Export v2

```ts
{ format: 'heartbeat-export', formatVersion: 2, exportedAt, app: { engineVersion, generatorVersion }, deviceId,
  settings, progress, drills, tombstones,
  meta: { tiers, milestones?, onboarding? },
  plays: [ { summary, detail /* as 1.0 */, replay?: JsonReplay | null } ] }
interface JsonReplay { v: 1; keep: boolean; events: number; rawBytes: number; engineVersion: number;
  /** Standard base64 with padding, of ReplayRow.bytes. */ data: string }
```

- `buildExport(app, { includeReplays })`. The UI shows the replay total from `replayStorage()` beside the checkbox, which defaults to on.
- Import accepts `formatVersion` 1 and 2, and rejects anything higher with the 1.0 message.
- Replays are stored as is after checking the gzip header `1f 8b`, and are skipped when their play is skipped or invalid. Existing replay rows win.
- `meta.milestones` merges like tiers, keeping the earliest `at`. `meta.onboarding` applies only when the local value is missing.
- Base64 uses a chunked helper (`String.fromCharCode` on 32 KB slices with `btoa`, and `atob` back), not `Buffer`.

### 4.6 Settings

`v` stays 1. `sanitizeSettings` merges over `DEFAULT_SETTINGS` and applies these rules:
- Enums fall back to the default when unknown.
- Numbers are clamped to `SETTING_RANGES` and rounded to their step.
- `retryKey` must be a non-empty string that is neither Escape nor one of the two hit keys. Otherwise it becomes `''`.
- `replayLimit` must be one of `REPLAY_LIMIT_CHOICES`, otherwise 100.

`cloneSettings` copies the `skin` and `goals` groups.

### 4.7 Meta keys and UiPrefs

| Key | Value |
|---|---|
| `milestones` | `Partial<Record<MilestoneId, { at: number; playId: string \| null }>>` |
| `onboarding` | `{ done: boolean; at: number \| null; input: boolean; calibrated: boolean; placed: boolean }` |
| `plan:YYYY-MM-DD` | `DailyPlan`. Plans older than 14 days are pruned at boot. |
| `insightSnooze` | `Record<string, number>`, mapping an insight key to "hidden until" in epoch ms |

```ts
export interface PlanStep { step: number; kind: 'warmup' | 'drill' | 'dynamic'; title: string; launch: LaunchRequest; insightKey: string | null }
export interface DailyPlan { date: string; createdAt: number; steps: PlanStep[] }
// UiPrefs gains: daily: { level: number | null }; playback: { speed: number }; installDismissed: boolean
```

### 4.8 Share codes

`src/shared/codes.ts`: `encodeShare(launch, generatorVersion): string` and `decodeShare(code): { launch: Partial<LaunchRequest>; generatorVersion: number }`. The string is base64url without padding. The link is `/s/<code>`. The bytes are little-endian:

| Byte | Field |
|---|---|
| 0 | `SHARE_CODE_VERSION` (1) |
| 1 | Mode index in `SHARE_MODE_ORDER` |
| 2 | Flags. Bit 0 = preset (Dynamic only), bit 1 = options follow, other bits 0. |
| 3 to 6 | Seed, u32 |
| 7 to 8 | lengthSec, u16 |
| 9 to 10 | Mods bitmask over `SHARE_MOD_ORDER`, u16 |
| 11 | generatorVersion, u8 |
| Dynamic only | A preset is 1 byte (level 1 to 8). Custom is 11 bytes in `DIFFICULTY_KEYS` order: radius − 30, (approachMs − 300)/10, bpm − 90, then the other eight as is. |
| If bit 1 | The mode's options in `MODES[mode].options` order. The enum fields are 1 byte each, as an index into: distanceFocus `['mixed','short','long']`, angleFocus `['mixed','sharp','wide']`, streamLength `['short','medium','long']`, sliderFocus `['mixed','straight','curves','repeats']`. directionFocus is 0 to 7, or 255 for null. mixModules is a count followed by indexes into `MODULE_IDS`. |
| Last | Checksum = ((sum of all previous bytes) mod 256) XOR 0xA5 |

- Test vector: Dynamic, preset 4, seed 123456789, 90 s, Mirror, generator 2 is bytes `01 00 01 15cd5b07 5a00 4000 02 04 43`, which encodes to `AQABFc1bB1oAQAACBEM`.
- The decoder clamps difficulty values to `DIFFICULTY_LIMITS` and runs `cleanMods`.
- Module codes carry no levels, so the receiver uses their own.
- A code never starts a play by itself. It opens the setup screen.

### 4.9 Daily seed

`dailySeed(date) = fnv1a32('heartbeat-daily:' + date)`. FNV-1a 32 uses offset 2166136261 and prime 16777619 with `Math.imul`, over UTF-16 code units, and returns `>>> 0`. `date` is `localDateKey(epochMs)`, which is `YYYY-MM-DD` from local date parts (decision 3).

Vectors: `2026-11-01` gives 1500758254, and `2027-01-01` gives 2909596274.

The daily launch:
- modeId `dynamic`, with the difficulty of the player's chosen preset (default from §7.6)
- `DAILY_LENGTH_SEC`, no mods
- `source: { kind: 'daily', date }`

The seed is fixed to the date, and the level is the player's choice.

### 4.10 What `GENERATOR_VERSION = 2` means

- For any seed, version 2 maps differ from version 1 maps. Same seed, same version, same launch and same browser still give the same map.
- Saved plays keep their records. Analytics never regenerates maps.
- "Play this map again" on a play with an older generator version is labelled "Play with these settings". Results and play detail say "This play used an older map generator, so this seed now makes a different map."
- Share codes store the version. Opening one made with another version shows the same note.
- Bests per preset compare across versions (decision 1).
- The aim demand anchors keep their Level 2 to 8 values. Level 1 becomes 4.6, and Phase 4 tunes the generator so every preset lands within 5% of its anchor.

### 4.11 Corrections from the format review (binding)

These override §4, §5.2, §8.3 and the Phase 0.4 tests wherever they differ.

**Bests and lifted rows (was a live-data bug).**
- `src/analytics/bests.ts`: `pbFlags` and `computeBests` compare `scoringVersion ?? 1` instead of `engineVersion`. This moves from Phase 2 to Phase 0.
- In `savePlay`, the existing rows are lifted with `upgradeSummary` before `pbFlags`, `allRatings`, tiers and `newMilestones` see them.

**`savePlay` order (replaces §4.4 steps 3 to 5).**
1. Summarize and pack the records. Encode and gzip the replay before any transaction. On an encode error, carry on without a replay.
2. Transaction A, as in 1.0 plus milestones: `plays` (with `hasReplay: false`), `playDetails`, `progress` and `meta`.
3. Transaction B, only when A committed and a replay exists: put the replay rows (`keep` = 1 when A set `pb.score` or `pb.level`), then put the summary again with `hasReplay: true`. Any failure in B is swallowed, and the play stays saved.
4. Retention runs afterwards in its own transaction.
- `hasReplay` is a hint for lists. `getReplay` is the truth, and readers accept a true flag with no row.
- The stored bytes are a tight array (`byteOffset === 0` and `byteLength === buffer.byteLength`), because structured clone copies the whole underlying buffer otherwise.

**Two replay stores (replaces the single `replays` store in §4.4).**
- `replays` holds `{ playId, v: 1, startedAt, keep, size, rawBytes, events, engineVersion }` with the `startedAt` and `keep_startedAt` indexes. `size` is the gzip byte length.
- `replayBytes` holds `{ playId, bytes }`, keyed by `playId`.
- `MIGRATIONS[2]` creates both, each guarded with `if (!db.objectStoreNames.contains(name))`.
- `getReplay` reads both. `deletePlay`, `deleteAllData`, retention and import touch both. Retention, `replayStorage()` and any listing read `replays` only, never `replayBytes`.

**Codec rules (add to §4.3).**
- The t stream is the second difference over all N events in order. The x and y streams are second differences over the P positioned events only, in order. t is not monotonic: a press or move can carry a lower t than the advance before it. The encoder never reorders.
- `encodeReplay` throws when `t·64` or `v·16` is not an integer, and the play then saves without a replay. `qt` and `qp` add `+ 0` so that −0 becomes +0.
- Non-zero flags or reserved bytes count as "newer". Every length (H, N, P, LT, LX, LY) is checked against the bytes remaining before anything is allocated. A varint longer than 8 bytes, or one that runs past its stream, is "damaged". P must equal the number of ops 0 to 4 found.
- Events with t > endT are kept. Playback duration is max(endT, the last t).
- `ReplayFormatError` carries `kind: 'damaged' | 'newer'`, and the UI maps the kind to the message.
- Chunking in `TraceRecorder` is invisible in the format.
- The golden-bytes test compares the 12-byte prefix and everything from offset 12 + H as hex, and the header as parsed JSON. Key order in the header is not part of the format.

**Share codes (add to §4.8).**
- The decoder re-encodes the decoded bytes and rejects the code when the string differs (canonical form). Without this, a changed last character can pass the checksum.
- Modes not in `MODE_ORDER` (today `placement`) are rejected.
- `lengthSec` snaps to the nearest entry of `MODES[mode].lengthOptions`.

**Export and import (add to §4.5).**
- Import sets `hasReplay` from whether a replay row was stored, like `hasDetail`.
- A `JsonReplay` is skipped, not its play, unless `data` is a string under 16 MB decoded and `events`, `rawBytes` and `engineVersion` are finite numbers.
- A v2 file can hold `v: 1` summaries, because `buildExport` exports raw rows. Import lifts each one.
- `deleteAllData` also clears both replay stores and the meta keys `milestones`, `insightSnooze` and every `plan:*`. The `onboarding` key survives.
- A tombstoned play's replay is not imported.

**Blocked and failed opens (add to §4.4).**
- `db.ts` exports `onDbBlocked(fn)` next to `onDbOutdated`. The Shell shows "Close other Heartbeat tabs to finish the update." while blocked and clears it once the open succeeds.
- `open.onerror` with a `VersionError` shows "This browser has data from a newer Heartbeat. Reload to update."

**Settings (add to §4.6).** Round to a step as a whole count of steps, then `Number((count × step).toFixed(2))`, so 0.15 stays exactly 0.15.

**Service worker (add to §8.3).** This host answers a missing `/assets/*.js` with 200 `text/html`.
- Install fetches `/asset-manifest.json` with `cache: 'no-store'`. It caches an asset only when `response.ok` and the `Content-Type` isn't `text/html`, and otherwise the install fails.
- The runtime cache-first path applies the same check and never caches opaque or non-200 responses.
- Every live response already carries `Cache-Control: public, max-age=0, must-revalidate`, so `sw.js` is revalidated on each navigation and the kill switch takes effect at once.

**Playback (add to §5.2).**
- Adaptive replays append sets the way the live play did. The playback session starts with the objects whose `set <= 0` and gets a replay controller whose `closeSet(set)` returns the recorded objects of `set + 1` (or null when there are none) and whose `levelSteps()` returns `replay.levels`. This replaces "all set objects are present from the start", which let a replay see a set before the live play did.
- Playback never calls `advance` outside the trace.
- Playback copies `map.objects` and `map.sections`, because the `GameSession` constructor empties the array it gets.
- `progressMs` comes from the replay.
- Ops are fed in trace order even when t decreases.
- A Phase 1 test checks, for each adaptive headless play, that `computeFeatures(session.map)` deep-equals `session.features`.

**Extra tests for Phase 0.**
1. Migration test 4 builds the v1 database from a frozen copy of `MIGRATIONS[1]` kept in `src/data/fixtures/`, never the live one, and snapshots the store and index names of a fresh v2 database.
2. A 2.0 play saved over the fixture rows: a higher score than the fixture's Level 3 play sets `pb.score` and a lower one doesn't. Ratings and tiers are computed against the lifted v1 rows.
3. Mixed rows: upgrade the fixture database, save one 2.0 play with a replay, export, import into a fresh database, and compare `listSummaries` and the replays.
4. Codec vectors: N = 0, a first event at t = 0, t decreasing between ops, duplicate t, negative and off-field positions, −0, t ≥ 2³¹/64 ms, a trace over 2 × 65536 events, and a P mismatch rejected.
5. Codec fuzz: 1,000 random single-byte flips and truncations of a valid container each throw `ReplayFormatError`, and never hang or return.
6. Test 6 also checks the tight buffer, and that a failing replay put leaves the play saved.
7. `deleteAllData` clears the replays and the new meta keys.
8. Share codes: the canonical check rejects `AQABFc1bB1oAQAACBEN`, `placement` is rejected, and `lengthSec` snaps.
9. Test 10 also checks that `onDbBlocked` fired and that the pending open resolved after the v1 connection closed.
10. Settings step rounding gives exact values.

---

## 5. Engine

### 5.1 Quantization, decimation and recording (G1)

- `GameSession` quantizes at its public boundary: `qt(t) = Math.round(t × 64) / 64` and `qp(v) = Math.round(v × 16) / 16`. This applies in `move`, `press`, `release`, `advance`, `notePause` and `noteResume`. Internal code calls a private `advanceTo` that does no logging and no quantizing.
- The public `advance(now)` logs op 13 only when `qt(now) > this.now`. `press` and `release` keep calling `advanceTo(t)` internally, and those calls aren't logged.
- `SessionInit` gains `record?: boolean`, default true. Playback passes false.
- `TraceRecorder` (`replay/recorder.ts`) stores chunks of `TRACE.chunkEvents` events (`Uint8Array`, `Float64Array`, `Float32Array` × 2). It allocates the next chunk when the current one is 75% full, so input handlers never allocate. `toTrace()` concatenates the chunks at finish.
- **Decimation** in `game.ts` through `engine/decimate.ts`:
  - A move within 0.5 ms of the last fed move is held as pending, overwriting any earlier pending move.
  - Pending is flushed before any press, release, advance or pause.
  - The drawn cursor always uses the newest sample.
- `finish()` adds `replay` inside a try/catch. The map is the session map with a shallow copy of its objects and sections, `judgments` comes from the final states, and `endT = this.now`.
- Unchanged from 1.0: no input is fed while not playing, `syncCursor` logs a move, and `doPause` logs advance, then releases, then pause.

### 5.2 Playback (G1)

`replay/playback.ts` implements `CreatePlayback`.
- **Build.** `new GameSession({ map: shallowClone(replay.map), launch, controller: null, progressMs, record: false })`. All set objects are present from the start, and section and feature results match the live play (tested). A fresh `Effects` and `Renderer`.
- **Feed to T.** Apply events with `t ≤ T` in order. Ops 0 to 15 map to `move`, `press(slot, t, {x, y})`, `press(slot, t, null)`, `release`, `advance`, `notePause` and `noteResume`.
- **Render.** `rs.playT = T`, `rs.now = T`, the cursor at `session.cursor.positionAt(T)`, `drawCursor` true and no overlay. The effects clock is play time: `fx.onEvent(e, e.t, …)`. This makes effects slow down at 0.25× and freeze when paused.
- **Seek.** A forward seek feeds ahead. A backward seek rebuilds and feeds from 0, and skips effects for events before `T − 800`. Long plays may take up to about 100 ms, so seeks are throttled to one per animation frame.
- **On load.** One silent run to `endT` compares judgments with `replay.judgments` and reports `mismatches` in `onReady`.
  - A replay from a newer engine fails with "This replay was made by a newer version of Heartbeat."
  - A replay from an older engine plays, and the page notes any mismatches.
- **Sound.** Hit sounds play only at 1× while playing forward.
- **Autoplay source.** `autoplayReplay(launch, model = PERFECT_PLAYER, stepMs = 4)` runs the headless runner with recording and returns `ReplayData`. `loop: true` restarts at the end.

### 5.3 Movement metrics (G1, `rules/records.ts`)

These use the existing window `[from, press.t]` and the 8 ms speed profile, with peak index `m`. All are null when there's no peak, the peak is under 0.05 u/ms, or there are fewer than 3 speed samples.
- **Onset**: the first speed sample before `m` with `v ≥ max(0.1·peak, 0.05)` whose displacement points toward the target. `leaveMs = t_onset − from`.
- **Primary end**: the first sample after `m` with `v ≤ 0.3·peak` that is a local minimum, or the press if there's none. Then:
  - `primaryEndMs = t_end − objTime`
  - `primaryAlong` and `primaryLateral` = `decomposeAim(positionAt(t_end), target, direction)`, null when direction is null
  - `correctionPath` = path length from `t_end` to the press
- Fixtures:
  1. A single minimum-jerk move gives `|primaryAlong| ≤ 0.05r` and `correctionPath ≤ 0.05r`.
  2. A move that stops at 70% of the distance, then corrects, gives `primaryAlong ≈ −0.3·d` (±5%) and `correctionPath ≈ 0.3·d`.
  3. An 80 ms delayed start gives `leaveMs` of 80 ± 8.

### 5.4 Rendering 2.0 (G2)

No allocation per frame. Effects use structure-of-arrays pools (particles 512, pop-ups 64, ripples 16). Text widths are cached. Slider bodies stay cached as in 1.0.

- **Skin.** `render/skin.ts` resolves `settings.skin` and `PALETTES` into prebuilt colour strings once per `setSettings`.
- **Field.**
  - Background #07090e, field #0b1018.
  - A 1 px edge #1e2735, with 12-unit L-shaped "reticle" marks in #2b3648 at the four corners.
  - The 50-unit dot grid only when `fieldGrid` is on.
- **Targets.**
  - Body #151c28 at 90%, a 3-unit ring in the group colour, and the number in the display font at 0.8r, weight 700.
  - With Bullseye, a 1-unit inner ring at 0.5r at 35% alpha.
- **Approach styles.** No Rings and Fade draw none of them.
  - `ring`: as in 1.0.
  - `fill`: a disc of radius `r·u` in the group colour at 30% alpha.
  - `brackets`: four corner brackets on a square from 2.4r to 1.05r, rotating from 45° to 0° over the approach.
- **Follow points** (setting `pathHints`, labelled "Follow points"):
  - 6-unit dashes with 10-unit gaps, edge to edge between consecutive objects.
  - They are revealed from the earlier object toward the later one while the later object's approach progress goes from 0.2 to 0.6.
  - They fade out over 150 ms once the earlier object is judged.
  - None between stream notes with a gap under 160 ms.
- **Bursts.** All of these turn off with reduce motion, except the ring.
  - Crisp: a ring from r to 1.8r over 220 ms, plus 8 particles from 1.2r to 2.6r.
  - Solid: a ring to 1.5r over 180 ms, plus 4 particles.
  - Rough: a ring to 1.3r at 60%.
  - The body pops to 1.12× and fades over 120 ms.
- **Judgment pop-ups.**
  - The label sits at `y − 1.35r`, fixing the Miss overlap, and rises 10 units over 450 ms. The rise is off with reduce motion.
  - The early or late text sits under the label, outside the target.
  - Scale goes from 0.85 to 1 over 90 ms.
- **Miss.**
  - An X at the centre (0.5r, 3-unit stroke) that rotates in from 20° over 120 ms.
  - A red outline flash for 200 ms.
  - The 1.0 vignette, which is off with reduce motion.
- **Sliders.**
  - Body as in 1.0.
  - Ball 0.9r in the group colour with a 2-unit #eef1f6 rim.
  - Follow ring at `followRadius`, which scales in over 120 ms when tracking starts and shrinks and fades over 150 ms when it's lost.
  - Ticks are 0.18r diamonds that pop when collected and turn the miss colour when missed.
  - The reverse marker is a double chevron along the end tangent, pulsing on the beat when `beatOffsetMs` is known, otherwise every 400 ms.
- **Spinner.**
  - A 240-unit ring with 24 radial ticks that light in order up to `min(1, q)` of the way round.
  - A needle from the centre toward the cursor angle.
  - The RPM numeral at the centre.
  - An outer speed arc from 0 to 1.5× the required rpm, with the required rpm marked. It turns the Crisp colour at q ≥ 1, and bonus "+1" pop-ups stay.
- **Cursor.**
  - `ring`: a 6-unit dot in a 14-unit ring. `cross`: four 6-unit arms with a 2-unit gap. `dot`: a solid 5-unit dot. All scaled by `cursorScale`.
  - The trail is as in 1.0.
  - Click ripple: on press, a ring from 6 to 18 units over 160 ms at 50% alpha. Off with reduce motion.
- **Quick-retry indicator.** A 160 px bar at the top centre fills over `RETRY_HOLD_MS`, with "Restarting" under it.
- **Frame graph** (`frameGraph` on):
  - A 120 × 40 px panel at the bottom left with the last 120 frame times as bars and a line at 1000/Hz.
  - "p99 4.1 ms" updates every 500 ms.
  - Finish writes `frameP99Ms`.
- **HUD.** The 1.0 layout in the display font: score 28 px, combo 40 px, accuracy 13 px. The health bar is 3 px.
- **Font.** `FONT = '"Space Grotesk Variable", ui-sans-serif, system-ui, …'`. Every frame redraws its text, so the face appears as soon as it loads.

### 5.5 Audio 2.0 (G3)

1.0 already has the tracking hum, the spinner hum that rises with rpm, ticks, the combo break and the countdown. 2.0 adds sound sets, a metronome and offsets.
- **Sets** (`audio/sets.ts`). Each set maps every sounding feedback type to a recipe using the existing `blip` and `noise`.
  - `glass` is the 1.0 table unchanged.
  - `wood`:
    - Crisp: triangle 880 to 660 Hz, 45 ms, gain 0.3, plus bandpass noise at 1.8 kHz (Q 3), 12 ms, 0.18.
    - Solid: triangle 740 to 560 Hz. Rough: triangle 520 to 400 Hz.
    - Miss: lowpass noise at 300 Hz, 90 ms, 0.25, plus sine 140 to 70 Hz.
    - Tick: bandpass noise at 2.4 kHz, 8 ms, 0.1.
    - Spinner hum: a triangle through a bandpass.
  - `pulse`:
    - Crisp: square 1320 Hz, 30 ms, 0.12, through a 4 kHz lowpass, plus square 1980 Hz at +15 ms.
    - Solid: 990 Hz. Rough: 660 Hz.
    - Miss: square 165 to 110 Hz, 120 ms, through a 1.2 kHz lowpass.
    - Tick: square 2640 Hz, 10 ms, 0.05.
    - Spinner hum: a square wave.
  - The combo pitch rise applies to Crisp in every set.
- **Metronome.**
  - A new `metronome` gain equal to `metronomeVolume²`.
  - Click: bandpass noise at 3 kHz (Q 2), 10 ms, 0.3, plus sine 1600 Hz, 14 ms, 0.15. The downbeat uses 2200 Hz at +3 dB.
  - Mode `beat` clicks every beat, `bar` only on downbeats.
  - The grid is `beatMs` and `beatOffsetMs`. Without `beatOffsetMs` it stays silent, which in 2.0 means everything except Dynamic and Daily.
- **Scheduling.**
  - Each frame schedules clicks with play times in `[T, T + 150 ms]` that aren't scheduled yet.
  - Play time maps to perf time with the clock, then to context time with `ctx.getOutputTimestamp()`: `contextTime + (perfT − performanceTime)/1000`.
  - Fallback: `ctx.currentTime + (perfT − performance.now())/1000`.
  - Start time = context time − `audio.offsetMs`/1000. Clicks more than 5 ms in the past are skipped.
  - Pause stops the scheduled sources, held in a pool of 8.
  - Pure helpers: `beatsInWindow(beatMs, offset, from, to, mode)` and `toContextTime(...)`.

### 5.6 Offsets and calibration

- **Visual offset (G2).** `renderFrame` draws objects, approach indicators, follow points and slider balls at `playT + visualOffsetMs`. The HUD, cursor, effects and judging use plain play time.
- **Audio offset (G3).** It only moves metronome clicks. Hit sounds respond to input and stay immediate.
- Both values go into `InputInfo` on every play.
- **Calibration (G3, `calibrate/`).**
  - Visual: one target at the centre whose approach ring closes every 600 ms.
  - Audio: a static dot with metronome clicks every 600 ms, offset 0.
  - Both give 4 lead-in beats and then collect 24 taps from any hit key or button. Error = press minus the nearest beat. Errors with |e| > 200 are dropped.
  - `calibrationResult(errors)` returns the median and the sd of the last 20 (pure, tested).
  - The app applies the rounded median to `visualOffsetMs` or `audio.offsetMs`.

### 5.7 Mods

- **Bullseye (G3).** In `hitHead`, after `classifyError`: if `radial > BULLSEYE.innerRadii·r` and the judgment is Crisp or Solid, it becomes Rough. This applies to circles and slider heads, and `judgment` and `headJudgment` both carry the capped value. Timing analytics stop relying on judgments (§7.3).
- **No Rings (G2).** No approach indicator in any style. Targets fade in and stay until judged. It conflicts with Fade.
- Progress still updates only from plays whose mods are a subset of {mirror}.

### 5.8 Quick retry (G1)

- Pressing `retryKey` (not Escape, not a hit key, `''` = off) while playing, paused or counting down starts a hold. Releasing it before `RETRY_HOLD_MS` cancels.
- When the hold completes, the engine finishes with status `quit`, calls `onRetry(result)` instead of `onFinish`, and releases the pointer lock.
- When `onRetry` is absent, the key does nothing.

### 5.9 Placement mode (G3)

- `ModeRunner` for `placement` plays the five `PLACEMENT.modules` in order, then again, for 10 sets.
- Each module's staircase starts at `levels[m] ?? PLACEMENT.startLevel` with `step = PLACEMENT.firstStep`.
- Set sizes come from `PLACEMENT.setSize`. There is no length cutoff before set 10.
- `finalLevels` contains all five modules. Health is null and no mods are allowed.

---

## 6. Map generator 2 (G4)

### 6.1 Structure (`map/structure.ts`, pure)

- **Phrases.** A phrase is 16 beats. `bodyBeats = floor((endMs − t0)/beat)`, `P = floor(bodyBeats/16)`. A tail of 4 beats or more joins the outro, and a shorter one is dropped.
- **Roles.** Intro is 1 phrase (2 when P ≥ 12) and outro is 1.
  - The middle is a series of blocks: build × b, peak × k, rest × 1. Use b = k = 1 when P < 10 and b = k = 2 otherwise.
  - The last block has no rest, and its peak is the longest.
  - To fit, trim builds first, then peaks, keeping at least one peak.
  - Small maps: P = 1 is a peak, P = 2 is intro and peak, P = 3 is intro, peak and outro.
- **Intensity per phrase.**
  - Intro: 0.5, or 0.5 then 0.6.
  - Build: ramps from 0.65 to 0.88.
  - Peak: 0.95 for the first peak, 1.0 for later ones.
  - Rest: 0.35. Outro: 0.6.
  - Jitter ±0.03 from `fork('curve')`, then clamp to [0.3, 1].
- **Sections** are runs of one role. Their intensity is the phrase mean. Placement reads the per-phrase value.
- **Focus.**
  - Rest is `break`.
  - Other roles use the 1.0 `pickFocus` weights with a role bias. Peaks multiply streams (when the `streams` setting is 6 or more) or jumps by 1.5. Intros multiply flow and sliders by 1.5. Outros favour mixed.
- **Spinners** are planned here and never removed afterwards.
  - Candidates are the start of each rest (P = 0.15·spinners, at most 1) and the start of the last build before the final peak (P = 0.05·spinners).
  - Never in the intro, the outro, the last section, the first 8 s or the last 5 s. At most one per 30 s.
  - The 1.0 gap rules apply, and the section after a spinner always has content.

### 6.2 Mirrored sections

- Applies to build or peak sections of 2 or more phrases, when complexity is 4 or more, with P = 0.25.
- Phrase 2 replays phrase 1's motifs with positions mirrored. The axis is vertical x = 500 in 60% of cases, horizontal y = 312.5 in 25%, and the centre point in 15%.
- The connecting jump must pass the rules, or the section falls back to its template.
- Set `mirrored: true`.

### 6.3 Patterns (c = complexity, I = intensity)

| Pattern | Rhythm and shape | When | Weight | Tag |
|---|---|---|---|---|
| polygon | 5 notes (±72°) or 6 (±60°) at 1/2 | c ≥ 5 | 0.1c | polygon |
| stack | 2 or 3 notes on one spot at 1/4 (1/2 when bpm < 140), then a jump on the next beat | c ≥ 3 | 0.15c·(0.5 + I) | stack |
| triple | 3 notes at 1/4 ending on a beat, then a jump | streams ≥ 1 | 0.2·streams | burst |
| cut stream | n from 8 to streamMaxLength, cut at n/2 by a 70° to 110° turn and one 1.5× gap | streams ≥ 4, c ≥ 5 | 0.15·streams·I | cutstream |
| spaced stream | n from 5 to 12, spacing 1.1 to 1.6 widths | spacing ≥ 6, I ≥ 0.85 | 0.1·streams | spacedstream |
| kick slider | a slider spanning 1/2 beat, then a jump, inside jump chains | c ≥ 6 | 0.08c | slider |

New slider paths in `makeSliderSpec` are the S-curve (one cubic with an inflection), the hook (a line then an arc), the wave (two cubics with alternating bulge) and the zigzag (2 or 3 lines with 60° to 100° bends, c ≥ 6). The mix stays straight 0.3, arc 0.4 and curve family 0.3. Inside the curve family: cubic 0.4, S 0.25, hook 0.15, wave 0.1, zigzag 0.1. Shape is `straight` for one line, `arc` for one arc and `curve` for anything else.

### 6.4 Rules

PLAN §7 rules 1 to 7 stay. Rule 8 ("no stacks") is replaced by rule 9, and rules 10 to 14 are new.

9. Notes in a stack share a position exactly and are exempt from rules 2 and 3 with each other. The next object keeps at least 2.2r from the stack.
10. Inside a section, a jump is at most 1.6× the previous jump's distance at the same gap, except on a bar downbeat.
11. At most 3 consecutive 1/4-beat notes outside stream, cut stream, spaced stream and burst motifs.
12. Motifs start on a beat. At least 60% start on a bar downbeat over 50 seeds.
13. Neighbouring phrases differ in intensity by 0.2 or less, except into or out of a rest and into the outro. The outro is a cool-down after the last peak, so its drop is intended.
14. The planned spinner count equals the placed count. No spinner sits in the first 8 s or the last 5 s, and content follows each one.

The speed budget stays: a 300 s Level 8 map in under 50 ms on desktop, and under 200 ms in the test.

### 6.5 Calibration

`calibrate.test.ts` stops being print-only. It asserts that each preset's median aim demand over 20 seeds is within 5% of `[4.6, 5.91, 7.34, 8.56, 9.87, 11.27, 12.73, 14.57]`, and that the other skills are within 3%. G4 tunes generator constants first. If Level 1 can't reach 4.6 that way, G4 reports the smallest `LEVEL_PRESETS[0]` change that does, and the main session applies it. Jumps and Angles levels under 2 get slightly harder because `D_aim(1)` rises. Levels from 2 up are unchanged.

---

## 7. Analytics and training (U2, pure, all in `src/analytics/`)

### 7.1 Insight fixes

- **Minimum absolute effect.** The direction-drift spread variant now needs `sd − otherSd ≥ 0.1` radii (5% of a target's width) as well as the 1.3× ratio.
- **No equal-looking contrasts.** Every rule whose copy shows two numbers (a against b) must pass `distinct(a, b, unit)`. The displayed values must differ by at least 3 units (percentage points, % of width, or ms), or the insight doesn't fire.
- **Ranking.** `severity = min(ratio, 4) × min(1, n/(3·minN)) × weight × fresh`.
  - `weight` is 1 for rules about aim, timing and tracking, and 0.5 for `same-module` and `long-session`.
  - `fresh` is 0.6 when the recommended module was played in the last 2 days, otherwise 1.
  - Snoozed keys are dropped.
  - The top 3 recommend different modules where possible.
- `snoozeInsight(key, days = 7)` uses `insightSnooze` in meta.

### 7.2 New rules

All thresholds here are first guesses (risk 8).

| id | Filter and condition (min n) | Copy | Recommends |
|---|---|---|---|
| late-leave | jumps with gap ≤ 350 ms and `leaveMs`; mean `leaveMs/gap` ≥ 0.35 (60) | "On fast jumps you leave the last target late, after about {pct}% of the time to the next one. Leaving sooner gives the move more time." | jumps, mixed |
| first-motion | long jumps (same cuts as long-undershoot) with `primaryAlong`; mean/r ≤ −0.5 (`short`) or ≥ +0.5 (`over`) (40) | short: "On long jumps your first motion stops about {pct}% of a target's width short, and a second motion makes up the rest." over: "On long jumps your first motion goes about {pct}% of a target's width past the center before you pull back." | jumps, long |
| corrections | hit jumps with spacing ≥ 2.5; share with corrections ≥ 1 is 0.45 or more and mean `correctionPath`/r ≥ 0.6 (60) | "You make a second motion on {pct}% of your longer jumps. Try for one smooth move that stops on the target." | jumps, mixed |

Each rule also defines `sample`, `good` and `threshold` like 1.0 rules (late-leave: down, 0.1; first-motion: zero, 0.25; corrections: down, 0.1), so drills work with it.

### 7.3 Scoring fixes

- Timing performance and "timing Crisp" use `|timingError| ≤ crispMs` instead of the judgment, so Bullseye can't distort them. Results are identical for other plays.
- Ratings recompute each play's score as `levelForDemand(s, raw) × performance²` with the current anchors, ignoring the stored `level` and `score`.
- Bests compare plays with the same `scoringVersion` (missing means 1), instead of the same `engineVersion` (decision 1).

### 7.4 Summary v2 fields (`summarizePlay`)

- `sections`: per `result.map.sections`, using records with `start ≤ time < end`.
- `movement`: MoveStat over jumps.
- `throughput`, computed like this:
  - Use jumps with a direction and a press.
  - Bucket them by the 1.0 distance and gap bins.
  - In buckets with n ≥ 8: `We = max(4.133·sd(aimAlong), 1)`, `De = mean(distance) + mean(aimAlong)`, `IDe = log2(De/We + 1)`, `MT = mean(gapMs)/1000`, `TP = IDe/MT`.
  - The play value is the n-weighted mean, or null when the total n is under 15.
- `scoringVersion` and `milestones` (set at save).

### 7.5 Views

| Function | Returns |
|---|---|
| `ratingHistory(summaries, days)` | Each skill's rating at the end of each day |
| `radarData(ratings)` | The 7 skills, with provisional ones flagged |
| `throughputScatter(rows)` | Per bucket: nominal ID `log2(D/2r̄ + 1)` against IDe, with n |
| `weeklyChanges(summaries, now)` | The last 7 days against days 8 to 35, using Welch with \|t\| ≥ 2 and at least 3 plays a side. Metrics: accuracy, timing spread, \|timing mean\|, radial error, throughput, minutes per day. The `distinct` gate applies. Copy: "Your timing spread went from 21 ms to 17 ms this week." |
| `playVsAverage(summary, summaries)` | Same mode and preset (or module) over the last 30 days, n ≥ 3. Deltas for accuracy, timing spread, radial error and score. |
| `fatigueCurve(records)` | Rolling accuracy over 20 objects, against time |
| `demandTimeline(map, features, binMs = 2000)` | Level-scale aim, speed and overall per bin, with sections, for the preview graph |

### 7.6 Training

- **Streak**: consecutive local days with at least one saved play of 60 s or more. Today keeps the streak alive until it ends.
- **Weekly goal**: minutes played this local Monday-to-Sunday week, against `goals.weeklyMinutes`.
- **Daily streak**: consecutive days with a completed daily play.
- **Milestones**: `newMilestones(history, summary, all)` runs inside `savePlay` like tiers, then writes meta and `summary.milestones`. `clear-N` means a completed preset-N play with accuracy of 0.9 or more.
- **Suggested Dynamic level**:
  - Take the latest completed preset play in the last 14 days. Add 1 if its accuracy is 0.95 or more, subtract 1 if it's under 0.85 or the play failed.
  - Without one, use the rounded mean of the aim, speed and timing ratings.
  - Otherwise use 3. Always clamp to 1 to 8.
- **Daily plan** (`buildDailyPlan(date, insights, ratings, progress, levels)`):
  1. Warm-up for 120 s.
  2. Drill A: the top insight's recommendation for 90 s. Use an active drill's `drillId` when its rule and variant match.
  3. Drill B: the next insight with a different module. Otherwise the lowest-rated skill's module (aim to jumps, speed to streams, tracking to tracking, precision to precision, timing to timing, reading to reading, spin to spinning), excluding A's module.
  4. Dynamic at the suggested level for 120 s.

  With fewer than 3 plays, A is Jumps and B is Streams. Seeds are fixed when the plan is built, and every launch carries `source: { kind: 'plan', date, step }`. A step counts as done when a saved play from it either completed or ran 60 s or more.

---

## 8. Screens

### 8.1 Routes and splitting (U1, then the later builders add their own routes)

| Route | Page | Loads |
|---|---|---|
| `/` | Home | eager |
| `/play`, `/train`, `/train/:mode` | setup | lazy; play setup pulls the game chunk for the preview |
| `/session` | play | lazy, with the game |
| `/results/:id` | Results | lazy |
| `/replay/:id?t=` | replay viewer | lazy, with the game |
| `/daily` | daily challenge | lazy |
| `/s/:code` | share link | lazy |
| `/stats/*` | stats | lazy, with the charts |
| `/settings` | settings | lazy, with the game for the preview |
| `/welcome`, `/calibrate` | onboarding | lazy, with the game |

The game is imported only through dynamic `import('../../game/index')`. Rely on dynamic imports for splitting, not on chunk-config options.

### 8.2 Error boundary (U1)

A class component around `<Outlet/>` and around `/session`. It reads "Something broke on this page." and offers Reload, Go home and "Export your data", which runs `buildExport` and downloads the file.

### 8.3 PWA (U1)

- **`sw.js`**:
  - On install, fetch `/asset-manifest.json` and precache `/`, `/index.html` and every `file`, `css` and `assets` entry.
  - The cache name is `hb-` plus a hash of the manifest text.
  - Navigations are network first with a 3 s timeout, falling back to the cached `/index.html`.
  - `/assets/*` is cache first. Everything else goes to the network.
  - Activate deletes every cache except the current one and calls `clients.claim()`.
  - `skipWaiting()` runs only on a message from the page.
- **Page**:
  - Register only in production.
  - When a worker is waiting, show "A new version of Heartbeat is ready." with a Reload button. It posts `skipWaiting`, and the page reloads on `controllerchange`.
  - Capture `beforeinstallprompt` for an Install button in Settings.
- **Kill switch**: if the worker misbehaves, deploy a `sw.js` that unregisters itself and reloads its clients.
- **Manifest**: name Heartbeat, `display: standalone`, `start_url: /`, background and theme colours #07090e, and the PNG icons 192, 512 and maskable 512.

### 8.4 Home (U3)

- Row 1:
  - The **Today** card: plan steps with checks, then "Start today's plan" or "Next: {step}".
  - The **Daily map** card: date, level picker, today's best, daily streak and Play.
  - **Streak and weekly goal**: a ring with minutes against the goal.
- Row 2:
  - A small radar with ratings.
  - The top insight with "Train this" and "Not now".
  - "What changed this week" from `weeklyChanges`.
  - The 5 most recent plays with grade chips.
- First run, no plays: a "Set up Heartbeat" card linking to `/welcome` (added by U5).

### 8.5 Results 2.0 (U3)

- Header: grade badge, mode and level, date and mods.
- Counters animate over 600 ms (score, accuracy). Under reduce motion they show final values.
- Judgment bar, max combo and time.
- **Section strip**: one block per `summary.sections`, coloured by role, with its accuracy. Sets for modules.
- **Against your average**: deltas with a direction colour, using the `distinct` gate.
- Fatigue sparkline, the 1.0 timing and aim panels, play notes, and PB, tier and milestone badges.
- Buttons: Retry (R), New map (N), Watch replay (W, only with `hasReplay`), Share map, Back (Esc).

### 8.6 Replay viewer (U3)

- A 16:10 canvas with `createPlayback`, and a transport bar:
  - play and pause (Space)
  - speed 0.25, 0.5, 1, 1.5 and 2 ([ and ])
  - a scrubber with miss markers (miss colour) and slider-break markers (rough colour)
  - ← and → seek 2 s, comma and period step 16 ms, M jumps to the next miss
- A miss list with Watch buttons that seek to `time − 1500`.
- `?t=` opens at that time.
- A "Keep this replay" toggle (`setReplayKeep`).
- With `mismatches > 0`: "This replay runs a little differently from the saved result on {n} objects."
- Markers come from stored records, or from `judgments` when the detail was removed.
- Play detail gets "Watch replay" and clickable timeline markers.

### 8.7 Stats additions (U3)

- **Overview**: radar, rating history (90 days, a skill picker), weekly changes, and the 1.0 content.
- **New Aim tab**:
  - the throughput scatter with a y = x line and dot size by n
  - the play-level throughput trend
  - movement metric trends (leave share, first-motion error, correction share)
- **Play detail**: fatigue curve, section strip, replay links.

### 8.8 Daily (U3)

Today's card, history with date, level, accuracy and grade, the daily streak, and "Share today's map".

### 8.9 Settings (U4)

| Section | Contents |
|---|---|
| Input | raw input, sensitivity, keys, retry key (a key capture that refuses Escape and hit keys), mouse buttons |
| Look | palette, cursor style, approach style, field grid, trail, click ripple, cursor scale, and a live `SkinPreview` |
| Sound | sound set with test buttons, master, hits, effects, ambient and metronome volumes, metronome mode, mute |
| Timing | visual offset, audio offset, each with a Calibrate link |
| Display | the 1.0 toggles plus the frame graph |
| Goals | weekly minutes |
| Data | export with "Include replays (about N MB)", import, storage, replay limit, detail retention, delete all |
| App | Install (when offered) and version numbers |

The live `SkinPreview` is a 480 × 300 autoplay of Dynamic Level 3, seed 1, 30 s, on a loop, updated through `setSettings`.

### 8.10 Play setup (U4)

The 1.0 controls plus a map panel:
- a difficulty graph from `demandTimeline` with role-coloured section bands
- objects per minute, the longest stream, slider and spinner counts
- "Watch this map", a modal autoplay with a scrubber
- "Share map"

### 8.11 Train (U4)

Mode cards in a grid:
- a 2 s looping SVG motif per mode, static under reduce motion
- the level in the display font, skills chips, last played
- a Placement card when there's no progress

### 8.12 Share links (U4)

`/s/:code` decodes and navigates to `/play` or `/train/:mode` with the launch prefilled and a "Shared map" banner. An invalid code shows the decoder's message. A different generator version shows the §4.10 note. Share text: "Heartbeat map: Dynamic, Level 4, Mirror. {url}".

### 8.13 Onboarding (U5)

`/welcome` has 3 skippable steps.
1. **Input.** Mouse or tablet (a tablet turns raw input off, with the PLAN §4 reason), keys and sensitivity.
2. **Timing.** The visual calibration on `/calibrate?kind=visual`, then audio as an option. It shows the median and the spread. Above 30 ms of spread: "Your taps were uneven. Try once more for a steadier number."
3. **Placement.** Starts a placement play. Results show "Starting levels" per module.

Progress is kept in meta `onboarding`.

---

## 9. Visual design

**Direction**: a dark precision instrument. Near-black blue surfaces, one lime "signal" accent, cyan for data, reticle corner marks as the signature, big tabular numbers in a grotesk face, thin rules and no shadows.

**Tokens** (`src/index.css`):

```css
@theme {
  --color-bg: #07090e;  --color-bg-2: #0b0f17;
  --color-surface: #0f141d;  --color-surface-2: #151c28;  --color-surface-3: #1c2534;
  --color-line: #1e2735;  --color-line-2: #2b3648;
  --color-ink: #eef1f6;  --color-ink-2: #a3adbd;  --color-ink-3: #7c879b;
  --color-accent: #c9f25c;  --color-accent-ink: #121a05;
  --color-data: #5ee7f2;  --color-warn: #ffb340;  --color-danger: #ff4f6a;
  --font-display: "Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
}
@theme inline {
  --color-crisp: var(--hb-crisp); --color-solid: var(--hb-solid);
  --color-rough: var(--hb-rough); --color-miss: var(--hb-miss);
}
```

The app sets `--hb-*` on `:root` from the active palette. U1 confirms that Tailwind 4's `@theme inline` behaves this way, and otherwise sets these four through a plain `:root` rule.

**Type**:
- Numbers always use `tabular-nums`. If Space Grotesk lacks tabular figures (unconfirmed), numbers use `--font-sans`.

| Token | Size / line height | Weight and font | Use |
|---|---|---|---|
| micro | 11/16 | 600, uppercase, tracking 0.08em, sans | labels and kickers |
| sm | 13/20 | sans | secondary text |
| base | 15/24 | sans | body |
| lg | 17/24 | 600, display | h3 |
| xl | 22/28 | 600, display | h2 |
| 2xl | 32/38 | 650, display, −0.01em | h1 |
| 3xl | 48/52 | 700, display | stat heroes |
| 4xl | 72/72 | 700, display, −0.03em | results score |

**Layout**:
- Spacing on a 4 px base (4, 8, 12, 16, 24, 32, 48, 64). Content max 1200 px on a 12-column grid with 24 px gutters.
- Top bar, 56 px:
  - the wordmark "Flick" in ink and "wise" in accent, in the display font
  - nav: Home, Play, Train, Daily and Stats
  - on the right, a streak chip and a settings icon
- Page background: `radial-gradient(1200px 600px at 20% -10%, #10192a, transparent 60%)` over `--color-bg`, plus a 32 px dot grid at 3% white masked to the top 600 px.

**Components**:
- **Panel**: surface, 1 px line, radius-lg, and an `inset 0 1px 0 rgba(255,255,255,0.04)` top highlight. Interactive panels get 10 px L-shaped corner marks in line-2 that turn accent on hover and focus.
- **Kicker**: micro text in ink-3 after a 6 × 6 accent square.
- **Buttons** are 40 px tall, radius-md, 600 weight in the display font.
  - primary: accent background with accent-ink text
  - secondary: surface-2 with a line-2 border
  - ghost: ink-2, turning ink on hover
  - danger: danger text and border
- **Inputs**:
  - Chip: a 22 px pill in micro text.
  - Segmented: a pill group whose selected item is surface-3 with ink text.
  - Toggle: 36 × 20.
  - Slider: a 4 px line-2 track, accent fill, and a 14 px ink thumb with a 2 px bg border.
  - Tabs: a 2 px accent underline.
- **Stats**:
  - StatBig: a micro label, the value at 3xl, and a delta chip.
  - Grade badge: the display font inside reticle corners. Pinpoint is accent, Sharp is data, Clean is ink, Steady is ink-2, Loose is warn and Scattered is danger.
- Icons are our own inline SVGs at 16 and 20 px with a 1.5 stroke. No icon library.
- Focus ring: 2 px accent with a 2 px offset.

**Motion**:

| Kind | Duration |
|---|---|
| hover and press | 120 ms |
| small enter | 180 ms |
| panel and page enter (fade plus a 4 px rise) | 280 ms |
| counters and graph draw-in | 600 ms |

- Entering uses `--ease-out` and leaving uses `--ease-in`.
- Nothing loops in menus except the mode-card motifs.
- Reduce motion, from the setting or the OS, sets durations to 0, shows counters' final values and stops the motifs.

**Charts**:
- Data lines 2 px in `--color-data`, with grid lines and axes in line and ink-3.
- Biases use a diverging scale from data through ink-3 to warn. Rates use surface-2 to danger.
- Judgments use the palette.

**Canvas**: follows §5.4 and shares these colours and the display font.

---

## 10. Browser checklist (main session, Phase 6)

1. Chrome at 60 Hz and at 144 or 240 Hz with the frame graph on Level 8. p99 must stay under the frame budget, with no visible hitches when the recorder starts a new chunk.
2. Raw input with `unadjustedMovement`: re-lock after Esc, a refused lock, sensitivity, and a pen tablet falling back to absolute.
3. Firefox and Safari: play, pause, raw input or its fallback, and that `pointerrawupdate` absence is handled (support in Firefox is unconfirmed).
4. Z and X, chorded mouse buttons, the retry hold and its cancel, and that the retry key can't be bound to Esc or a hit key.
5. Audio feel in each sound set, the metronome staying on the beat through a pause and resume, and Safari's `getOutputTimestamp` support or the fallback (unconfirmed).
6. Calibration repeats within ±5 ms over 3 runs. The visual offset visibly moves the approach timing.
7. Replays: record a real play, then open it, seek both ways, change speed, jump to a miss and step frames. Mismatches should be 0. Check a failed play and a Mix play.
8. Skins in every palette and approach style, with DevTools vision emulation (protanopia, deuteranopia, tritanopia) on the canvas and the charts.
9. Reduce motion from the OS on a fresh profile.
10. PWA: install in Chrome, reload offline, open stats offline, the update banner after a redeploy, and that a stale tab recovers on a lazy route after one reload.
11. Data:
    - a 1.0 profile on the live site upgrades with plays, details, drills and tiers intact
    - export with replays and import into a fresh profile
    - a v1 export file imports
    - the storage estimate updates
12. Daily map across local midnight. Share links in a second browser give the same settings, with the note when generator versions differ.
13. The bundle report has no chunk warning, the entry chunk is 200 kB or less, and `/stats` and `/replay/<id>` deep links work on the deployed site.

---

## 11. Risks

1. **DB v2 is one-way.** After the first 2.0 deploy, 1.0 code can't open the database. Mitigation: the golden-fixture tests, the architect review, a backup export by the owner before the deploy, and fixing forward only.
2. **Replay determinism.** Exactness depends on the session reading nothing but the logged calls. Anything new that reads wall time or randomness breaks it. Mitigation: the cadence-independence test in G1, and the mismatch count shown in the viewer.
3. **Replay size.** About 150 to 300 KB per 120 s at 1 kHz, and more with jittery raw input. Mitigation: the 2 kHz cap, the replay limit, the storage estimate, and the replay checkbox on export.
4. **240 Hz frame time** with particles, follow points and the frame graph. Mitigation: pools, cached text and the frame-graph check.
5. **Generator 2 could read worse** than generator 1 in practice, even if it passes every rule. Mitigation: the owner plays Level 3 and Level 6 before deploy, and the old constraint suite stays.
6. **Service worker** mistakes can strand a client on an old version. Mitigation: network-first navigations, the update banner, the kill-switch worker, and the preloadError reload.
7. **Audio clock mapping** differs between browsers. The fallback path may drift by a few ms, and audio calibration absorbs the rest.
8. **Thresholds of the new movement rules and of the throughput bins are guesses.** Check them against two weeks of the owner's 2.0 plays.
9. **Cross-browser seeds.** The same seed can give a slightly different map in another browser (PLAN risk 3). Daily maps and share codes inherit this. The copy never promises identical maps across browsers.
10. **Phase overlap.** Phase 3 and Phase 4 builders code against contract APIs that the parallel builder implements. The reviewer checks the wiring at the end of each phase.

## 12. Decisions for you

1. **Personal bests across versions.**
   - Options: keep comparing 1.0 and 2.0 plays, start fresh bests at 2.0, or show 1.0 bests in a separate list.
   - Recommendation: keep comparing them. Judging and scoring are unchanged in 2.0, so your old bests are still fair targets. Maps do differ a little because of the new generator.
2. **How many replays to keep.**
   - Options: the newest 100 plus kept ones and bests, the last 30 days, or everything.
   - Recommendation: the newest 100 plus kept ones and bests. That's about 25 MB, and you can change it in Settings.
3. **When the daily map changes.**
   - Options: at your local midnight, or at midnight UTC so everyone gets it at the same moment.
   - Recommendation: local midnight. There are no leaderboards, so a global switch-over time would only move your reset into the evening.
4. **A typeface.**
   - Options: add Space Grotesk as one self-hosted variable font (about 30 to 40 KB, cached offline), or stay with system fonts.
   - Recommendation: add it. Big numbers carry most of the new look, and system fonts look different on every machine. Body text stays on the system font.
5. **Accent colour.**
   - Options: lime as the main accent with cyan for data, or keep 1.0's sky blue.
   - Recommendation: lime. It gives Heartbeat a look of its own and stays readable on the dark surfaces. The judgment colours keep their 1.0 meaning in every palette.
6. **How to release.**
   - Options: deploy after each phase from Phase 1 on, or release 2.0 once at the end.
   - Recommendation: deploy from Phase 1 on. You get replays recording from your real plays early, and later phases need that data. The database change ships in the Phase 1 deploy, so please export a backup first.
7. **Grade names.** The proposal is Pinpoint, Sharp, Clean, Steady, Loose and Scattered. They're computed when shown and never stored, so renaming them later costs nothing.
   - Options: these names, your own, or no grades at all.
   - Recommendation: these names.
8. **New mods.**
   - Options: add Bullseye (hits outside the inner half count as Rough at best) and No Rings (no approach indicator), add only one of them, or add none.
   - Recommendation: add both. Bullseye brings center-aim training into real maps, and No Rings trains reading rhythm from spacing and the metronome.

## 13. Later

- Accounts and cloud sync. The seam in `src/data/sync.ts` stays.
- Leaderboards.
- Free-aim FPS-style modes.
- Music and maps timed to songs.
- Localization.
- Touch-device tuning.
- A playfield dim setting. Cut because there's no background art to dim, and the field grid toggle covers the rest.
- Comparing two chosen date ranges. Cut because the weekly report covers the common case.
- Sharing one replay as a file.
- Replaying the exact stored map of a past play after a generator change.

---

Unconfirmed while planning:
- `getOutputTimestamp` in Safari
- `pointerrawupdate` in Firefox
- tabular figures in Space Grotesk
- that Chrome installs with SVG-only icons (the plan uses PNGs)
- Tailwind 4 `@theme inline` behaving as described in §9

Confirmed:
- Vite `build.manifest` accepts a path string.
- A static-only Cloudflare Worker in SPA mode answers missing asset URLs with `index.html` and status 200.
- The daily-seed and share-code test vectors in §4.8 and §4.9 were computed with Node.

Key files read:
- `C:\Users\Nuja\Documents\GitHub\heartbeat\docs\PLAN.md`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\shared\types.ts`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\shared\catalog.ts`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\game\engine\session.ts`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\game\engine\game.ts`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\game\map\generator.ts`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\data\{db,schema,columns,plays,exportImport,settings}.ts`
- `C:\Users\Nuja\Documents\GitHub\heartbeat\src\analytics\insights.ts`