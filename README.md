# Flickwise

Flickwise is a browser aim trainer. It records where and how you miss, then suggests drills for your weak spots.

The repository is private for now.

## What it does

You click targets in time with a beat. Every click is saved with its position, its timing and the movement that led to it. The stats pages turn that into ratings, trends and specific advice.

Targets come in three kinds.

- Circles, which you click.
- Sliders, where you hold and follow a moving ball.
- Spinners, where you rotate the cursor around the center.

Each click is judged Crisp, Solid, Rough or Miss. The windows depend on the timing setting, and at timing strictness 5 they are 40, 80 and 120 ms. The Dynamic level presets use strictness 1 to 8.

## Modes

**Dynamic** generates a full map from a seed. Pick a level from 1 to 8, or set each part of the difficulty yourself. The same seed gives the same map in the same browser.

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

Mix plays two to four modules in turn. Warm-up starts a session a little below your level. Stamina plays long runs at a steady level and shows when your accuracy drops.

**Mods** are Fade, Spotlight, Fast, Slow, Tight, Wide, Mirror, No Fail and One Life. Fast and Slow, Tight and Wide, and No Fail and One Life can't be combined. Each mod has a score multiplier, and personal bests are kept separately for each mod set. A module's level changes only after plays with no mods or with Mirror alone.

## How the analytics work

Each saved play keeps a summary and, for a while, a record of every object. A summary holds the score, accuracy, timing, aim errors and grouped statistics that show up on the Patterns tab.

**Aim errors** are measured in target radii and shown as a percentage of a target's width. Along the movement, a positive value means you went past the target. Across the movement, a positive value means to the right of the line you moved along.

**Skill ratings** cover aim, speed, tracking, precision, timing, reading and spinning. For each play, the demand of the map is converted to the Level 1 to 8 scale, then multiplied by your performance squared. A rating is a weighted mean of your best 20 scores from the last 60 days, and it is marked provisional below 5 plays. The tier is the whole-number part of the rating.

**Insights** are rules that look at your clicks from the last 30 days, at most 3000 of them. Each rule has a minimum number of clicks and a minimum effect size, and a mean difference must also be larger than its random noise. The rules cover overshooting or stopping short on long jumps, drifting to one side in one direction, being early or late on streams, losing timing late in a stream, dropping accuracy in the second half of a play, sharp against wide turns, trailing sliders, losing sliders on curves, letting go of sliders early, a steady click offset, busy screens, clicks far from the center and failing spinners. Each insight states its numbers and how many clicks they came from, and names a module and options to train it with.

**Drills** start from the Train this button on an insight. Flickwise stores the measurement the insight was based on. After at least 3 drill sessions it measures the same thing on plays outside the drill, so you can see whether the change carried over. The result is better, no clear change or worse, and it locks after 30 days.

## Your data

Everything is stored in this browser with IndexedDB. There is no account and nothing is sent anywhere.

- Play summaries are kept forever.
- Per-object detail is kept for 365 days by default. You can change this in Settings. Removing old detail doesn't change ratings, trends or bests.
- Settings can export everything as a .json or .json.gz file and import it again. Importing skips plays that are already there.
- The browser can clear site data. Settings shows whether it has agreed to keep it, and a regular export is the safe copy.
- Data belongs to one address. Moving the app to a new address means exporting here and importing there.

## Controls

- Click, or press Z or X, to hit. Both keys can be changed in Settings. Left and right mouse buttons also count, and you can hold one while pressing the other.
- Esc pauses. The pause menu has Resume, Restart and Quit.
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
- `src/game` holds the engine.
- `src/app` holds the screens, `src/data` the storage and `src/analytics` the statistics and insights.
- `docs/PLAN.md` holds the full design.

The site is a static Worker deployed with Wrangler. See `wrangler.jsonc`.
