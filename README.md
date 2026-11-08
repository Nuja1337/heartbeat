# Heartbeat

Heartbeat is a browser aim trainer. It records where and how you miss, then suggests drills for your weak spots. It runs at https://heartbeat.ajshaham.workers.dev.

The repository is private for now.

## What it does

You click targets in time with a beat. Every click is saved with its position, its timing and the movement that led to it. The stats pages turn that into ratings, trends and specific advice. Home offers a short setup for your input, your timing and a placement test (see Calibration).

Targets come in three kinds.

- Circles, which you click.
- Sliders, where you hold and follow a moving ball.
- Spinners, where you rotate the cursor around the center.

Each click is judged Crisp, Solid, Rough or Miss. The windows depend on the timing setting, and at timing strictness 5 they are 40, 80 and 120 ms. The Dynamic level presets use strictness 1 to 8. A finished play gets a grade from Pinpoint down to Scattered, based on accuracy and misses.

## Modes

**Dynamic** generates a full map from a seed. Each map is planned as an intro, a build, a peak, rests and an outro, so its difficulty rises and falls. Pick a level from 1 to 8, or set each part of the difficulty yourself. The same seed gives the same map in the same browser.

**Training modules** play short sets and change their difficulty after every set so that about 70% to 86% of targets count as a success.

| Module    | What it trains                        |
| --------- | ------------------------------------- |
| Jumps     | Distance and where you stop           |
| Angles    | Sharp and wide turns between jumps    |
| Streams   | Tapping speed and even timing         |
| Tracking  | Staying on sliders                    |
| Spinning  | Spinner speed                         |
| Precision | Landing near the center               |
| Reading   | Short approach times and busy screens |
| Timing    | Narrow hit windows                    |

Mix plays two to four modules in turn. Warm-up starts a session a little below your level. Stamina plays long runs at a steady level and shows when your accuracy drops. Placement plays two short sets of jumps, streams, tracking, precision and timing in turn and sets your starting level in each.

**Mods** are Fade, Spotlight, Fast, Slow, Tight, Wide, Mirror, No Fail, One Life, Bullseye and No Rings.

- Bullseye counts a hit outside the inner half of a target as Rough at best.
- No Rings removes the approach ring, so you read the timing from the spacing and the beat.
- Fast and Slow, Tight and Wide, No Fail and One Life, and No Rings and Fade can't be combined.

Each mod has a score multiplier, and personal bests are kept separately for each mod set. A module's level changes only after plays with no mods or with Mirror alone.

## Replays

The engine records every input on a fixed time and position grid, and a replay plays that record back through the same game rules. The viewer has play and pause, speeds from 0.25x to 2x, a scrubber with markers for misses and broken sliders, and a list of misses that jumps to the moment before each one. Space plays and pauses, the arrow keys seek 2 seconds, comma and period step one frame, [ and ] change the speed, and M jumps to the next miss. Mark a replay to keep it and it is never removed. Results and the play detail page link to the replay.

## How the analytics work

Each saved play keeps a summary and, for a while, a record of every object. A summary holds the score, accuracy, timing, aim errors, movement metrics and grouped statistics that show up on the Patterns and Aim tabs.

**Aim errors** are measured in target radii and shown as a percentage of a target's width. Along the movement, a positive value means you went past the target. Across the movement, a positive value means to the right of the line you moved along.

**Movement metrics** come from the cursor path before each click. They are when you leave the previous target, where your first motion stops, and how far you move afterwards to correct it.

**Aim throughput** is shown in bits per second. It groups your jumps by distance and time, measures how widely your clicks land around the target for each group, and combines distance and spread into one number. The Aim tab plots it against the difficulty of the jumps and trends it over time. It needs at least 15 jumps in a play.

**Skill ratings** cover aim, speed, tracking, precision, timing, reading and spinning. For each play, the demand of the map is converted to the Level 1 to 8 scale, then multiplied by your performance squared. A rating is a weighted mean of your best 20 scores from the last 60 days, and it is marked provisional below 5 plays. The tier is the whole-number part of the rating. Rating history and a skill radar show how they move.

**Insights** are rules that look at your clicks from the last 30 days, at most 3000 of them. Each rule has a minimum number of clicks and a minimum effect size, and a mean difference must also be larger than its random noise. The rules cover overshooting or stopping short on long jumps, drifting to one side in one direction, being early or late on streams, losing timing late in a stream, dropping accuracy in the second half of a play, sharp against wide turns, trailing sliders, losing sliders on curves, letting go of sliders early, a steady click offset, busy screens, clicks far from the center and failing spinners. Three rules use the movement metrics. They find leaving a target late on fast jumps, a first motion that stops short or goes past on long jumps, and a second correcting motion on many longer jumps. Each insight states its numbers and how many clicks they came from, and names a module and options to train it with.

**Drills** start from the Train this button on an insight. Heartbeat stores the measurement the insight was based on. After at least 3 drill sessions it measures the same thing on plays outside the drill, so you can see whether the change carried over. The result is better, no clear change or worse, and it locks after 30 days.

**What changed this week** on Home compares the last 7 days with the 4 weeks before them, and reports only the changes that are clear.

## Practice habits

- **Daily plan.** Each day has a plan of four steps. It is a warm-up, two drills chosen from your insights and ratings, and a Dynamic play at a suggested level. A step is ticked off when you finish it or play it for at least a minute.
- **Daily map.** Each day has one Dynamic map, made from the date, and it changes at your local midnight. Players who pick the same level on the same date start from the same seed, though another browser can build it a little differently. The Daily page keeps your history and daily streak.
- **Streaks and weekly goal.** A streak counts days in a row with at least one saved play that you finished or played for at least a minute. The weekly goal counts minutes from Monday to Sunday against the target you set in Settings, which is 60 by default.
- **Milestones.** Plays, hours, streaks, combos, daily maps, a drill that worked, the placement test and clearing each level 1 to 8 with 90% accuracy are marked the first time you reach them.
- **Share links.** Share map on the play setup, the results and the Daily page copies a link. Opening it fills in the setup with the same mode, difficulty, mods, length and seed. It never starts a play by itself, and module links use the receiver's own levels. A map made by a different generator version shows a note, because the map can differ.

## Calibration

Displays and speakers delay what you see and hear. The calibration page (Settings, Timing, or the setup on first run) measures that delay.

- Visual calibration shows a target whose ring closes every 600 ms. Audio calibration plays a metronome click at the same interval.
- The first press starts the run. After four lead-in beats, you tap 24 times, with a hit key or a mouse button.
- Taps more than 200 ms from a beat are dropped. The result is the median of your taps, with their spread. Above 30 ms of spread, the page asks you to try again.
- Apply saves the rounded median as the visual offset (-50 to 150 ms) or the audio offset (-100 to 300 ms). The visual offset draws targets earlier, and the audio offset plays the metronome earlier. Hit sounds always play at once.

## Guide and help

The Guide page at `/guide` explains the modes, the hit windows, the controls, the stats and what happens to your data. Numbers that have a constant in the catalog are read from it, and the rest are copied from the code. The footer links to it from every page, and Settings links to it under App.

## Offline and install

In a production build, a service worker caches the app, so it loads without a connection after the first visit. When a new version is ready, a banner offers a reload. Browsers that support it offer Install in Settings, under App.

## Your data

Everything is stored in this browser with IndexedDB. There is no account and nothing is sent anywhere.

- Play summaries are kept forever.
- Per-object detail is kept for 365 days by default. You can change this in Settings. Removing old detail doesn't change ratings, trends or bests.
- Replays are stored compressed. The newest 100 are kept by default, and Settings offers 25, 100, 300 or all. Replays you mark to keep, and replays of new bests, are never removed. Older ones are removed after your next play or the next time Heartbeat starts.
- Settings can export everything as a .json or .json.gz file and import it again. The export has a checkbox to include replays, and without them the file is much smaller. Importing skips plays that are already there.
- Export files from version 1.0 still import.
- The browser can clear site data. Settings shows whether it has agreed to keep it, and a regular export is the safe copy.
- Data belongs to one address. Moving the app to a new address means exporting here and importing there.

## Controls

- Click, or press Z or X, to hit. Both keys can be changed in Settings. Left and right mouse buttons also count, and you can hold one while pressing the other.
- Esc pauses. The pause menu has Resume, Restart and Quit.
- Hold the retry key (the backtick key by default) for 0.3 seconds during a play to end the play and start the same map again. You can change it or turn it off in Settings.
- On the results page, R retries, N plays a new map, W watches the replay and Esc goes back.
- Raw input locks the pointer and reads mouse movement directly. It needs a click to lock again after a pause, which is why Resume is a button.
- Menus work with the keyboard. Tab moves between controls and the arrow keys change options in a group.

## Look, language and accessibility

Settings has a Look section and an Accessibility section.

- The theme is dark, light or whatever the operating system uses, and the default follows the system. The playfield follows the theme. On the light theme every palette color is darkened until it reads at 4.5:1 on white, so targets and judgments stay visible and stay apart.
- The language can be English, Spanish, Portuguese (Brazil), French, German, Russian, Japanese, Korean or Simplified Chinese. Automatic picks from the browser's languages. English is the source text and the rest are translations.
- Text size has three steps for the text on every page. The playfield keeps its size, because target size is part of the difficulty.
- High contrast gives stronger text, lines and focus rings. It also turns on when the operating system asks for more contrast.
- Reduce motion turns off page animations, sparks, shakes and miss flashes. On the first visit it follows the operating system.
- The Clear view palette uses colors that stay apart with red-green color blindness. Judgments are also shown as words and played as sounds.
- Every control can be reached with Tab, a skip link leads to the content, and focus moves to the new page after a link. Pages have landmarks and headings for screen readers, and a play says when it starts, pauses and ends.

The theme, text size and contrast are also kept in `localStorage`, where a small inline script in `index.html` reads them before the first paint so the page never flashes the wrong theme. The script is allowed by hash in the Content Security Policy, and `src/app/csp.test.ts` fails when the two drift apart.

## Browser notes

- Chrome and Firefox are the main targets. Safari works with a few differences.
- Raw input without acceleration needs a recent browser. When it isn't available, Heartbeat falls back to raw input with acceleration and says so in Settings.
- Safari has no high-rate pointer events, and Firefox has no low latency canvas. Both play normally with slightly more delay.
- Pens and tablets are absolute devices, so they use the normal cursor even when raw input is on.
- The same seed can give a slightly different map in a different browser, because math functions differ a little between them. Saved plays store positions, so your stats never depend on regenerating a map.

## Development

```
npm install
npm run dev           # start the dev server
npm run check         # type check, lint, format check and all tests
npm run lint          # oxlint
npm run format        # prettier --write
npm run i18n          # collect translatable text into src/i18n/keys.json
npm run deploy        # build and publish with Wrangler
```

Prettier formats the code (`.prettierrc`) and oxlint checks it (`.oxlintrc.json`). oxlint was chosen over ESLint because typescript-eslint does not yet support the TypeScript 7 compiler this project uses. The GitHub Actions workflow in `.github/workflows/check.yml` runs the same checks and a production build on every push to main and on every pull request.

The version in `package.json` is shown in the footer and in Settings. Vite passes it to the app as `__APP_VERSION__`.

`npm run dev` also serves `/dev.html`, a test page for the game engine.

### Translations

English sentences are the dictionary keys. Text goes through `t()` from `src/shared/i18n.ts` (or `tx()` from `src/app/i18n.tsx` when a sentence has an element inside it), with ICU-style placeholders, plurals and selects: `t('{n, plural, one {# play} other {# plays}}', { n })`. Text defined at module level is marked with `msg()` and translated where it is shown. The catalog's labels and descriptions are getters, so they translate on read.

`npm run i18n` scans the source and writes `src/i18n/keys.json`. The dictionaries live in `src/i18n/locales/<locale>.json`, one flat object from English to the translation. `src/i18n/i18n.test.ts` fails when keys.json is out of date, when a dictionary is missing a key or has a stale one, or when a translation drops a placeholder. To add a language: add it to `src/shared/locales.ts`, add its loader in `src/app/i18n.tsx`, and write the dictionary. Each dictionary is its own chunk, and the service worker does not precache them, so a player downloads only the one in use.

Open the app with `?fake=1` in a dev build to replace the game engine with a stand-in. A play then ends after 3 seconds with a made-up result, which is enough to click through setup, results, stats and insights.

Folders:

- `src/shared` holds the types and constants that the engine and the app both use.
- `src/game` holds the engine, the map generator and the headless simulator that the integration tests use.
- `src/app` holds the screens, `src/data` the storage and `src/analytics` the statistics and insights.
- `docs/PLAN.md` holds the 1.0 design and `docs/PLAN-2.md` the 2.0 design.

The site is a static Worker deployed with Wrangler. See `wrangler.jsonc`.

`public/_headers` sets the response headers. Scripts may come only from the site itself (plus the one inline boot script, by hash), the page can't be framed, hashed files under `/assets/` are cached for a year, the icons and the preview image for a day, and everything else is checked on every visit. `public/robots.txt` and `public/sitemap.xml` list the pages worth indexing, and `public/og.png` is the preview image for shared links.

### Retiring the service worker

`public/sw-kill.js` is a worker that removes itself, deletes every cache and reloads the open pages. Nothing uses it now. If a released worker ever breaks the app, ship a build where:

1. `public/sw-kill.js` is served as `/sw.js`, for example by copying it over `public/sw.js` before `npm run build`.
2. `src/app/pwa.ts` no longer calls `serviceWorker.register`, so the page stops installing a new worker.

Browsers check `/sw.js` for changes on their own, so players pick it up on their next visit.

Every build must ship `/sw.js` as JavaScript at that exact path. The host answers a missing file with the app's HTML, so a build without it, or with the worker under another name, leaves players on whatever worker they have, and the kill switch can no longer reach them.
