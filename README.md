# Flickwise

Flickwise is a browser aim trainer. It records where and how you miss, then suggests drills for your weak spots.

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

| Module | What it trains |
|---|---|
| Jumps | Distance and where you stop |
| Angles | Sharp and wide turns between jumps |
| Streams | Tapping speed and even timing |
| Tracking | Staying on sliders |
| Spinning | Spinner speed |
| Precision | Landing near the center |
| Reading | Short approach times and busy screens |
| Timing | Narrow hit windows |

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

**Drills** start from the Train this button on an insight. Flickwise stores the measurement the insight was based on. After at least 3 drill sessions it measures the same thing on plays outside the drill, so you can see whether the change carried over. The result is better, no clear change or worse, and it locks after 30 days.

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

## Offline and install

In a production build, a service worker caches the app, so it loads without a connection after the first visit. When a new version is ready, a banner offers a reload. Browsers that support it offer Install in Settings, under App.

## Your data

Everything is stored in this browser with IndexedDB. There is no account and nothing is sent anywhere.

- Play summaries are kept forever.
- Per-object detail is kept for 365 days by default. You can change this in Settings. Removing old detail doesn't change ratings, trends or bests.
- Replays are stored compressed. The newest 100 are kept by default, and Settings offers 25, 100, 300 or all. Replays you mark to keep, and replays of new bests, are never removed. Older ones are removed after your next play or the next time Flickwise starts.
- Settings can export everything as a .json or .json.gz file and import it again. The export has a checkbox to include replays, and without them the file is much smaller. Importing skips plays that are already there.
- Data from Flickwise 1.0 upgrades automatically the first time 2.0 opens. 1.0 export files still import.
- The browser can clear site data. Settings shows whether it has agreed to keep it, and a regular export is the safe copy.
- Data belongs to one address. Moving the app to a new address means exporting here and importing there.

## Controls

- Click, or press Z or X, to hit. Both keys can be changed in Settings. Left and right mouse buttons also count, and you can hold one while pressing the other.
- Esc pauses. The pause menu has Resume, Restart and Quit.
- Hold the retry key (the backtick key by default) for 0.3 seconds during a play to end the play and start the same map again. You can change it or turn it off in Settings.
- On the results page, R retries, N plays a new map, W watches the replay and Esc goes back.
- Raw input locks the pointer and reads mouse movement directly. It needs a click to lock again after a pause, which is why Resume is a button.
- Menus work with the keyboard. Tab moves between controls and the arrow keys change options in a group.

## Browser notes

- Chrome and Firefox are the main targets. Safari works with a few differences.
- Raw input without acceleration needs a recent browser. When it isn't available, Flickwise falls back to raw input with acceleration and says so in Settings.
- Safari has no high-rate pointer events, and Firefox has no low latency canvas. Both play normally with slightly more delay.
- Pens and tablets are absolute devices, so they use the normal cursor even when raw input is on.
- The same seed can give a slightly different map in a different browser, because math functions differ a little between them. Saved plays store positions, so your stats never depend on regenerating a map.

## Development

```
npm install
npm run dev       # start the dev server
npm run check     # type check and run all tests
npm run deploy    # build and publish with Wrangler
```

`npm run dev` also serves `/dev.html`, a test page for the game engine.

Open the app with `?fake=1` in a dev build to replace the game engine with a stand-in. A play then ends after 3 seconds with a made-up result, which is enough to click through setup, results, stats and insights.

Folders:

- `src/shared` holds the types and constants that the engine and the app both use.
- `src/game` holds the engine, the map generator and the headless simulator that the integration tests use.
- `src/app` holds the screens, `src/data` the storage and `src/analytics` the statistics and insights.
- `docs/PLAN.md` holds the 1.0 design and `docs/PLAN-2.md` the 2.0 design.

The site is a static Worker deployed with Wrangler. See `wrangler.jsonc`.

### Retiring the service worker

`public/sw-kill.js` is a worker that removes itself, deletes the `fw-` caches and reloads the open pages. Nothing uses it now. If a released worker ever breaks the app, ship a build where:

1. `public/sw-kill.js` is served as `/sw.js`, for example by copying it over `public/sw.js` before `npm run build`.
2. `src/app/pwa.ts` no longer calls `serviceWorker.register`, so the page stops installing a new worker.

Browsers check `/sw.js` for changes on their own, so players pick it up on their next visit.
