# Flickwise plan

> Flickwise was renamed Heartbeat on 29 October 2026. This document keeps the old name.

The design both builders worked from. Section numbers are referenced from code comments and briefs.

## 1. Steps, in dependency order

1. **Scaffold (main session).**
   - Files: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.test.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `index.html`, `dev.html`, `.gitignore`, `src/main.tsx`, `src/vite-env.d.ts`, `src/shared/types.ts`, `src/shared/catalog.ts` and `docs/PLAN.md`.
   - Stubs, each handed to its builder: `src/game/index.ts` (A), `src/app/App.tsx` and `src/index.css` (B).
   - Run `gh api -X PUT repos/Nuja1337/flickwise/actions/permissions -F enabled=false` before the first push.
   - Check: `npm install`, then `npx tsc -b` is clean, `npx vitest run --passWithNoTests` passes, and `npm run dev` serves a blank page plus `/dev.html`.
2. **Builder A and builder B in parallel** (section 14). Neither edits root files, `src/shared/*` or the other's folders.
   - Check: each runs `npx tsc -b` and its own tests green. A also goes through the manual list on `/dev.html`.
3. **Integration (one builder, after both finish).** It writes `src/integration/pipeline.test.ts` and `src/integration/calibrate.test.ts` (section 12). The main session then updates `DEMAND_ANCHORS.aim` in `catalog.ts` from the calibration output. Only aim is estimated; the other anchors follow exactly from the presets.
   - Check: `npm run check` is green, and the pipeline test finds the planted weakness.
4. **Review.** A reviewer reads both halves against this plan and the contract, plus a copy pass against writing.md.
5. **Manual browser pass.** Chrome at 60 and 144 or 240 Hz, raw input, a pen tablet, Firefox, Safari, and Z/X plus chorded mouse buttons.
6. **Deploy (main session).** `npm run deploy`.
   - Check: https://flickwise.ajshaham.workers.dev loads, the deep link `/stats` loads the app, and a saved play survives a reload.

---

## 2. Architecture and file tree

React handles menus, settings, results and stats. The play screen mounts one `<canvas>` and hands it to the engine, which is plain TypeScript with no React. Everything in `src/game/{rules,map,modes,sim}` is pure and has no DOM, so Node tests run it headless. There's no backend. Data lives in IndexedDB.

**Dependencies:**
- Runtime: `react`, `react-dom`, `react-router`. The router is already familiar from drafts and sims, and handles params and back/forward.
- Dev: `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `vitest`, `fake-indexeddb`, `wrangler`, `@types/react`, `@types/react-dom`, `@types/node`.
- No chart library, no state library, no fonts. The system UI stack with tabular numbers is enough.

```
flickwise/
  package.json, tsconfig*.json, vite.config.ts, vitest.config.ts, wrangler.jsonc,
  index.html, dev.html, .gitignore                          main session
  docs/PLAN.md                                              main session
  README.md, public/favicon.svg                             B
  src/main.tsx, src/vite-env.d.ts                           main session
  src/index.css                                             B (Tailwind import + theme tokens)
  src/shared/types.ts       the contract (section 3)        main session, frozen
  src/shared/catalog.ts     shared constants, copy, formulas main session, frozen
  src/game/                                                 A
    index.ts                public API: createGame, previewLaunch, playTestSound, ENGINE_VERSION, GENERATOR_VERSION
    engine/clock.ts         performance.now() <-> play time, pause accounting
    engine/input.ts         pointer and keyboard listeners, pointer lock, buttons-bitmask diffing, timestamps
    engine/cursor.ts        absolute/raw cursor model, sample ring buffer, positionAt(t)
    engine/playfield.ts     logical playfield <-> CSS px <-> device px, DPR, resize
    engine/loop.ts          requestAnimationFrame loop, refresh-rate and FPS estimate
    engine/session.ts       GameSession: the headless core (objects, judging, combo, score, health, records, feedback events)
    engine/game.ts          browser wrapper: wires clock, input, session, runner, renderer, audio; implements GameHandle
    rules/judge.ts          press resolution, circle judgment, early/aim/skipped misses
    rules/slider.ts         ball position, ticks, tracking with hysteresis, slider stats
    rules/spinner.ts        rotation accumulation, RPM, spinner stats
    rules/scoring.ts        points, combo, accuracy, health
    rules/records.ts        aim decomposition, movement metrics, HitRecord assembly
    map/rng.ts              seeded PRNG (sfc32 + splitmix32), string hash, fork(label)
    map/path.ts             path flattening, length, pointAt(s), arc through three points
    map/difficulty.ts       DifficultySettings + mods -> generator params (section 6)
    map/placement.ts        bounds, overlap and angle search (section 7)
    map/patterns.ts         pattern library as "turtle programs" (section 7)
    map/generator.ts        sections, intensity curve, motifs, Dynamic map
    map/features.ts         computeFeatures(map) -> ObjectFeatures[]
    map/mods.ts             applyMods: mirror, rate, health flags
    modes/staircase.ts      adaptive level controller
    modes/modules.ts        per-module paramsAtLevel and set builders (section 8)
    modes/runner.ts         ModeRunner: initial map, next set on set end, final levels
    render/theme.ts         colours, sizes
    render/renderer.ts      draw passes in order (section 4)
    render/objects.ts, render/effects.ts, render/hud.ts, render/cursor.ts
    render/strings.ts       every piece of text drawn on the canvas (writing rules)
    audio/audio.ts          AudioContext, graph, volumes; audio/sounds.ts the synth voices
    sim/autoplay.ts         player models and synthetic input; sim/headless.ts runs runner+session in Node
    dev/harness.ts          dev.html page: pick mode/level/mods, play, log PlayResult
    **/*.test.ts            next to the code
  src/app/                                                  B
    App.tsx, layout/Shell.tsx, components/* (Button, Slider, Toggle, Segmented, Card, Stat, KeyCapture)
    pages/Home.tsx, PlaySetup.tsx (Dynamic), Train.tsx, ModuleSetup.tsx, PlayScreen.tsx, Results.tsx, Settings.tsx
    pages/stats/{Layout,Overview,Trends,Patterns,Timing,Bests,History,PlayDetail}.tsx
    charts/{LineChart,Histogram,HeatGrid,Rose,AimScatter,Bars}.tsx, charts/scale.ts   (own SVG)
    hooks/useSettings.ts, state/launch.ts (builds LaunchRequest, random seed), play/fakeGame.ts (dev only)
    copy.ts, copy.test.ts, boundary.test.ts
  src/data/                                                 B
    db.ts (open, migrations), schema.ts (stored types), columns.ts (pack/unpack), plays.ts, settings.ts,
    progress.ts, drills.ts, meta.ts, retention.ts, exportImport.ts, sync.ts (interface only)
  src/analytics/                                            B
    stats.ts, buckets.ts, summary.ts, demand.ts, ratings.ts, trends.ts, insights.ts, insightCopy.ts,
    drillEval.ts, sessions.ts, bests.ts, fixtures.ts (synthetic records for tests)
  src/integration/                                          step 3
```

**Root files for the main session:**
- `package.json` scripts: `dev: vite`, `build: vite build`, `preview: vite preview`, `typecheck: tsc -b`, `test: vitest run`, `check: tsc -b && vitest run`, `deploy: vite build && wrangler deploy`.
- Versions as in drafts and sims: react and react-dom ^19.3.0, react-router ^8.4.0, vite ^8.3.0, @vitejs/plugin-react ^6.1.1, tailwindcss and @tailwindcss/vite ^4.3.3, typescript ^7.0.2, vitest ^5.0.1, wrangler ^4.141.0, fake-indexeddb ^6.2.5, @types/node ^26.6.2.
- `vite.config.ts`: `plugins: [react(), tailwindcss()]`, `build.target: 'es2022'`, and no Cloudflare plugin.
- `vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts']`.
- tsconfig: copy the sims split.
  - App config: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `jsx: react-jsx`, and `types: ['vite/client']`. Exclude `src/**/*.test.ts` and drop the WebWorker lib.
  - Add `tsconfig.test.json` covering `src/**/*.test.ts` with `types: ['node']`, referenced from `tsconfig.json`.
  - Imports are extensionless.
- `wrangler.jsonc`: your config verbatim, plus `$schema`.
- `index.html`:
  - Title "Flickwise", `<meta name="color-scheme" content="dark">`, `<div id="root">` and `/src/main.tsx`.
  - Description: "Flickwise is a browser aim trainer that tracks where and how you miss, and suggests drills for your weak spots."
- `dev.html`: loads `/src/game/dev/harness.ts`. It's only served in dev, because the build input stays `index.html`.
- `main.tsx`: as in sims, importing `./app/App` and `./index.css`.
- `.gitignore`: node_modules, dist, .wrangler, *.tsbuildinfo, .DS_Store, *.log, coverage.

---

## 3. The shared contract

Write these two files verbatim. Ids are permanent once data exists. Labels can change any time.

### `src/shared/types.ts`

```ts
// Shared contract for Flickwise. The game (src/game) and the app (src/app, src/data, src/analytics)
// both code against this file and never edit it. Changes go through the main session.
//
// Units: positions and lengths are playfield units (PLAYFIELD in catalog.ts: 1000 x 625, origin top-left,
// y grows downward). Times are milliseconds. Angles are degrees unless a name says otherwise.

export type Ms = number;

export interface Vec2 {
  x: number;
  y: number;
}

/* ---------------------------------------------------------------- ids */
/* These strings are stored in the database and in export files. Add new ones; never rename. */

export type ModeId =
  | 'dynamic'
  | 'jumps'
  | 'angles'
  | 'streams'
  | 'tracking'
  | 'spinning'
  | 'precision'
  | 'reading'
  | 'timing'
  | 'stamina'
  | 'warmup'
  | 'mix';

/** Training modules whose level adapts after every set. */
export type ModuleId =
  | 'jumps'
  | 'angles'
  | 'streams'
  | 'tracking'
  | 'spinning'
  | 'precision'
  | 'reading'
  | 'timing';

export type ModId = 'fade' | 'spotlight' | 'fast' | 'slow' | 'tight' | 'wide' | 'mirror' | 'nofail' | 'onelife';

export type SkillId = 'aim' | 'speed' | 'tracking' | 'precision' | 'timing' | 'reading' | 'spin';

export type Judgment = 'crisp' | 'solid' | 'rough' | 'miss';

export type ObjectKind = 'circle' | 'slider' | 'spinner';

export type PatternTag =
  | 'single'
  | 'jump'
  | 'backforth'
  | 'triangle'
  | 'square'
  | 'star'
  | 'flow'
  | 'stream'
  | 'burst'
  | 'doubles'
  | 'slider'
  | 'spinner';

export type InputSlot = 'key1' | 'key2' | 'mouse1' | 'mouse2';

export type PointerKind = 'mouse' | 'pen' | 'touch';

/**
 * Why an object ended as a miss.
 * none: never pressed. aim: pressed in time but outside the target (the nearest such press is recorded).
 * early: pressed on the target before its rough window. skipped: a later object was hit first.
 * tracking: slider tracked too little. spin: spinner under half its rotations.
 */
export type MissReason = 'none' | 'aim' | 'early' | 'skipped' | 'tracking' | 'spin';

/* --------------------------------------------------------- difficulty */

/** Dynamic mode controls. Ranges and labels are in DIFFICULTY_LIMITS (catalog.ts). */
export interface DifficultySettings {
  /** Target radius, playfield units. 30..70. */
  radius: number;
  /** Time a target shows before its hit time. 300..1800. */
  approachMs: Ms;
  /** Beat grid tempo. 90..260. Streams use quarter beats. */
  bpm: number;
  /** 1..10. Share of jumps on half beats instead of full beats. */
  density: number;
  /** 1..10. Jump distance for a given gap. */
  spacing: number;
  /** 1..10. Sharper angles, shapes and mixed rhythms as it rises. */
  complexity: number;
  /** 0..10. How often streams and bursts appear. 0 = never. */
  streams: number;
  /** 3..32. Most notes in one stream. */
  streamMaxLength: number;
  /** 0..10. How often sliders appear. 0 = never. */
  sliders: number;
  /** 0..10. How often spinners appear at section boundaries. 0 = never. */
  spinners: number;
  /** 0..10. Hit window strictness, see windowsForTiming. */
  timing: number;
}

export interface LevelPreset {
  /** 1..8 */
  level: number;
  label: string;
  description: string;
  difficulty: DifficultySettings;
  lengthSec: number;
}

/** Options for training modules. Each mode lists the keys it uses in MODES[id].options. */
export interface ModuleOptions {
  /** jumps */
  distanceFocus?: 'mixed' | 'short' | 'long';
  /** jumps: bias movement toward one direction. Octant 0..7: 0 = moving right, then clockwise on screen (2 = down). */
  directionFocus?: number | null;
  /** angles */
  angleFocus?: 'mixed' | 'sharp' | 'wide';
  /** streams */
  streamLength?: 'short' | 'medium' | 'long';
  /** tracking */
  sliderFocus?: 'mixed' | 'straight' | 'curves' | 'repeats';
  /** mix: two to four modules, played in this order, one set each. */
  mixModules?: ModuleId[];
}

/* --------------------------------------------------------- mods, modes */

export interface ModInfo {
  id: ModId;
  label: string;
  description: string;
  /** Score multiplier. Multipliers of chosen mods multiply together. */
  multiplier: number;
  /** Mods that can't be on together with this one. */
  conflicts: ModId[];
  /** 'all' = Dynamic and training modules. 'dynamic' = Dynamic only. */
  scope: 'all' | 'dynamic';
}

export interface ModeInfo {
  id: ModeId;
  label: string;
  description: string;
  /** Skills the mode trains, for menus. */
  skills: SkillId[];
  /** Level adapts after every set. */
  adaptive: boolean;
  lengthOptions: number[];
  defaultLengthSec: number;
  options: (keyof ModuleOptions)[];
  defaultOptions: ModuleOptions;
  /** Objects per set (taps, sliders or spinners). 0 when the mode has no sets of its own. */
  setSize: number;
  allowedMods: ModId[];
}

/* -------------------------------------------------------- hit objects */

export interface HitWindows {
  /** Half-widths. |error| <= crisp is Crisp, <= solid is Solid, <= rough is Rough. */
  crisp: Ms;
  solid: Ms;
  rough: Ms;
  /** A press on the target between -early and -rough is an early miss. Earlier presses are ignored. */
  early: Ms;
}

interface HitObjectBase {
  /** 0-based play order. Equal to the object's position in GeneratedMap.objects. */
  index: number;
  /** Hit time (circle, slider head) or start time (spinner). */
  time: Ms;
  /** Center. Spinners always use PLAYFIELD_CENTER. */
  pos: Vec2;
  radius: number;
  approachMs: Ms;
  windows: HitWindows;
  /** Colour group. Increases by one at each new pattern. */
  group: number;
  /** Number drawn on the target, 1-based within its group. */
  number: number;
  pattern: PatternTag;
  /** Section intensity 0..1 where the object sits. */
  intensity: number;
  /** Adaptive set index, or -1 outside sets. */
  set: number;
}

export interface CircleObject extends HitObjectBase {
  kind: 'circle';
}

/**
 * Slider path pieces. Each starts where the previous one ended; the first starts at the slider's pos.
 * line: straight to `to`. arc: circular arc through `through` to `to`. cubic: Bezier with controls c1, c2.
 */
export type PathSegment =
  | { type: 'line'; to: Vec2 }
  | { type: 'arc'; through: Vec2; to: Vec2 }
  | { type: 'cubic'; c1: Vec2; c2: Vec2; to: Vec2 };

export interface SliderObject extends HitObjectBase {
  kind: 'slider';
  path: PathSegment[];
  /** Arc length, measured with the flattening in src/game/map/path.ts. */
  length: number;
  /** Ball speed, units per ms. */
  velocity: number;
  /** Reversals. 0 = one pass. */
  repeats: number;
  /** One pass: length / velocity. */
  spanMs: Ms;
  /** time + spanMs * (repeats + 1). */
  endTime: Ms;
  /** Distance between ticks along the path. 0 = no ticks. */
  tickDistance: number;
  /** Once tracking, the cursor must stay within this distance of the ball while holding. */
  followRadius: number;
  /** straight = one line, arc = one arc, curve = anything with a cubic. */
  shape: 'straight' | 'arc' | 'curve';
}

export interface SpinnerObject extends HitObjectBase {
  kind: 'spinner';
  endTime: Ms;
  /** Full turns needed for Crisp. A multiple of 0.5. */
  rotationsRequired: number;
}

export type HitObject = CircleObject | SliderObject | SpinnerObject;

export interface HealthRules {
  /** Health lost per second of active play, on a 0..1 scale. */
  drainPerSec: number;
  /** Health lost per missed object. */
  missPenalty: number;
  /** Health lost per missed slider tick, repeat or end. */
  partPenalty: number;
  /** false with No Fail: health shows but can't end the play. */
  canFail: boolean;
  /** One Life: any combo break ends the play. */
  failOnFirstMiss: boolean;
}

export type SectionFocus = 'jumps' | 'flow' | 'streams' | 'sliders' | 'mixed' | 'break' | 'set';

export interface MapSection {
  start: Ms;
  end: Ms;
  intensity: number;
  focus: SectionFocus;
}

export interface GeneratedMap {
  /** MAP_FORMAT from catalog.ts. */
  format: number;
  /** GENERATOR_VERSION from src/game. Same seed + version + launch = same map on the same browser. */
  generatorVersion: number;
  seed: number;
  modeId: ModeId;
  /** 60000 / bpm of the beat grid. */
  beatMs: Ms;
  /** Last object's end time + 1000. Grows as adaptive sets are added. */
  durationMs: Ms;
  /** null = no health bar and no fail (training modules). */
  health: HealthRules | null;
  objects: HitObject[];
  sections: MapSection[];
}

/** A map after mods: positions mirrored, times scaled by rate, health flags set. */
export interface PlayableMap extends GeneratedMap {
  mods: ModId[];
  /** Fast 1.25, Slow 0.8, otherwise 1. Times, approach and spans are already divided by it. */
  rate: number;
}

/* ------------------------------------------------------------- launch */

export interface LaunchRequest {
  modeId: ModeId;
  /** Used by Dynamic. Modules ignore it (pass DEFAULT_DIFFICULTY). */
  difficulty: DifficultySettings;
  /** Dynamic preset the difficulty came from, or null for custom and for modules. */
  presetLevel: number | null;
  options: ModuleOptions;
  mods: ModId[];
  /** uint32 */
  seed: number;
  lengthSec: number;
  /** The player's current module levels from progress. Missing modules use DEFAULT_MODULE_LEVEL. */
  levels: Partial<Record<ModuleId, number>>;
  /** Set when the play was started from an insight's drill. */
  drillId: string | null;
}

/* ------------------------------------------------------------ records */

export interface ObjectFeatures {
  /** From the previous object's end position (slider tail) to this object. null for the first object and after a spinner. */
  distance: number | null;
  /** From the previous object's end time to this object's time. null for the first object. */
  gapMs: Ms | null;
  /** distance / gapMs, units per ms. */
  velocity: number | null;
  /** distance / (2 * radius), in target widths. */
  spacing: number | null;
  /** Turn between the previous movement and this one, 0..180. 0 = straight on, 180 = full reversal.
   *  null unless both movements exist and are at least 0.5 radius long. */
  turnAngle: number | null;
  /** Direction of this movement, 0..360: 0 = right, 90 = down. null when distance is null or under 0.5 radius. */
  direction: number | null;
  /** 1-based position in a run of 3+ objects with equal gaps under 160 ms. 0 when not in such a run. */
  runIndex: number;
  /** Length of that run, 0 when not in one. */
  runLength: number;
  /** Objects visible at this object's time (approach started, not yet ended), including itself. */
  visibleCount: number;
  /** time / map duration, 0..1. */
  progress: number;
}

export interface MovementMetrics {
  /** First time the cursor entered the target after the previous object, relative to this object's time.
   *  Negative = arrived early. null when it never entered before the press, or there was no press. */
  arriveMs: Ms | null;
  /** Straight distance / cursor path length from the previous object's end to the press, 0..1. */
  efficiency: number | null;
  /** Extra speed peaks after the main one (corrective submovements). */
  corrections: number | null;
  /** Highest cursor speed in that interval, units per ms. */
  peakSpeed: number | null;
}

export interface SliderStats {
  /** Ticks and repeats, excluding head and end. */
  ticksHit: number;
  ticksTotal: number;
  endHit: boolean;
  /** Share of the slider's duration spent tracking, 0..1. */
  trackedFraction: number;
  /** Mean distance cursor-to-ball while the slider runs. */
  meanDistance: number;
  /** Mean signed error along the path direction. Negative = behind the ball. */
  meanLag: number;
  /** RMS error across the path. */
  lateralRms: number;
  /** Times tracking was lost after it started. */
  breaks: number;
  /** Progress 0..1 over the whole slider (all passes) where tracking was first lost, or null. */
  firstLossAt: number | null;
  shape: 'straight' | 'arc' | 'curve';
  length: number;
  velocity: number;
  repeats: number;
  followRadius: number;
}

export interface SpinnerStats {
  rotations: number;
  rotationsRequired: number;
  meanRpm: number;
  peakRpm: number;
  rpmSd: number;
  heldMs: Ms;
  durationMs: Ms;
}

export interface HitRecord {
  index: number;
  kind: ObjectKind;
  pattern: PatternTag;
  set: number;
  time: Ms;
  /** Same as time for circles. */
  endTime: Ms;
  pos: Vec2;
  radius: number;
  approachMs: Ms;
  crispMs: Ms;
  /** Final judgment. Sliders: worse of head and tracking. */
  judgment: Judgment;
  /** Head press judgment. Same as judgment for circles, null for spinners. */
  headJudgment: Judgment | null;
  /** null unless judgment is 'miss' (or a slider head missed). */
  missReason: MissReason | null;
  /** Press time minus object time. Negative = early. null when there was no press. */
  timingError: Ms | null;
  /** Cursor at the press. null when there was no press. */
  hit: Vec2 | null;
  /** Aim error along the incoming movement direction. Positive = overshoot. null without press or direction. */
  aimAlong: number | null;
  /** Aim error across the movement. Positive = to the right of the movement direction. */
  aimLateral: number | null;
  /** Distance from the press to the center. */
  aimRadial: number | null;
  input: InputSlot | null;
  comboBefore: number;
  /** A pause overlapped this object's approach. Analytics skips these. */
  afterPause: boolean;
  features: ObjectFeatures;
  movement: MovementMetrics;
  slider: SliderStats | null;
  spinner: SpinnerStats | null;
}

/* ------------------------------------------------------------- result */

export type PlayStatus = 'completed' | 'failed' | 'quit';

export interface JudgmentCounts {
  crisp: number;
  solid: number;
  rough: number;
  miss: number;
}

export interface LevelStep {
  set: number;
  module: ModuleId;
  level: number;
  /** Success share in this set, 0..1, as the module defines success. */
  success: number;
  objects: number;
}

export interface InputInfo {
  pointer: PointerKind | 'mixed' | null;
  rawInput: boolean;
  /** Pointer lock with unadjustedMovement was granted. */
  unadjusted: boolean;
  sensitivity: number;
  /** Median pointer sample rate seen, Hz. */
  pointerHz: number | null;
  /** Median frame rate seen, Hz. */
  displayHz: number | null;
}

export interface PlayMapInfo {
  format: number;
  generatorVersion: number;
  seed: number;
  beatMs: Ms;
  durationMs: Ms;
  rate: number;
  mods: ModId[];
  health: HealthRules | null;
  counts: Record<ObjectKind, number>;
}

export interface PlayResult {
  /** RECORD_VERSION from catalog.ts. */
  recordVersion: number;
  engineVersion: number;
  launch: LaunchRequest;
  map: PlayMapInfo;
  /** Epoch ms (Date.now) at the first input that started the play, and at the end. */
  startedAt: number;
  endedAt: number;
  /** Play time, pauses excluded. */
  playedMs: Ms;
  status: PlayStatus;
  score: number;
  /** 0..1 */
  accuracy: number;
  maxCombo: number;
  counts: JudgmentCounts;
  sliderParts: { hit: number; total: number };
  /** Presses that hit no object. */
  strayPresses: number;
  pauses: number;
  /** Empty outside adaptive modes. */
  levels: LevelStep[];
  /** Measured level per adaptive module played. */
  finalLevels: Partial<Record<ModuleId, number>>;
  healthAtEnd: number | null;
  input: InputInfo;
  /** Judged objects only, sorted by index. */
  records: HitRecord[];
}

/* ----------------------------------------------------------- settings */

export interface Settings {
  v: 1;
  input: {
    /** Pointer lock with unadjusted movement where the browser allows it. */
    rawInput: boolean;
    /** Raw mode only. 1 = one mouse count moves the cursor one CSS pixel. 0.1..5. */
    sensitivity: number;
    /** KeyboardEvent.code for the two hit keys. */
    keys: [string, string];
    /** Left and right mouse buttons (and pen tip and barrel) count as presses. */
    mouseButtons: boolean;
    /** Absolute mode cursor. 'system' uses a CSS crosshair (lowest latency). Raw mode always draws. */
    cursor: 'system' | 'drawn';
    /** 0.5..2 */
    cursorScale: number;
    cursorTrail: boolean;
  };
  audio: {
    /** 0..1 */
    master: number;
    muted: boolean;
    hits: number;
    effects: number;
    ambient: number;
  };
  display: {
    errorBar: boolean;
    pathHints: boolean;
    crispPopups: boolean;
    earlyLate: boolean;
    reduceMotion: boolean;
    /** Canvas with desynchronized: true. Takes effect at the next play. */
    lowLatency: boolean;
    showFps: boolean;
  };
  data: {
    /** Days to keep per-object detail. null = forever. Play summaries are always kept. */
    detailRetentionDays: number | null;
  };
  updatedAt: number;
}

/* ----------------------------------------------------------- game API */

export interface GameCallbacks {
  onPause(paused: boolean): void;
  /** Fires once, when the play completes, fails or is quit. Never after destroy(). */
  onFinish(result: PlayResult): void;
  /** The engine could not start. The message is shown to the player as is. */
  onError(message: string): void;
}

export interface GameHandle {
  /** Resume from pause. Call from a click or key handler: raw input needs a user gesture to lock again. */
  resume(): void;
  pause(): void;
  /** End early. onFinish fires with status 'quit'. */
  quit(): void;
  /** Apply volume and display changes live. Input mode changes apply at the next play. */
  setSettings(settings: Settings): void;
  /** Stop, release pointer lock, close audio voices, remove listeners. Safe to call twice. */
  destroy(): void;
}

export interface MapPreview {
  /** Whole map for Dynamic, stamina and warmup; the first set for adaptive modes. */
  map: PlayableMap;
  features: ObjectFeatures[];
}

export type CreateGame = (
  canvas: HTMLCanvasElement,
  launch: LaunchRequest,
  settings: Settings,
  callbacks: GameCallbacks,
) => GameHandle;

export type PreviewLaunch = (launch: LaunchRequest) => MapPreview;

/** Plays one feedback sound. Call from a click handler (audio needs a user gesture). */
export type PlayTestSound = (settings: Settings, sound: 'hit' | 'miss' | 'combo') => void;
```

### `src/shared/catalog.ts`

```ts
// Shared constants, player-facing copy and small formulas. Both builders import from here and never edit it.
// Text here is shown to players and follows reference/writing.md.

import type {
  DifficultySettings,
  HitWindows,
  Judgment,
  LevelPreset,
  ModId,
  ModInfo,
  ModeId,
  ModeInfo,
  ModuleId,
  Settings,
  SkillId,
} from './types';

export const PLAYFIELD = { width: 1000, height: 625 } as const;
export const PLAYFIELD_CENTER = { x: 500, y: 312.5 } as const;
/** Visual radius of a spinner, playfield units. */
export const SPINNER_RADIUS = 240;

/** Shape of GeneratedMap. */
export const MAP_FORMAT = 1;
/** Shape of HitRecord and PlayResult. Bump with a migration when either changes. */
export const RECORD_VERSION = 1;

export const JUDGMENTS: Record<Judgment, { label: string; weight: number; color: string }> = {
  crisp: { label: 'Crisp', weight: 1, color: '#a78bfa' },
  solid: { label: 'Solid', weight: 0.65, color: '#2dd4bf' },
  rough: { label: 'Rough', weight: 0.3, color: '#f59e0b' },
  miss: { label: 'Miss', weight: 0, color: '#f43f5e' },
};

/** Hit windows for timing strictness 0..10. Timing 5 gives 40, 80 and 120 ms. */
export function windowsForTiming(timing: number): HitWindows {
  const crisp = 57.5 - 3.5 * timing;
  return { crisp, solid: 2 * crisp, rough: 3 * crisp, early: 3 * crisp + 60 };
}

export const MOD_RATE = { fast: 1.25, slow: 0.8 } as const;
export const MOD_SCALE = {
  tight: { radius: 0.8, windows: 0.75 },
  wide: { radius: 1.25, windows: 1.3 },
} as const;

const ALL_MODS: ModId[] = ['fade', 'spotlight', 'fast', 'slow', 'tight', 'wide', 'mirror', 'nofail', 'onelife'];
const MODULE_MODS: ModId[] = ['fade', 'spotlight', 'mirror'];

export const MODS: Record<ModId, ModInfo> = {
  fade: {
    id: 'fade',
    label: 'Fade',
    description: "Targets fade out before you hit them, and there's no approach ring.",
    multiplier: 1.05,
    conflicts: [],
    scope: 'all',
  },
  spotlight: {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'You can only see the area around your cursor.',
    multiplier: 1.1,
    conflicts: [],
    scope: 'all',
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    description: 'The map plays 25% faster. Hit windows keep their length.',
    multiplier: 1.15,
    conflicts: ['slow'],
    scope: 'dynamic',
  },
  slow: {
    id: 'slow',
    label: 'Slow',
    description: 'The map plays 20% slower. Hit windows keep their length.',
    multiplier: 0.7,
    conflicts: ['fast'],
    scope: 'dynamic',
  },
  tight: {
    id: 'tight',
    label: 'Tight',
    description: 'Targets are 20% smaller and hit windows are 25% shorter.',
    multiplier: 1.1,
    conflicts: ['wide'],
    scope: 'dynamic',
  },
  wide: {
    id: 'wide',
    label: 'Wide',
    description: 'Targets are 25% larger and hit windows are 30% longer.',
    multiplier: 0.6,
    conflicts: ['tight'],
    scope: 'dynamic',
  },
  mirror: {
    id: 'mirror',
    label: 'Mirror',
    description: 'The map is flipped left to right.',
    multiplier: 1,
    conflicts: [],
    scope: 'all',
  },
  nofail: {
    id: 'nofail',
    label: 'No Fail',
    description: "Running out of health doesn't end the play.",
    multiplier: 0.8,
    conflicts: ['onelife'],
    scope: 'dynamic',
  },
  onelife: {
    id: 'onelife',
    label: 'One Life',
    description: 'Your first miss ends the play.',
    multiplier: 1,
    conflicts: ['nofail'],
    scope: 'dynamic',
  },
};

export function modMultiplier(mods: readonly ModId[]): number {
  return mods.reduce((m, id) => m * MODS[id].multiplier, 1);
}

/** Pairs of chosen mods that can't be combined. Empty when the set is valid. */
export function modConflicts(mods: readonly ModId[]): [ModId, ModId][] {
  const out: [ModId, ModId][] = [];
  for (const a of mods) for (const b of MODS[a].conflicts) if (a < b && mods.includes(b)) out.push([a, b]);
  return out;
}

export const SKILLS: Record<SkillId, { label: string; description: string }> = {
  aim: { label: 'Aim', description: 'Jumps between targets' },
  speed: { label: 'Speed', description: 'Fast taps in streams' },
  tracking: { label: 'Tracking', description: 'Staying on sliders' },
  precision: { label: 'Precision', description: 'Landing near the center' },
  timing: { label: 'Timing', description: 'Hitting on time' },
  reading: { label: 'Reading', description: 'Short approach times and busy screens' },
  spin: { label: 'Spinning', description: 'Spinner speed' },
};

export const MODULE_IDS: ModuleId[] = ['jumps', 'angles', 'streams', 'tracking', 'spinning', 'precision', 'reading', 'timing'];
export const MODE_ORDER: ModeId[] = ['dynamic', 'warmup', 'mix', ...MODULE_IDS, 'stamina'];

/** Module levels are open-ended in principle; the engine clamps to this range. */
export const LEVEL_LIMITS = { min: 1, max: 15 } as const;
export const DEFAULT_MODULE_LEVEL = 3;
/** Adaptive modules aim for a success share inside this band. */
export const SUCCESS_BAND = { low: 0.7, high: 0.86 } as const;

const moduleMode = (
  id: ModeId,
  label: string,
  description: string,
  skills: SkillId[],
  extra: Partial<ModeInfo> = {},
): ModeInfo => ({
  id,
  label,
  description,
  skills,
  adaptive: true,
  lengthOptions: [60, 90, 120, 180],
  defaultLengthSec: 90,
  options: [],
  defaultOptions: {},
  setSize: 16,
  allowedMods: MODULE_MODS,
  ...extra,
});

export const MODES: Record<ModeId, ModeInfo> = {
  dynamic: moduleMode(
    'dynamic',
    'Dynamic',
    'Generated maps that mix every skill. Pick a level, or set each part of the difficulty yourself.',
    ['aim', 'speed', 'tracking', 'precision', 'timing', 'reading', 'spin'],
    { adaptive: false, lengthOptions: [60, 90, 120, 180, 240, 300], setSize: 0, allowedMods: ALL_MODS },
  ),
  jumps: moduleMode('jumps', 'Jumps', 'Single targets spread across the field. Trains how far you move and where you stop.', ['aim'], {
    options: ['distanceFocus', 'directionFocus'],
    defaultOptions: { distanceFocus: 'mixed', directionFocus: null },
  }),
  angles: moduleMode('angles', 'Angles', 'Jumps of one length with sharp or wide turns between them.', ['aim'], {
    options: ['angleFocus'],
    defaultOptions: { angleFocus: 'mixed' },
  }),
  streams: moduleMode('streams', 'Streams', 'Quick runs of taps close together. Trains tapping speed and even timing.', ['speed', 'timing'], {
    options: ['streamLength'],
    defaultOptions: { streamLength: 'medium' },
    setSize: 40,
  }),
  tracking: moduleMode('tracking', 'Tracking', 'Every target is a slider. Keep the cursor on the moving ball until it ends.', ['tracking'], {
    options: ['sliderFocus'],
    defaultOptions: { sliderFocus: 'mixed' },
    setSize: 6,
  }),
  spinning: moduleMode('spinning', 'Spinning', 'Spinners with a speed goal that rises as you improve.', ['spin'], {
    lengthOptions: [60, 90, 120],
    defaultLengthSec: 60,
    setSize: 2,
  }),
  precision: moduleMode('precision', 'Precision', 'Small targets at a calm pace. A hit only counts as a success near the center.', ['precision'], {
    setSize: 12,
  }),
  reading: moduleMode('reading', 'Reading', 'Short approach times with many targets on screen at once.', ['reading'], { setSize: 24 }),
  timing: moduleMode('timing', 'Timing', 'Large targets close together. The hit windows narrow as you improve.', ['timing'], { setSize: 20 }),
  stamina: moduleMode('stamina', 'Stamina', 'Long streams and jump runs at a steady level. Shows when your accuracy starts to drop.', ['speed', 'aim'], {
    adaptive: false,
    lengthOptions: [120, 180, 300],
    defaultLengthSec: 180,
    setSize: 0,
  }),
  warmup: moduleMode('warmup', 'Warm-up', 'Mixed patterns a little below your usual level, to start a session.', [], {
    adaptive: false,
    lengthOptions: [60, 120, 180],
    defaultLengthSec: 120,
    setSize: 0,
  }),
  mix: moduleMode('mix', 'Mix', 'Sets from two to four modules in turn. Each module keeps its own level.', [], {
    lengthOptions: [90, 120, 180, 300],
    defaultLengthSec: 180,
    options: ['mixModules'],
    defaultOptions: { mixModules: ['jumps', 'streams', 'tracking'] },
    setSize: 0,
  }),
};

const d = (
  radius: number, approachMs: number, bpm: number, density: number, spacing: number, complexity: number,
  streams: number, streamMaxLength: number, sliders: number, spinners: number, timing: number,
): DifficultySettings => ({ radius, approachMs, bpm, density, spacing, complexity, streams, streamMaxLength, sliders, spinners, timing });

export const LEVEL_PRESETS: readonly LevelPreset[] = [
  { level: 1, label: 'Level 1', description: 'Large, slow targets with plenty of time to read them.', difficulty: d(64, 1500, 110, 2, 2, 1, 0, 3, 5, 3, 1), lengthSec: 60 },
  { level: 2, label: 'Level 2', description: 'Short jumps and the first short bursts.', difficulty: d(60, 1300, 125, 3, 3, 2, 1, 5, 5, 3, 2), lengthSec: 75 },
  { level: 3, label: 'Level 3', description: 'Medium jumps, sliders and bursts of up to seven taps.', difficulty: d(57, 1150, 140, 4, 4, 3, 2, 7, 5, 2, 3), lengthSec: 90 },
  { level: 4, label: 'Level 4', description: 'Faster jumps and streams of up to nine taps.', difficulty: d(54, 1000, 155, 5, 5, 4, 3, 9, 4, 2, 4), lengthSec: 90 },
  { level: 5, label: 'Level 5', description: 'Jumps on half beats and streams of up to twelve taps.', difficulty: d(50, 850, 170, 6, 6, 5, 4, 12, 4, 2, 5), lengthSec: 90 },
  { level: 6, label: 'Level 6', description: 'Smaller targets, sharper angles and streams of up to sixteen taps.', difficulty: d(46, 720, 185, 7, 7, 6, 5, 16, 4, 2, 6), lengthSec: 120 },
  { level: 7, label: 'Level 7', description: 'Short approach times, long streams and wide jumps.', difficulty: d(42, 600, 200, 8, 8, 7, 5, 20, 3, 1, 7), lengthSec: 120 },
  { level: 8, label: 'Level 8', description: 'Small, fast targets with the shortest approach time.', difficulty: d(38, 480, 220, 9, 9, 8, 6, 24, 3, 1, 8), lengthSec: 120 },
];

export const DEFAULT_DIFFICULTY: DifficultySettings = { ...LEVEL_PRESETS[3]!.difficulty };

export const DIFFICULTY_LIMITS: Record<keyof DifficultySettings, { min: number; max: number; step: number; label: string; help: string }> = {
  radius: { min: 30, max: 70, step: 1, label: 'Target size', help: 'Target radius in playfield units. The playfield is 1000 units wide.' },
  approachMs: { min: 300, max: 1800, step: 10, label: 'Approach time', help: 'How long each target shows before you hit it, in milliseconds.' },
  bpm: { min: 90, max: 260, step: 1, label: 'Tempo', help: 'Beats per minute. Jumps fall on full or half beats and streams on quarter beats.' },
  density: { min: 1, max: 10, step: 1, label: 'Density', help: 'How often jumps come on half beats instead of full beats.' },
  spacing: { min: 1, max: 10, step: 1, label: 'Jump distance', help: 'How far apart targets are for the time between them.' },
  complexity: { min: 1, max: 10, step: 1, label: 'Pattern complexity', help: 'Higher values add sharper angles, shapes and mixed rhythms.' },
  streams: { min: 0, max: 10, step: 1, label: 'Streams', help: 'How often streams and bursts appear. 0 turns them off.' },
  streamMaxLength: { min: 3, max: 32, step: 1, label: 'Longest stream', help: 'The most taps in one stream.' },
  sliders: { min: 0, max: 10, step: 1, label: 'Sliders', help: 'How often sliders appear. 0 turns them off.' },
  spinners: { min: 0, max: 10, step: 1, label: 'Spinners', help: 'How often spinners appear between sections. 0 turns them off.' },
  timing: { min: 0, max: 10, step: 1, label: 'Timing strictness', help: 'Higher values shorten every hit window. 5 gives 40, 80 and 120 ms.' },
};

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  input: { rawInput: false, sensitivity: 1, keys: ['KeyZ', 'KeyX'], mouseButtons: true, cursor: 'system', cursorScale: 1, cursorTrail: false },
  audio: { master: 0.6, muted: false, hits: 0.8, effects: 0.8, ambient: 0.5 },
  display: { errorBar: true, pathHints: true, crispPopups: false, earlyLate: true, reduceMotion: false, lowLatency: true, showFps: false },
  data: { detailRetentionDays: 365 },
  updatedAt: 0,
};

/* ------------------------------------------------------------ demand */
/* Raw demand per object, and anchors that map raw demand to the level scale (Level N preset = N). */

/** Raw demand at Dynamic levels 1..8. aim is an estimate until calibrated (plan step 3); the rest follow from the presets. */
export const DEMAND_ANCHORS: Record<SkillId, readonly number[]> = {
  aim: [2.9, 3.8, 4.6, 5.5, 6.6, 7.9, 9.5, 11.5], // bits per second
  speed: [7.3, 8.3, 9.3, 10.3, 11.3, 12.3, 13.3, 14.7], // taps per second
  tracking: [1.68, 2.31, 3.01, 3.82, 4.85, 6.1, 7.63, 9.54], // ball speed / follow radius, per second
  precision: [15.6, 16.7, 17.5, 18.5, 20.0, 21.7, 23.8, 26.3], // 1000 / radius
  timing: [18.5, 19.8, 21.3, 23.0, 25.0, 27.4, 30.3, 33.9], // 1000 / crisp window
  reading: [0.67, 0.77, 0.87, 1.0, 1.18, 1.39, 1.67, 2.08], // 1000 / approach, mod-weighted
  spin: [121, 138, 154, 171, 187, 204, 220, 242], // rpm
};

/** Raw demand at a level. Linear between anchors, extended past 8 with the last step, scaled toward 0 below 1. */
export function rawDemandAt(skill: SkillId, level: number): number {
  const a = DEMAND_ANCHORS[skill];
  if (level <= 1) return a[0]! * Math.max(0, level);
  const i = Math.min(Math.floor(level) - 1, a.length - 2);
  const lo = a[i]!;
  const hi = a[i + 1]!;
  return lo + (hi - lo) * (level - (i + 1));
}

/** Inverse of rawDemandAt. */
export function levelForDemand(skill: SkillId, raw: number): number {
  const a = DEMAND_ANCHORS[skill];
  if (raw <= a[0]!) return Math.max(0, raw / a[0]!);
  for (let i = 0; i < a.length - 1; i++) {
    const lo = a[i]!;
    const hi = a[i + 1]!;
    if (raw <= hi || i === a.length - 2) return i + 1 + (raw - lo) / (hi - lo);
  }
  return a.length;
}

/** Fitts index of difficulty per second of gap. */
export function aimDemand(distance: number, gapMs: number, radius: number): number {
  return Math.log2(distance / (2 * radius) + 1) / (Math.max(gapMs, 1) / 1000);
}
export function speedDemand(gapMs: number): number {
  return 1000 / Math.max(gapMs, 1);
}
export function trackingDemand(velocity: number, followRadius: number): number {
  return (1000 * velocity) / followRadius;
}
export function precisionDemand(radius: number): number {
  return 1000 / radius;
}
export function timingDemand(crispMs: number): number {
  return 1000 / crispMs;
}
export function readingDemand(approachMs: number, mods: readonly ModId[]): number {
  return (1000 / approachMs) * (1 + (mods.includes('fade') ? 0.5 : 0) + (mods.includes('spotlight') ? 0.3 : 0));
}
export function spinDemand(rotationsRequired: number, durationMs: number): number {
  return rotationsRequired / (durationMs / 60000);
}
```

---

## 4. Engine (A)

**Time.**
- Play time is real milliseconds: `play(t) = t − startPerf − pausedTotal`. Here `t` is any `performance.now()` timestamp, including `event.timeStamp` and the rAF timestamp, which share that timeline. `startPerf` is the first input after "Click or press Z to start". That first input also resumes audio and requests pointer lock.
- **Fast and Slow** change the map, not the clock. `applyMods` divides every time, `approachMs`, `spanMs` and spinner duration by the rate, and multiplies slider velocity by it. Hit windows stay in real ms. Every recorded error is then real ms with no rate math downstream.
- **Pause.**
  - Esc toggles it. Losing pointer lock, `visibilitychange` (hidden) and window `blur` also pause.
  - Resume runs a 1000 ms countdown while the frozen field stays visible, with a ghost ring at the cursor's paused position. That time counts into `pausedTotal`.
  - Objects whose approach window overlaps a pause get `afterPause: true`.
- The map's first object comes at or after `max(2000, approach + 1200)`. The play ends at the last object's end + 1000 ms.

**Loop.**
- Use `requestAnimationFrame` at the display rate with no cap.
- Each frame calls `session.advance(play(now))`. That expires objects whose deadline plus a 15 ms grace has passed, evaluates slider ticks at `t ≤ now − 20 ms` (so pointer samples up to the tick have arrived), drains health, and closes sets.
- Then render at the rAF timestamp.
- Estimate the refresh rate from the median rAF delta and the pointer rate from the median coalesced-sample interval. Both go into `InputInfo`.
- Allocate nothing per frame: pool particles and pop-ups, and keep ring buffers in typed arrays.

**Input.**
- Pointer listeners on the canvas: `pointerdown`, `pointerup`, `pointermove`, plus `pointerrawupdate` when `'onpointerrawupdate' in window`. With it, ignore `pointermove` for positions.
- Expand `getCoalescedEvents()` when present, and use each sample's own `timeStamp`.
- Mouse buttons are tracked by diffing the `buttons` bitmask on every pointer event. Pointer Events fire `pointerdown` only for the first button of a chord; later buttons arrive as `pointermove` with `button ≠ -1`.
  - Bit 1 is `mouse1` and bit 2 is `mouse2`.
  - A pen tip maps to `mouse1` and the barrel button to `mouse2`.
  - Touch contact maps to `mouse1`.
- Keyboard listeners on `window`: `keydown`/`keyup` matched by `event.code` against `settings.input.keys`, ignoring `repeat`. Bound keys, Space and Esc get `preventDefault`. Esc is never bindable.
- Also: prevent the context menu on the canvas, and set `touch-action: none` and `user-select: none` on it.
- Presses are judged **immediately** in the handler, so the hit sound isn't held back a frame.
  - Pointer presses use the event's own position.
  - Key presses use `cursor.positionAt(event.timeStamp)`, interpolated from the sample buffer.

**Cursor model.**
- Ring buffer of 4096 samples `{t, x, y}` in playfield units. `positionAt(t)` does a binary search and lerp. The buffer feeds key presses, slider ticks, spinner angles and movement metrics.
- **Absolute (default):** `unit = (clientX − rect.left − ox) / s`, same for y. The default cursor is a CSS crosshair, a data-URL SVG set by A on the canvas. It's drawn by the compositor, which has less latency than drawing it on the canvas.
- **Raw:** `canvas.requestPointerLock({ unadjustedMovement: true })`.
  - On a rejected promise or `NotSupportedError`, retry without the option and set `InputInfo.unadjusted = false`.
  - Then `pos += movementX × sensitivity / s`. The lock starts from the last absolute position, and the cursor is clamped to the playfield plus 5%.
  - If coalesced entries report zero movement while the parent event doesn't, use the parent's `movementX` (behaviour unconfirmed).
  - The cursor is always drawn in raw mode.
  - Pens skip raw mode. Tablets are absolute devices, so the engine falls back to absolute and notes it in InputInfo.
- After Esc releases the lock, the browser blocks an immediate re-lock. Resume therefore comes from a click on B's Resume button. If locking still fails, the canvas shows "Click to continue" and locks on that click.

**Playfield and scaling.**
- Logical field 1000 × 625 units, a 16:10 compromise between 16:9 screens and readable spacing.
- The canvas fills the viewport. A sets its backing size to `clientWidth × devicePixelRatio`, using a ResizeObserver plus a `matchMedia('(resolution: Xdppx)')` listener for DPR changes.
- A 56 CSS px band at the top holds the HUD, and 48 px at the bottom holds the error bar.
- Scale and offset: `s = min((W − 48)/1000, (H − 104)/625)`, centered within the remaining area. This letterboxes.
- Field drawing uses `setTransform(dpr·s, 0, 0, dpr·s, dpr·ox, dpr·oy)`. HUD drawing uses `setTransform(dpr, 0, 0, dpr, 0, 0)`.
- Context: `getContext('2d', { alpha: false, desynchronized: settings.display.lowLatency })`. Unsupported options are ignored. Canvas 2D is enough at 240 Hz for this object count. WebGL isn't needed.

**Render passes, in order.** All drawn on one canvas with `alpha: false`, so it paints its own background.
1. Background (#0b0f14) and the field, drawn from a cached offscreen bitmap (border #1f2937 and a faint 50-unit dot grid).
2. Path hints.
3. Slider bodies, cached per slider as offscreen bitmaps at the current scale.
4. Objects, later ones first so earlier ones sit on top.
5. Approach rings.
6. Slider balls and follow rings.
7. Spinner.
8. Effects: bursts, sparks, X marks.
9. Judgment pop-ups.
10. Spotlight mask.
11. HUD.
12. Cursor and trail.
13. Set-change text.
14. Overlays: start, countdown, out of health.

Pause and results menus are B's React DOM on top of the canvas. Effects never move the playfield. Shake applies to HUD text only.

**GameSession (headless core)** is used by `game.ts` and by Node tests.
- Methods: `move(t, pos)`, `press(slot, t, pos | null)`, `release(slot, t)`, `advance(now)`, `appendObjects(objs)`, `on(listener)`, `state`, `finish(status): PlayResult`.
- It emits FeedbackEvents (internal to A) consumed by the renderer and audio: hit, miss, tick, repeat, sliderEnd, track on/off, spin update/complete/bonus, comboBreak, milestone, stray, setEnd, fail, end.

---

## 5. Mechanics (A)

**Circle.**
- The approach ring shrinks linearly from 2.4r to 1.0r over `approachMs`. Its alpha ramps from 0 to 0.9 over the first 30%. The target body fades in over the first `min(300, 0.33·A)` ms.
- Windows come from `windowsForTiming(T)`; T = 5 gives Crisp ±40, Solid ±80 and Rough ±120 ms, with early misses back to −180 ms.
- Boundaries are inclusive. The hit area is the visual radius.
- An object left unjudged at `time + rough + 15 ms` is a Miss with reason `none`. That changes to `aim` if a stray press fell within ±rough of its time and within 3r of it; the nearest such press is recorded as `hit` and `timingError`. Aim misses carry the most aim-bias information, so this matters.

**Press resolution:**
1. The candidates are unjudged circles and slider heads with `pressTime ∈ [time − early, time + rough]`, sorted by time.
2. Take the first candidate whose circle contains the cursor.
   - Any earlier candidate whose `time ≤ pressTime` becomes a Miss (`skipped`).
   - If an earlier candidate's time is still ahead, the press is absorbed: no judgment, and nothing counts as stray.
3. If no candidate contains the cursor, the press is stray.
4. If the press lands on a candidate between −early and −rough, that's a Miss (`early`).

**Slider.**
- **Paths:**
  - `line`.
  - `arc`: a circle through three points. A collinear `through` falls back to a line.
  - `cubic`: Bezier.
- Flattening uses adaptive subdivision with 0.5-unit maximum error, a cumulative length table, and `pointAt(s)` by binary search. One function in `map/path.ts` serves the generator and the engine.
- **Ball:** pass `i = floor((t − time)/spanMs)`, `p = frac`, and `s = (i even ? p : 1 − p) × length`.
- The head is judged like a circle.
- **Tracking:**
  - It starts when any slot is held and the cursor is within 1.0r of the ball.
  - It continues while held and within `followRadius` (2.0r).
  - Tracking can start even when the head was missed.
- **Ticks and repeats:**
  - Ticks sit at `k·tickDistance` along each pass, skipping any within `0.1·tickDistance` of the pass end and mirrored on reverse passes.
  - A repeat check sits at each reversal.
  - The end check is at `endTime − 40 ms`, or at the midpoint of the last pass when `spanMs < 160`.
  - Each check passes when tracking at that time, using cursor interpolation and the held state at that time.
- **Final judgment:**
  - `f = parts hit / parts total`, where parts are ticks, repeats and the end.
  - Tracking judgment: Crisp at f = 1, Solid at ≥ 0.75, Rough at ≥ 0.4, otherwise Miss (`tracking`).
  - Final = worse of the head and tracking judgments. A missed head caps the final at Rough, and f = 0 with a missed head is a Miss.
- **Combo:** +1 for the head and for each part. Any missed part breaks combo.
- **Recorded:** SliderStats (contract). Distance, lag and lateral error are sampled at every cursor sample while the slider runs. `trackedFraction` is time-weighted.

**Spinner.**
- Always at the center, drawn with radius 240.
- Rotation accumulates only while a slot is held:
  - `Δφ = wrap(atan2 now − atan2 prev)` into (−π, π].
  - Skip samples within 12 units of the center, and reset the reference there.
  - Clamp `|Δφ| ≤ 2π·10·Δt/1000`, which caps it at 600 rpm.
  - `rotations = |ΣΔφ| / 2π` (net, so wiggling earns nothing).
- RPM is a rolling 500 ms window. Report the mean RPM (rotations ÷ held time), the peak, and `rpmSd` over 100 ms samples in the middle 80%.
- **Judgment** by `q = rotations / required`: Crisp at ≥ 1, Solid at ≥ 0.75, Rough at ≥ 0.5, otherwise Miss (`spin`). Each whole rotation beyond `required` is a bonus.
- Dynamic sets `rpmRequired = 1.1 × bpm`, `rotationsRequired = round(durationSec × rpm / 60 × 2) / 2`, and duration 1500 to 4500 ms. The spinning module uses `rawDemandAt('spin', L)` over 3000 ms.

**Streams.**
- Runs of circles at quarter beats with spacing `s = r·(0.6 + 0.07·spacing)`. Each note's turn is at most `8° + 2°·complexity` (28° cap).
- Shapes: straight (30%), arc with constant turn (40%), and S, where the turn sign flips at the midpoint (30%).
- Notes are judged as circles. Overlapping windows resolve through the press-resolution rule.
- `runIndex` and `runLength` come from `features.ts`, not from the pattern tag.

**Score, combo, accuracy, health.** This is Flickwise's own formula, which rewards landing near the center.
- `aimFactor = max(0, 1 − (radial/r)²)` and `comboFactor = 1 + min(comboBefore, 50)/100`.
- Circle or slider head: `round(100 × w(j) × (0.8 + 0.2·aimFactor) × comboFactor)`, with w from `JUDGMENTS` (1, 0.65, 0.3, 0).
- Slider tick or repeat: `10 × comboFactor`. Slider end: `30 × comboFactor`. A slider whose final judgment is Crisp adds `50 × comboFactor`.
- Spinner: `100 × w × comboFactor`, plus 25 per bonus rotation.
- Total: `round(Σ × modMultiplier(mods))`. Training modules don't show a score. They show the level and success share.
- Accuracy: `Σ w(final judgment) / judged objects`.
- Combo: +1 per circle, slider head, slider part and completed spinner. Any Miss or missed part resets it to 0. The combo-break effect plays only if the combo was 10 or more.
- **Health (Dynamic only):**
  - Starts at 1.
  - Gains: Crisp +0.025, Solid +0.015, Rough +0.005, slider part +0.01, spinner rotation +0.01.
  - `hpScale = 0.6 + 0.08·density`. Losses: miss `0.08·hpScale`, part `0.03·hpScale`, drain `0.02·hpScale` per second. Drain pauses during spinners and gaps of 2000 ms or more.
  - At 0 health the play fails, shows "Out of health" for 1200 ms, then calls `onFinish('failed')`.
  - No Fail sets `canFail: false`. One Life fails on any combo break.
  - Training modules set `health: null`.

---

## 6. Difficulty

- Users pick a **Level 1 to 8** preset (`LEVEL_PRESETS`), or open "Custom" with the 11 sliders in `DIFFICULTY_LIMITS` plus a length. Custom starts from the last used values, or Level 4.
- The setup screen shows the windows, the approach time and the map's per-skill demand from `previewLaunch`.

**Mapping in `map/difficulty.ts`.** Here r is the radius after Tight or Wide, and I is the section intensity.

| Param | Formula |
|---|---|
| radius, windows | `radius × MOD_SCALE`, `windowsForTiming(timing)` × MOD_SCALE windows (applied before generation so constraints use the final size) |
| beatMs | 60000 / bpm |
| vJump (u/ms) | 0.25 + 0.12·spacing |
| jump distance | `clamp(vJump·gap·(0.75 + 0.35·I)·accent, 2.2r, 620)`, accent 1.2 on a bar downbeat inside a jump chain; gaps over 1 beat use 1 beat |
| P(half-beat jumps) | `min(0.85, clamp(0.08·density − 0.02, 0.05, 0.8)·(0.6 + 0.6·I))` |
| rest at phrase end | P = 0.45 − 0.03·density |
| stream spacing | r·(0.6 + 0.07·spacing) |
| stream length | uniform int in [max(3, round(0.4·streamMaxLength)), streamMaxLength] |
| turn mix | pFlow = clamp(0.9 − 0.075·(complexity − 1), 0.2, 0.9); flow turns U[15°, 75°], same sign for 3 to 6 moves; sharp turns U[110°, 180°], alternating sign |
| pattern weights (c = complexity) | jump 3; backforth 0.6 + 0.25c; triangle c≥3 ? 0.25c : 0; square c≥4 ? 0.2c : 0; star c≥6 ? 0.12c : 0; flow max(0.6, 3 − 0.2c); stream 0.35·streams·(0.5 + I); burst 0.25·streams; doubles c≥5 ? 0.1c : 0; slider 0.35·sliders·(1.5 − I) |
| slider velocity | 0.5·vJump·(0.85 + 0.03c), constant for the whole map (keeps tracking anchors exact) |
| slider passes | span 2 beats with P = 0.6 − 0.04c, else 1 beat; repeats 0/1/2 with P 0.7/0.25/0.05; shapes line 0.3, arc 0.4, cubic 0.3; tickDistance = velocity·beatMs (×0.5 when bpm < 120); followRadius = 2r |
| spinners | P(at a section boundary) = 0.06·spinners, always at a break start when spinners ≥ 1, at most one per 30 s; duration clamp(k·4·beatMs, 1500, 4500), k ∈ {2, 3}; rpm 1.1·bpm |
| health | per section 5 |

---

## 7. Map generator (A)

**RNG.**
- `sfc32` seeded through `splitmix32(seed)`. `fork(label)` makes a child stream seeded by `hash32(seed, label)`, so changing one section never shifts the draws of another.
- `GENERATOR_VERSION = 1`. Bump it whenever output for the same seed changes.
- Round coordinates to 1/16 unit and times to 0.1 ms after placement.

**Everything is a turtle program.**
- A motif is a list of steps `{beat offset, kind, distance, signed turn}`, plus a slider spec where needed.
- Shapes are fixed turn sequences:
  - triangle ±120°
  - square ±90°
  - star ±144°
  - back-and-forth 180° ± 15°
  - flow: constant 15° to 45°
  - jump chain: from the turn mix
  - stream: small turns
- One placement engine turns every motif into positions, so every rule is enforced in one place.

**Pattern library** (rhythm in beats):

| Pattern | Rhythm |
|---|---|
| jump chain | 4 to 8 jumps at 1/1 or 1/2 |
| back-and-forth | 4 to 8; the anchor pair rotates 10° to 20° per pair |
| triangle | 6 or 9 at 1/2; rotates 0° or ±20° per loop |
| square | 4 or 8; 0° or 45° |
| star | 5 |
| flow curve | 6 to 12, spacing ramps ±10% |
| stream | n at 1/4 |
| burst | 3 to 5 at 1/4, then a jump on the next beat |
| doubles | pairs 1/4 apart, pairs 1/2 apart |
| slider | single |
| slider chain | slider, circle, slider at 1/1 with flow |
| spinner | section boundaries only |

**Sections and intensity.**
1. Section length is 32 beats, or 16 when the length is under 45 s. `K = max(1, round(totalBeats / sectionBeats))`.
2. Intensity template: `[0.55, 0.75, 0.9, 1.0, 0.4, 0.8, 0.95, 1.0, 0.6]`. Drop the 0.4 break when K < 5. Resample linearly to K, add ±0.04 jitter, and clamp to [0.3, 1].
3. **Section focus** comes from the weights times intensity. I < 0.45 means a break section: sliders, 1/1 singles at 0.6 spacing, and possibly a spinner at its start.
4. **Slot templates** use 4-beat slots, where ' marks a transformed copy and R is a rest, a long slider or a boundary spinner:
   - T1 `A A' B B' A'' C C' R`
   - T2 `A B A' B' C C' D R`
   - T3 (stream focus) `S A S' A' S'' B B' R`

   Half-length sections use the first four slots and R.
5. **Copies:**
   - `'` replays the turtle program with turns negated.
   - `''` mirrors the absolute positions about x = 500, if the connecting jump fits the spacing rules; otherwise it falls back to `'`.
   - The build slot before R scales distance by 1.1.

   This repetition with variation, together with patterns starting on downbeats, streams ending on a downbeat, constant spacing within a motif (±10%) and spacing changes only at motif boundaries, is what makes maps read as designed.
6. The first object goes within 100 units of the center. After a slider, the incoming direction is the end tangent.

**Placement** (`placement.ts`): `place(prevEnd, dirIn, distance, turn)`.
1. `θ0 = (dirIn ?? angle to center) + turn`.
2. Center pull: when `|prevEnd − center| > 350`, blend θ toward the center by `k = clamp((dist − 350)/150, 0, 0.5)`.
3. Up to 24 attempts:
   - Turn offsets 0, then ±15°, ±30° … ±90°, trying the same sign first.
   - Then distance × 0.9, 0.8 and 0.7.
   - Accept the first point that passes the rules.
4. On total failure, truncate the motif, add a one-beat rest, and restart from a point toward the center.

**Rules** (constraint tests check every one):
1. **Bounds:** centers within `[r+8, 1000−r−8] × [r+8, 625−r−8]`. Every flattened slider sample is held to the same bounds.
2. **Visible together** means the later object's appear time `t_j − A` is at or before `end_i + 100`. Non-consecutive objects that are visible together keep ≥ 2.1r between centers, and ≥ 2.1r from every sample of a slider path.
3. **Consecutive:** jumps ≥ 2.2r. Stream notes ≥ 0.6r, with no fold-back: note k vs k−j for j ≥ 2 keeps ≥ `min(2.1r, 0.8·j·s)`.
4. The object after a slider keeps ≥ 2.1r from every sample of that slider.
5. **Slider shape:**
   - Length within [2.4r, 600].
   - No self-intersection (sampled segments).
   - Arc sagitta ratio at most 0.6.
   - Arcs solve `chord = L/(1 + 8k²/3)`, and cubics bisect the chord four times to match length L.
6. **Spinners:**
   - The previous object ends at least `max(1 beat, 400 ms)` before.
   - The next object starts at least `max(2 beats, 600 ms)` after, within 250 units of the center.
   - None in the first 8 s or the last 5 s.
7. **Time:** gaps ≥ max(1/4 beat, 50 ms), and times strictly increase.
8. No intentional stacks in v1.

`index`, `group` (new at each motif) and `number` are assigned last. `features.ts` computes ObjectFeatures from the final PlayableMap.

**Speed budget:** a 300 s Level 8 map generates in under 50 ms on a desktop, because `previewLaunch` is synchronous.

---

## 8. Training modules (A)

Common rules:
- L is clamped to `LEVEL_LIMITS`, and `D_s(L) = rawDemandAt(s, L)`.
- There's a 1200 ms rest between sets. The next set's first object comes at the last judgment + 1200 + approach. During the rest the canvas shows the set-change text.
- Sets are generated when the previous set closes. The seed for set k is `hash32(seed, k, round(L·20))`.
- The engine stops adding sets once play time passes `lengthSec`.
- Health is null, and the allowed mods are Fade, Spotlight and Mirror.

| Module | Generator per level L | Success per set (target 70–85%) |
|---|---|---|
| jumps | r = 66 − 3.5(L−1) (min 16); approach max(400, 1100 − 50(L−1)); distance in widths: short U[1.5,3], long U[4.5,7], mixed picks short/medium U[2.5,4.5]/long; **gap solved from Fitts:** `gap = clamp(1000·log2(d/2r + 1)/D_aim(L), 120, 1500)`, recomputed from the placed distance, rounded to 5 ms; turns U[0,180]; directionFocus keeps at least 50% of moves within the octant ±30°; windows T=4 | hit (not miss) |
| angles | r = 60 − 3(L−1); d = 3.5 widths; gap = 1000·log2(4.5)/D_aim(L); turns: sharp U[120,180], wide U[0,60], mixed alternates blocks of 4 | hit |
| streams | r = 56; gap = 1000/D_speed(L); spacing 0.9r; lengths short 3–5, medium 6–12, long 13–24; between bursts max(350, 4·gap) ms and a 4-width jump; approach 900; T=5; set = bursts until 40 notes | share of notes Crisp or Solid |
| tracking | r = 56, follow 2r; velocity = D_tracking(L)·follow/1000; length U[4r, 9r]; repeats: focus "repeats" 1–2, else for L ≥ 3 0/1/2 at 0.6/0.3/0.1; shapes by focus; 450 ms between; ticks every 1.5r | trackedFraction ≥ 0.9 and head not missed |
| spinning | 3000 ms spinners, 1500 ms apart; rpm = D_spin(L) | rotations ≥ required |
| precision | r = clamp(1000/D_precision(L), 12, 80); distance U[1.5,3] widths; gap 650; approach 1000; T=4 | hit and radial ≤ 0.5r |
| reading | approach = clamp(1000/D_reading(L), 250, 1800); r = 50; gap 200 ms with 400 ms every 4th; distance U[2,4] widths | hit |
| timing | r = 64; distance U[1.2,2] widths; crisp = clamp(1000/D_timing(L), 8, 60), solid 2×, rough 3×, early rough + 60; 500 ms beat with subdivisions 1 / 1/2 / 3/4 / 1/4-double at 0.35/0.35/0.15/0.15 | Crisp |
| stamina | not adaptive; streams at `(levels.streams ?? 3) − 1` (20 notes) alternating with jumps at `(levels.jumps ?? 3) − 1` (8 jumps) | none; analytics reads the second-half drop |
| warmup | not adaptive; sets rotate jumps 10, streams 24, tracking 4, precision 8, each at level − 1.5 | none |
| mix | adaptive; sets cycle `mixModules`; one staircase per module | that module's rule |

**Staircase** (`staircase.ts`):
- Start at `max(1, (levels[m] ?? 3) − 0.5)` with step 0.5.
- After each set with success share `p`:
  - `p ≥ 0.86`: L += step.
  - `0.70 ≤ p < 0.86`: hold.
  - `0.45 ≤ p < 0.70`: L −= step.
  - `p < 0.45`: L −= 2·step.
- On a direction reversal, `step = max(0.25, step/2)`. Round L to 0.05.
- `finalLevel` is the mean L over the second half of the sets (at least 2 sets). With fewer than 4 sets, it's the last L.
- Mixed and varied practice is built in. Every set re-draws distances, angles and directions, and Mix and Warm-up interleave skills.

---

## 9. Mods

| Mod | Effect | Mult. | Scope |
|---|---|---|---|
| Fade | Opacity by approach progress u: fade in 0–0.25, full to 0.45, fade out to 0 by 0.75. No approach ring. Slider bodies fade the same way; the ball and follow ring stay visible. | 1.05 | all |
| Spotlight | A dark overlay (#05070a, alpha 0.94) with a soft hole around the cursor: `R = 260·√(r/52)`, clear to 70% of R, then a gradient. Lifts over 200 ms during spinners. No combo-based shrinking. | 1.10 | all |
| Fast / Slow | Rate 1.25 / 0.8 applied to the map (section 4). Windows unchanged. | 1.15 / 0.7 | Dynamic |
| Tight / Wide | Radius ×0.8 / ×1.25, windows ×0.75 / ×1.3, applied before generation | 1.10 / 0.6 | Dynamic |
| Mirror | x becomes 1000 − x for positions and path points | 1.0 | all |
| No Fail | `canFail: false` | 0.8 | Dynamic |
| One Life | `failOnFirstMiss: true` | 1.0 | Dynamic |

- Conflicting pairs: Fast and Slow, Tight and Wide, No Fail and One Life. The UI disables the other mod of a pair when one is picked.
- Multipliers multiply together.
- Personal bests are kept per mod set, so multipliers only affect the shown score.

---

## 10. Feedback (A)

**Visual.**
- **Palette:** background #0b0f14, field border #1f2937. Target rings cycle sky #7dd3fc, pink #f9a8d4, sand #fde68a and white #e5e7eb by group. The body is #1e293b at 85%, with a 3-unit ring, a 4-unit center dot and the number.
- **Hit bursts:**
  - Crisp: a ring from r to 1.7r over 200 ms, plus 6 sparks from 1.2r to 2.2r over 240 ms.
  - Solid: a ring to 1.45r.
  - Rough: a ring to 1.25r at 60% alpha.
  - The body scales to 1.15× and fades over 120 ms.
  - Reduce motion turns off the sparks.
- **Pop-ups:**
  - The label rises 14 units over 450 ms. Crisp is hidden unless `crispPopups` is on.
  - With `earlyLate`, Solid and Rough show "early 23 ms" or "late 31 ms" underneath.
- **Miss:** a red X (0.55r) for 500 ms, a red flash on the target outline, and a 120 ms edge vignette at alpha 0.12 (off with reduce motion).
- **HUD layout** (Flickwise's own): the top band has the score on the left, the combo large in the center with accuracy below it, and on the right a time progress ring plus the level for modules. Health is a thin bar under the top band, Dynamic only.
- **Combo:** bumps to 1.12× over 90 ms on each increment, and glows at 50 and every 100. On a break it turns red, shakes ±5 px for 220 ms (HUD text only), shows "−37" fading below, then shows 0.
- **Error bar:**
  - 360 px, centered in the bottom band, spanning ±rough with shaded Crisp, Solid and Rough zones.
  - A 2×14 px tick per hit, fading over 4 s (64-tick ring).
  - An EWMA marker (α 0.12), and "early" and "late" labels at the ends.
- **Slider:**
  - The cached body is a 2r stroke with an outline in the group colour.
  - While tracking, a solid follow ring at followRadius pulses to 1.06× on each tick. When tracking is lost, the ring hides and the ball dims to 60%.
  - Tick dots (0.14r) pop when collected and turn red when missed. Reversals show a chevron.
- **Spinner:**
  - A 10-unit ring at radius 240, with a clockwise fill of `min(1, q)` that turns the Crisp colour at 100%.
  - A thin outer arc shows the time left, with the RPM in the center and "+1" pop-ups for bonus rotations.
  - On the first spinner of a play, the hint "Hold a key or button and circle the center" appears.
- **Path hints:** a dashed line (6 on, 8 off, 2 units, alpha 0.35) between consecutive edges, from u = 0.3 until the earlier object is judged.
- **Set change:** "Level 4.5" with "Up from 4.0", "Down from 5.0" or "Holding at 4.5".
- **Cursor when drawn:** a 6-unit dot inside a 14-unit ring, ×cursorScale. The trail covers the last 80 ms of samples.
- Every string goes in `render/strings.ts`.

**Audio.**
- Graph: `new AudioContext({ latencyHint: 'interactive' })`, created on the first gesture. Voices feed the category gains (hits, effects, ambient), then master, then a compressor (−10 dB threshold, knee 6, ratio 3, attack 2 ms, release 80 ms), then the destination.
- Gains are the slider value squared. Mute sets master to 0.
- Sounds start at `ctx.currentTime` inside the input handler.
- One 1 s white-noise buffer is made at init.
- Helpers:
  - `blip(type, f0, f1, attack, decay, gain)`: an oscillator with an exponential frequency ramp, a 1 ms attack, and an exponential decay to 0.0001.
  - `noise(filter, freq, Q, dur, gain)`.
- At most 24 live voices, each disconnected `onended`.

| Sound | Build |
|---|---|
| Crisp | sine 1240→930 Hz, 70 ms, gain 0.35, plus bandpass noise at 5 kHz (Q 1.5), 6 ms, 0.12; pitch × 2^(2·min(floor(combo/25), 4)/12) |
| Solid | sine 990→740, 60 ms, 0.3, plus noise at 3.5 kHz, 6 ms, 0.1 |
| Rough | triangle 620→470, 55 ms, 0.28, plus noise at 2 kHz, 8 ms, 0.1 |
| Miss | sine 190→80, 140 ms, 0.4, plus lowpass noise at 500 Hz, 70 ms, 0.2 |
| Combo break (≥ 10) | triangles at 520 and 523 Hz gliding to 260 over 280 ms, 0.25, through a lowpass sweeping 3 kHz→600 Hz |
| Milestone (50, every 100) | sines at 880, 1109 and 1319 Hz, 45 ms apart, 120 ms each, 0.18 |
| Slider tick / missed tick | sine 1760 Hz, 25 ms, 0.12 / lowpass noise at 800 Hz, 30 ms, 0.12 |
| Repeat / slider end | sine 1480→1660, 30 ms, 0.15 / sines at 990 and 1485 Hz, 90 ms, 0.18 |
| Tracking hum (ambient) | bandpass noise at 700 Hz (Q 0.8), gain 0.05 while tracking; cut with τ 0.02 s on loss, restored with τ 0.05; filter 600→1000 Hz with ball speed |
| Spinner hum (ambient) | sawtooth at `90 + 0.8·rpm` Hz, lowpass `400 + 6·rpm` (Q 4), gain 0.07 above 20 rpm (τ 0.05–0.08); chime at 100% (1319 and 1976 Hz, 200 ms); bonus rotation sine 2093 Hz, 30 ms, 0.1 |
| Countdown | sine 660, 660, then 990 Hz, 70 ms, 0.2 |
| Set result | up 660 then 990; down 660 then 495; hold 660 alone |
| Fail | triangles stepping 440, 330, 262 at 150 ms steps |
| Stray press | off in v1 |

---

## 11. Analytics (B)

**Per-object data** is the contract's `HitRecord`. Aim errors are normalized by the record's radius ("radii"). The UI shows them as % of a target's width, which is radii × 50. Records with `afterPause` are excluded. Aim decomposition uses only records with a direction.

**Classes:**
- **Taps** are circles and slider heads.
- A **stream note** has `runLength ≥ 3` and spacing under 1.6.
- A **jump** is a tap that isn't a stream note, has a non-null distance and a gap under 700 ms.
- Taps with gaps of 700 ms or more are **isolated**.

**Buckets** (`buckets.ts`). Bins are computed at analysis time, so changing them needs no migration.

| Family | Bins |
|---|---|
| distance (widths) | stack <1, short 1–2.5, medium 2.5–4.5, long 4.5–7, far ≥7 |
| gap (ms) | <110, 110–160, 160–250, 250–400, 400–700, ≥700 |
| velocity (u/ms) | <0.4, 0.4–0.9, 0.9–1.5, ≥1.5 |
| turn | straight <45, wide 45–100, sharp 100–150, reversal ≥150 |
| direction | octant = floor(((dir + 22.5) mod 360)/45), from 0 right to 7 up and right |
| motion | stream, jump, isolated |

Per-bucket metrics: n, misses, missRate, timingMean and timingSd (presses only), alongMean/Sd, lateralMean/Sd (includes aim-misses that have a press), and radialMean. Bucket keys look like `dg:long:g3`, `turn:sharp`, `dir:4`, `vel:2`, `motion:stream`.

**PlaySummary** (B's stored type, made by `summarizePlay(result)` at save):
- Identity and context: `id` (`crypto.randomUUID()`), `v: 1`, `deviceId`, `createdAt`, `launch` and `modeId`.
- Play facts: status, start and end times, `playedMs`, engine and generator versions, seed, mods, `presetLevel`, score, accuracy, maxCombo, counts, objectCount, strayPresses, pauses.
- Timing: `{n, mean, sd, median}`. Aim: `{n, alongMean, alongSd, lateralMean, lateralSd, radialMean}`.
- Per kind:
  - circle: n, accuracy, misses, timing mean and sd, radial.
  - slider: n, accuracy, head timing sd, trackedFraction mean, lag mean, breaks per slider, endHit rate.
  - spinner: n, accuracy, mean rpm, peak rpm, rpmSd.
- Progress through the play: `halves {first, second}` accuracy and `quarters[4]`.
- Buckets: sparse, families above, about 40 entries.
- Skills: per skill `{raw, level, performance, score, n}`.
- Also `levels`, `finalLevels`, `input`, `drillId`, and `pb` flags.

**Demand and skill scores per play** (`demand.ts`, `ratings.ts`):
- Raw demand per object uses the catalog formulas. Map demand per skill is the 75th percentile over its subset:
  - aim: jumps
  - speed: stream notes
  - tracking: sliders
  - precision, timing, reading: all taps
  - spin: spinners
- Minimum n per play: aim 15, speed 20, tracking 5, precision 30, timing 30, reading 30, spin 2.
- **Performance P (0..1):**
  - aim: `hitRate × (1 − 0.5·min(1, meanRadial))`, where a miss with no press counts as radial 1.
  - speed: mean judgment weight.
  - tracking: `mean(trackedFraction × (head hit ? 1 : 0.5))`.
  - precision: `mean(hit ? max(0, 1 − radial²) : 0)`.
  - timing: Crisp share.
  - reading: hit rate.
  - spin: `mean(min(1, rotations/required))`.
- `score_s = levelForDemand(s, demand) × P²`, in level units.

**Ratings:**
- `rating_s = Σ 0.85^i·score_i / Σ 0.85^i` over the best 20 play scores in the last 60 days.
- It's provisional below 5 plays.
- `tier = floor(rating)`. The first time each tier is reached is stored in meta and shown on Results as "Aim reached tier 4". Never use "unlock" in copy, because writing.md bans it.

**Trends** (`trends.ts`):
- A day's value is the n-weighted mean over that day's plays.
- Smoothing is an EWMA over play-days with `α = 1 − 2^(−Δdays/7)`.
- Change statements compare the last 14 days with the 14 before, using Welch's t from aggregated n, mean and sd. Show them only when |t| ≥ 2 and each window has at least 3 plays.
- Metrics: accuracy, timing spread (sd), mean offset, radial error, along bias, each skill rating, plays and minutes per day.
- Ranges: 7, 30 and 90 days, and all.
- Sessions are plays separated by less than 30 minutes.

**Insights** (`insights.ts`):
- The window is plays from the last 30 days, capped at the latest 3000 taps, with at least 3 plays.
- A mean effect also needs `|mean| ≥ 2·sd/√n`. A rate difference needs a two-proportion z ≥ 2.
- `severity = (effect/threshold) × min(1, n/(3·minN))`.
- Overview shows the top 3 and Home the top 1, at most one variant per rule. Each insight shows its n ("Based on 214 jumps from the last 30 days.").
- Results shows per-play notes for R1, R5 and R8 at half the minimum n.

| id | Filter and condition (min n) | Wording | Recommends |
|---|---|---|---|
| R1 long-undershoot | jumps with spacing ≥ 4.5 and velocity ≥ 0.9; alongMean ≤ −0.25 (40) | "You stop short on long, fast jumps. Your clicks land about {pct}% of a target's width before the center." | jumps, long |
| R2 long-overshoot | same; ≥ +0.25 | "You overshoot long, fast jumps. Your clicks land about {pct}% of a target's width past the center." | jumps, long |
| R3 short-overshoot | spacing 1–2.5; ≥ +0.25 (40) | "You overshoot short jumps by about {pct}% of a target's width." | jumps, short |
| R4 direction-drift | per octant: \|lateralMean\| ≥ 0.25 or lateralSd ≥ 1.3× overall (40 in the octant) | "When you move {direction}, your clicks land about {pct}% of a target's width to the {side} of the line." | jumps, that octant |
| R5 stream-late / early | stream notes with gap <140; \|mean\| ≥ 12 ms (60) | "You're late on fast streams by about {ms} ms on average." / "You rush fast streams, about {ms} ms early on average." | streams, short |
| R6 stream-fade | runIndex ≥ 9 vs ≤ 4; sd ratio ≥ 1.35 (40 each) | "Your timing gets looser after the first eight taps of a stream ({a} ms spread against {b} ms)." | streams, long |
| R7 second-half | plays ≥ 60 s: mean(first − second) ≥ 3 points and positive in ≥ 70% (5 plays) | "Your accuracy drops by about {pp} points in the second half of a play." | stamina |
| R8 sharp / wide | spacing ≥ 2.5: missRate(turn ≥ 100) vs (<100), diff ≥ 0.06 (50 each) | "You miss more on sharp back-and-forth jumps than on wide, flowing ones ({a}% against {b}%)." (or reversed) | angles, sharp or wide |
| R9 slider-lag | sliders; lag ≤ −0.3 (20) | "You trail behind slider balls by about {pct}% of a target's width." | tracking, mixed |
| R10 slider-curves | trackedFraction curve − straight ≤ −0.08 (15 each) | "You lose more sliders on curves than on straight paths ({a}% kept against {b}%)." | tracking, curves |
| R11 early-release | endHit ≤ 0.85 while the tick rate is ≥ 0.95 (20) | "You often let go of sliders just before they end." | tracking, repeats |
| R12 timing-bias | all taps; \|mean\| ≥ 10 ms, \|t\| ≥ 3 (200) | "You click about {ms} ms {early or late} on average." | timing |
| R13 busy-screen | visibleCount ≥ 4 vs ≤ 2, diff ≥ 0.06 (50 each) | "You miss more when four or more targets are on screen ({a}% against {b}%)." | reading |
| R14 off-center | hitRate ≥ 0.95 and radialMean ≥ 0.55 (150) | "You hit almost every target, but most clicks land well away from the center." | precision |
| R15 spinners | Crisp share ≤ 0.7 (6) | "You finish only {pct}% of spinners in time." | spinning |
| R16 same-module | the last 4 module plays are the same module | "You've played {module} four times in a row. Try another module next, then come back to it." | next-ranked insight's module |
| R17 long-session | at least 25 minutes in one session and the last 3 plays at least 3 points below the session mean | "Your accuracy has dropped over your last three plays. A break might help before you go on." | none |

Every recommendation is a full LaunchRequest with the module and options, `levels` from progress and 90 s. The setup screen opens prefilled with "Start drill".

**"Did drilling help"** (`drillEval.ts`, `drills` store):
- "Train this" creates `Drill {id, ruleId, bucket filter, moduleId, options, createdAt, baseline: {mean, sd, n} or {rate, n}, status}`, and the drill's plays carry `drillId`.
- The **after** data is the rule's bucket filtered to records from plays outside the drill (Dynamic and other modules), starting at the drill's first session. Measuring away from the drill shows whether the skill carries over, not just whether the drill itself got easier.
- Evaluation needs at least 3 drill sessions and the rule's minimum n of after-data. It uses Welch's t for means and the two-proportion z for rates.
  - **better:** the change goes the right way with |stat| ≥ 1.96 and at least 25% of the rule threshold.
  - **worse:** a significant change the wrong way.
  - **no clear change:** anything else.
- It re-evaluates after every play and locks after 30 days or when archived.
- Wording:
  - "Since you started this drill on {date}, {metric} went from {before} to {after}. That's based on {n1} jumps before and {n2} after."
  - "No clear change in {metric} yet. {n2} jumps measured since {date}."
  - "{Metric} is worse than before this drill ({before} then, {after} now)."
  - While collecting: "Play {k} more sessions outside the drill to measure it."
- Overview lists finished drills by outcome, which shows the player what has worked for them.

**Dashboard** (`/stats`, each tab with a one-line intro):
- **Overview:** the seven skill ratings with tiers, the top 3 insights with "Train this", active drills with status, and this week against last week (plays, minutes, accuracy).
- **Trends:** a metric picker with line charts (daily dots plus the EWMA line), range buttons and a change sentence.
- **Patterns:** a heat grid of distance rows × gap columns. The metric toggles between miss rate, along bias, lateral spread and timing bias, using a diverging scale for biases. Cells under 20 are greyed and show their n. Also an angle × distance grid and an 8-sector direction rose.
- **Timing:** a histogram in 5 ms bins from −150 to 150, with circle, slider head and stream note overlays, mean and sd markers, and shaded windows.
- **Bests:**
  - Dynamic: best score, accuracy and max combo per (preset or custom) × mod set.
  - Modules: best final level.
  - Only completed plays count, and only the latest engine version is compared.
- **History:** sessions with their plays, filters by mode, and delete (with a tombstone).
- **Play detail:**
  - The summary numbers and a timeline of timing errors per object (coloured by judgment, misses as red ticks).
  - Accuracy by quarter and an aim scatter in the movement frame (x along, y lateral, target circle drawn).
  - Per-kind stats, slider tracked fraction per slider, spinner RPM and level steps.
  - "Play this map again", which reuses the same launch and seed.

**Charts:** own SVG components (LineChart, Histogram, HeatGrid, Rose, AimScatter, Bars) sharing `scale.ts`.

---

## 12. Storage (B)

**Database** `flickwise`, `DB_VERSION = 1`:

| Store | Key | Indexes | Holds |
|---|---|---|---|
| meta | `key` | none | deviceId, createdAt, tier history, persist status, last export, remembered UI choices |
| settings | `key` (`'settings'`) | none | Settings |
| plays | `id` | `startedAt`, `modeId`, `mode_startedAt` [modeId, startedAt], `drillId` | PlaySummary (~3 KB) |
| playDetails | `playId` | `startedAt` | `{playId, v, startedAt, objects, sliders, spinners}` as columns |
| progress | `moduleId` | none | `{moduleId, level, bestLevel, sessions, updatedAt}`, updated only from plays whose mods ⊆ {mirror} |
| drills | `id` | `createdAt`, `status` | Drill |
| tombstones | `id` | none | `{id, deletedAt}` for future sync |

**Detail columns** (`columns.ts`). Each column is a typed array. Enums are stored as indexes into append-only arrays kept in that file. Null becomes NaN for floats and 255 for small ints.
- `objects` (one per record, about 100 B):
  - Small ints: index U16, kind U8, pattern U8, set I16, judgment U8, headJudgment U8, missReason U8, input U8, comboBefore U16, afterPause U8.
  - Positions and targets: time, endTime, x, y, radius, approachMs, crispMs as F32.
  - Press and aim: timingError, hitX, hitY, along, lateral, radial as F32.
  - Features: distance, gapMs, velocity, spacing, turnAngle, direction, progress as F32; runIndex U16, runLength U16, visibleCount U8.
  - Movement: arriveMs, efficiency, peakSpeed as F32; corrections U8.
- `sliders`: one row per slider, about 42 B.
- `spinners`: one row per spinner, about 30 B.
- Readers ignore unknown columns and fill missing ones with NaN, which makes it tolerant of later changes.

**Size and retention.**
- About 3 KB of summary plus 20 to 27 KB of detail per 90 s play (around 200 objects). Ten plays a day is about 85 MB a year.
- `retention.ts` deletes `playDetails` older than `detailRetentionDays` (default 365) at idle after start-up. Summaries stay, so trends, ratings and bests survive.
- Call `navigator.storage.persist()` after the first saved play. Show the result and `navigator.storage.estimate()` under Settings, Data.

**Migrations.**
- `db.ts` holds `MIGRATIONS[v](db, tx)`. `onupgradeneeded` runs the steps from `oldVersion + 1` to `DB_VERSION`.
- Records carry `v`. Readers and import both lift old shapes through `upgradeSummary` and `upgradeDetail`.
- On `onversionchange`, close the DB and show "Flickwise was updated in another tab. Reload to continue."

**Export and import** (`exportImport.ts`):
```
{ format: "flickwise-export", formatVersion: 1, exportedAt, app: { engineVersion, generatorVersion },
  deviceId, settings, progress[], drills[], meta: { tiers }, tombstones[],
  plays: [ { summary, detail: { objects: { count, columns: { name: number[] } }, sliders, spinners } | null } ] }
```
- Floats are rounded to 2 decimals.
- The file is `.json`, with an optional `.json.gz` via `CompressionStream`. Import detects gzip by its `1f 8b` header.
- Import validates `format` and `formatVersion`, migrates, merges by id (existing ids are skipped), applies tombstones, and reports counts.

**Sync seam.** `sync.ts` exports only `interface SyncAdapter { push(summaries, details): Promise<void>; pull(sinceCursor: string | null): Promise<...> }`. Plays are immutable, and every record has a UUID, `deviceId` and `createdAt`, so D1 can later sync append-only plus tombstones.

---

## 13. Testing (Vitest, node environment)

**A** (in `src/game`):
- **rng:** same seed gives the same sequence; forks are independent.
- **path:** line length; arc through 3 known points (radius and center); cubic length against 10k-sample brute force (±0.5%); `pointAt` is monotonic.
- **generator:**
  - Each of 8 presets × 50 seeds plus 3 custom extremes generates deterministically (deep-equal on regeneration), and different seeds differ.
  - The constraint suite checks every rule in section 7.
  - Slider `length` matches the flattening within 0.5%, and `spanMs × velocity = length`.
  - Object counts per minute fall within ±25% of `expected(density, bpm)`.
  - "Designed" checks:
    - At complexity ≤ 2, at least 70% of turns are under 100°. At complexity ≥ 8, at least 30% are 100° or more.
    - The coefficient of variation of spacing within each motif is ≤ 0.1.
    - Each full section contains at least one transformed copy.
  - A 300 s Level 8 map generates in under 200 ms in the test (the target is 50 ms).
- **judge:** inclusive window boundaries, early miss, ignored very-early presses, the radius edge, resolution order (absorbed, skipped), and aim-miss attribution.
- **slider:** tick and repeat counts; tracking hysteresis at 1r and 2r; end-check time; final composition; combo increments.
- **spinner:** synthetic 300 rpm for 2 s gives 10 ± 0.05 rotations; a wiggle gives about 0; the dead zone and the 600 rpm cap hold.
- **scoring:** worked examples, accuracy, combo reset, health drain and fail, No Fail and One Life, `modMultiplier`, and `modConflicts`.
- **mods:** Fast divides times and approach by 1.25; Mirror flips path points; Tight changes radius and windows.
- **features:** overshoot gives positive along, right-of-movement gives positive lateral (with y pointing down), turn 0 vs 180, `runIndex`, `visibleCount`.
- **staircase:** a simulated logistic player with threshold T converges to a level where p is within 0.70–0.86, ±0.5 level; step halving works.
- **module calibration:** for each module at L ∈ {2, 5, 8}, the measured map demand comes within ±10% of `rawDemandAt`.
- **autoplay** (`sim/autoplay.ts` uses minimum-jerk movement `p0 + Δ(10τ³ − 15τ⁴ + 6τ⁵)`, 1 ms samples, arriving 30 ms early):
  - A perfect player on 30 maps across modes gets 100% Crisp, no misses, all slider parts and every spinner cleared.
  - A noisy player (σt 15 ms, σaim 0.25r) lands in the expected accuracy band.
  - Record count equals judged objects.
  - A weak model (undershoot 0.4r on spacing ≥ 4.5) shows a negative mean along on those records.
- `boundary.test.ts`: nothing in `src/game` imports from `src/app`, `src/data` or `src/analytics`.

**B** (in `src/data`, `src/analytics`, `src/app`):
- **stats:** mean, sd, quantile, EWMA, Welch from aggregates, two-proportion z, regression.
- **buckets:** bin edges.
- **summarizePlay:** on fixtures from `analytics/fixtures.ts` (B's own record builder with chosen biases).
- **ratings:** anchor interpolation and inversion, top-20 weighting, provisional rule, tier events.
- **insights:** each rule fires on planted data, stays silent below min n and below threshold, renders its wording with numbers, and returns the right LaunchRequest.
- **drillEval:** before and after sets that should come out better, no change and worse.
- **storage** with `import 'fake-indexeddb/auto'`:
  - Fresh open and migrate.
  - A save and load round trip that keeps typed arrays (verify this first).
  - Index queries by mode and time; retention keeps summaries.
  - Export into a fresh DB and import back to equality; duplicate ids are skipped; bad format is rejected; gzip round trip.
- `copy.test.ts`:
  - Scans `catalog.ts`, `analytics/insightCopy.ts`, `app/**/*.tsx`, `app/copy.ts` and `game/render/strings.ts`.
  - Fails on an em dash, emoji, `→`, or a word from writing.md's banned lists inside string literals.
- `boundary.test.ts`: B code imports from `src/game` only through `src/game/index`.

**Integration** (step 3):
- `pipeline.test.ts`:
  1. A Dynamic Level 4 map runs headless with the weak model for 5 plays.
  2. Then `summarizePlay`, a save to fake-indexeddb, and insights.
  3. Expect R1 at the top.
- `calibrate.test.ts`, with `describe.skipIf(!process.env.CALIBRATE)`:
  - Prints the median raw demand per preset and skill over 20 seeds.
  - The main session pastes the aim row into `DEMAND_ANCHORS`.
  - It also asserts that the other rows match within 3%.

---

## 14. Work split

**Main session owns** everything in step 1 and `src/shared/*`. The stubs in `src/game/index.ts`, `src/app/App.tsx` and `src/index.css` pass to their builder once written.

**Boundary:**
- B calls `createGame`, `previewLaunch` and `playTestSound` from `src/game/index.ts`.
- A calls back through `GameCallbacks`, with `onFinish(PlayResult)` carrying everything.
- Both import only `src/shared/*` across the line, and the boundary tests enforce this.

Stub for `src/game/index.ts`:
```ts
import type { CreateGame, PreviewLaunch, PlayTestSound } from '../shared/types';
export const ENGINE_VERSION = 1;
export const GENERATOR_VERSION = 1;
export const createGame: CreateGame = () => { throw new Error('createGame is not built yet'); };
export const previewLaunch: PreviewLaunch = () => { throw new Error('previewLaunch is not built yet'); };
export const playTestSound: PlayTestSound = () => {};
```

**Writing rules block** (paste into both briefs):
> Text players read (UI labels, canvas text, insights, README) follows `C:\Users\Nuja\Documents\GitHub\reference\writing.md`.
> - Write plain sentences, the way you'd explain it to a friend.
> - No colons joining sentences. A colon is fine before a list or after a short label.
> - No compressed or inverted phrasing, no slogans, and no "not X, but Y".
> - No lists of three where one or two would do, and no sentences stacked with semicolons.
> - No fragments for effect, no rhetorical questions, and no "Here's how" or "In short".
> - No filler words (simply, just, really, actually, truly).
> - No marketing words (seamless, robust, powerful, effortless, elevate, empower, unlock, unleash, leverage, delve, harness, streamline, cutting-edge, game-changer, supercharge, journey, testament, crucial, vital, pivotal, comprehensive, intuitive).
> - No em dashes as pauses, no arrows in sentences, no emoji.
> - Keep every number true. Page intros are one line.
> - Game terms (combo, stream, slider, spinner) are fine.
> - Originality: this is not osu!. Use Flickwise names only. Judgments are Crisp, Solid, Rough and Miss. Mods are Fade, Spotlight, Fast, Slow, Tight, Wide, Mirror, No Fail and One Life. Never write "Hidden", "Hard Rock", "Double Time", "300" or "beatmap". Use no osu! assets or layout.
> - No personal details anywhere in the repo.

**Brief for Builder A (game engine):**
> Build the Flickwise game in `src/game/**`. You own only that folder.
> - Read-only: `src/shared/types.ts`, `src/shared/catalog.ts`, `docs/PLAN.md`.
> - Don't edit root files, `src/shared`, `src/app`, `src/data` or `src/analytics`. Add no dependencies.
>
> Specs: PLAN sections 4 (engine), 5 (mechanics), 6 (difficulty mapping), 7 (generator), 8 (modules), 9 (mods), 10 (feedback), and your half of 13.
>
> Public API: replace the stub in `src/game/index.ts`, keeping its exports and signatures (`CreateGame`, `PreviewLaunch`, `PlayTestSound`, `ENGINE_VERSION`, `GENERATOR_VERSION`). Semantics:
> - `createGame` draws "Click or press {key1} to start". The first input starts the clock, resumes audio and locks the pointer in raw mode.
> - Esc and pointer-lock loss pause and call `onPause(true)`. `resume()` comes from B's button click.
> - `onFinish` fires exactly once. `destroy()` cleans up without firing it.
> - `previewLaunch` is synchronous and fast.
>
> Code rules:
> - `rules/`, `map/`, `modes/` and `sim/` are pure TypeScript with no DOM, so they run in Node tests. `engine/session.ts` stays headless.
> - Only `engine/game.ts`, `engine/input.ts`, `engine/loop.ts`, `engine/playfield.ts`, `render/*` and `audio/*` touch the browser.
> - Never allocate per frame in hot paths. Never move the playfield for an effect.
> - All canvas text lives in `render/strings.ts` and follows the writing rules below.
> - Use `import type` (verbatimModuleSyntax).
>
> Order:
> 1. rng and path.
> 2. judge, slider, spinner and scoring.
> 3. difficulty, placement, patterns, generator, features and mods.
> 4. session, records, autoplay and headless.
> 5. staircase, modules and runner.
> 6. clock, input, cursor, playfield, loop, render, audio, and the dev harness at `/dev.html`.
> 7. index.ts.
>
> Each step's tests go green before the next step starts.
>
> Done when:
> - `npx tsc -b` and `npx vitest run src/game` pass.
> - On `/dev.html` you've checked:
>   - Smooth play at 60 Hz and at a high refresh rate, with showFps on.
>   - Absolute and raw input, Z/X, and chorded mouse buttons (hold left, press right).
>   - A pen if one is available.
>   - Pause and resume, a tab switch, and a re-lock after Esc.
>   - Immediate sounds, volume and mute.
>   - Fade, Spotlight, Mirror and Fast.
>   - Resizing, and moving between monitors with different DPR.
>   - A logged PlayResult that matches the contract.
>
> Report the files you added, the test count, anything in the plan you changed and why, and anything you couldn't check.
> [writing rules block]

**Brief for Builder B (app, data, analytics):**
> Build the Flickwise app in `src/app/**`, `src/data/**`, `src/analytics/**`, `src/index.css`, `public/**` and `README.md`. You own only those.
> - Read-only: `src/shared/*` and `docs/PLAN.md`.
> - From `src/game` import only `src/game/index` (`createGame`, `previewLaunch`, `playTestSound`). It's a stub until builder A finishes, so build the play flow against `src/app/play/fakeGame.ts`. In dev builds only, `?fake=1` returns a PlayResult made from your fixtures after 3 s.
> - Don't edit root files. Allowed dependencies: react, react-dom, react-router and Tailwind. Charts are your own SVG.
>
> Specs: PLAN sections 11 (analytics), 12 (storage), your half of 13, and the screens below.
>
> Screens (React Router):
> - `/`: Home. One-line intro, Play, Train, the top insight with "Train this", the last play, and mini ratings.
> - `/play`: Dynamic setup. Level 1–8 buttons with descriptions, Custom sliders from `DIFFICULTY_LIMITS` with help text, a target-size preview circle, the mod picker with conflicts and multiplier, length, seed (new each time, "Replay seed" on results), demand bars from `previewLaunch`, and an optional full screen.
> - `/train` and `/train/:mode`: module cards with the current level, then setup with options, allowed mods and length.
> - `/session`: PlayScreen.
>   - A full-viewport canvas. Call `createGame` in an effect and `destroy` on unmount.
>   - The pause overlay has Resume (calls `handle.resume()` inside the click handler), Restart (remount with the same launch) and Quit.
>   - `onFinish` then `savePlay`, then navigate to `/results/:id`. Quit plays with under 20 judged objects aren't saved.
>   - No React state updates while playing.
> - `/results/:id`: score or level steps, accuracy, combo, counts, timing mean and spread, aim along and lateral, per-kind stats, a small histogram and aim scatter, per-play notes, PB and tier badges, then Retry, New map and Back.
> - `/stats/*`: Overview, Trends, Patterns, Timing, Bests, History, and `/stats/play/:id`.
> - `/settings`:
>   - Input: raw toggle, sensitivity, key rebinding by `event.code` (not Esc, not both the same), mouse buttons, cursor, scale and trail.
>   - Audio: master, mute, three sub-volumes and test buttons.
>   - Display toggles.
>   - Data: export, import, storage used, persisted status, retention, delete all.
>   - Show the last play's detected pointer and display rates.
>
> Theme: dark tokens in `index.css` via Tailwind `@theme` (bg #0b0f14, surface #111827, line #1f2937, ink #e5e7eb, ink-2 #9ca3af, accent #7dd3fc, judgment colours from `JUDGMENTS`). Use the system font with tabular numbers. Menus must work by keyboard.
>
> Progress: after each saved play with mods ⊆ {mirror}, set `progress[m].level = finalLevels[m]`. Launches pass `levels` from progress.
>
> Order:
> 1. data (db, columns, plays, settings, progress, drills, meta, retention, exportImport, sync interface) with fake-indexeddb tests.
> 2. analytics (stats, buckets, summary, demand, ratings, trends).
> 3. insights, copy, drillEval.
> 4. shell, components, Settings, Home.
> 5. setup, PlayScreen, Results.
> 6. stats pages and charts.
> 7. README (what it is, modes, how analytics work, local data and export, controls, browser notes, dev and deploy commands, no personal details), favicon, copy and boundary tests.
>
> Done when `npx tsc -b` and `npx vitest run src/data src/analytics src/app` pass, and the full flow works with `?fake=1`.
>
> Report the files you added, the test count, anything in the plan you changed and why, and anything you couldn't check.
> [writing rules block]

---

## 15. Scope

**v1:**
- Everything above: Dynamic plus 11 modules and Mix, all 9 mods, full feedback and audio.
- Analytics with 17 insight rules, drills with before/after, seven ratings and tiers, the dashboard.
- IndexedDB with export and import, and the deploy.

**Deferred:**
- Cursor-trace storage and a replay viewer (adding a store later is an easy migration).
- A visual autoplay demo.
- D1 sync and accounts.
- Shareable seed codes.
- A timing offset setting.
- An offline service worker and PWA.
- Colour-blind palettes.
- Touch-device tuning.
- Stacked-note patterns.
- A stamina skill rating.
- Leaderboards.
- Localization.

---

## Risks

1. **Data formats are costly to change.** This covers:
   - HitRecord meaning and signs (along + is overshoot, lateral + is right of movement, turn 0 is straight), units and the 1000 × 625 playfield.
   - Id strings.
   - Column encodings and enum orders.
   - The export format and `GENERATOR_VERSION`.

   Freeze them before the first deploy, and add rather than rename. Labels can change any time.
2. **IndexedDB is per origin.** Moving from workers.dev to a custom domain later strands local data unless players export and import. See decision 1.
3. **Same seed across browsers.** Trig functions can differ between JS engines, so a seed may give slightly different maps on different browsers. Records store positions, so analytics and play detail never depend on regenerating a map. Don't promise cross-browser identical seeds.
4. **Input support differs by browser.**
   - Safari has no `pointerrawupdate`.
   - Firefox has no `desynchronized` canvas.
   - `unadjustedMovement` needs Chrome 88, Firefox 152 or Safari 18.4.
   - Each has a fallback in the plan. The chorded-button bitmask handling must be right, or right-click presses get lost.
5. **SPA fallback serves `index.html` for missing chunks after a redeploy**, which breaks lazy imports in stale tabs. Handle `vite:preloadError` by reloading once.
6. **The aim demand anchors and insight thresholds are first guesses.** Step 3 calibrates aim. The insight thresholds should be checked against your own plays after a week.
7. **Frame time at 240 Hz** depends on caching slider bodies and avoiding allocations. Test it in the harness with showFps.
8. **Storage eviction** if `persist()` is refused. Show this under Settings, Data and remind the player to export.

## Decisions for you

1. **Final address before players have data.**
   - Options: keep flickwise.ajshaham.workers.dev for good, add a custom domain now, or use workers.dev now and move later through export and import.
   - Recommendation: keep workers.dev unless a domain is already planned. In that case set the domain up before sharing the link.
2. **Repo visibility and licence.**
   - Options: private, public with MIT (like your other public repos), or public with no licence.
   - Recommendation: private until v1 is deployed and working, then public with MIT after the public-repo checklist.
3. **Detail retention default.**
   - Options: 365 days, forever, or 90 days.
   - Recommendation: 365 days. Summaries are kept forever either way, so trends and bests never lose history.
4. **Tier display.**
   - Options: numbered ("Tier 4") or named tiers.
   - Recommendation: numbered. It matches the Level 1–8 presets and needs no theme copy.
