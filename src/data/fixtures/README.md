# Fixtures

`v1-export.json` is the original 1.0 export file, in format version 1. It was written before the app was renamed to Heartbeat, so its `format` value is the older one that import still accepts. It holds 4 plays (with per-object detail), 1 drill, progress for 3 modules, a tier history entry and settings that differ from the defaults.

It was made once with the code tagged `v1.0`, through `savePlay`, `saveDrill`, `saveSettings`, `setTierHistory` and `buildExport`, using `src/integration/makeV1Fixture.test.ts`.

Never regenerate it. It is the reference for what 1.0 wrote, and later versions must keep loading it unchanged. The generator test is skipped unless `MAKE_FIXTURE` is set, and running it on newer code would overwrite the file with a newer format.
