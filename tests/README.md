# Widget regression tests

Run from the repository root with Node.js 22 or 24. No dependencies, credentials, Downloads files, RAV connection, or network access are needed.

```sh
npm test
npm run test:coverage
```

Run one area while investigating a failure:

```sh
node --test tests/widget-assets.test.mjs
node --test --test-name-pattern="startup" tests/*.test.mjs
```

GitHub Actions runs the coverage command on Windows and Linux with Node 22 and 24 for every push and pull request. Failures return a nonzero exit code. To require a passing run before merging, select these checks in the repository's branch protection settings.

## What is protected

| Area | Regression contracts | Test file |
| --- | --- | --- |
| Fonts | MetricFont routing; Google API, GitHub and Inter fallback; caching and buffer ownership; live swaps; stale requests; decode failures; wrapper release; glyph fallback lifecycle. | [widget-assets.test.mjs](widget-assets.test.mjs) |
| Audio | Singular string/object payloads; URL normalization; prefetch/cache reuse; retries; stale assets; wrapper release. | [widget-assets.test.mjs](widget-assets.test.mjs) |
| Images | URL normalization; assignment followed by `play()`; duplicate requests; response order; cancellation; reload isolation; retry; authored-image preservation; JSON before/after fade slots and triggers. | [widget-assets.test.mjs](widget-assets.test.mjs) |
| Property IDs | Exact legacy ID fixtures, capitalization, nested paths, deterministic disambiguation, reserved IDs, global Model + property IDs, collision handling, and independent updates. | [widget-models.test.mjs](widget-models.test.mjs), [widget-json.test.mjs](widget-json.test.mjs) |
| View Models | Selected artboard's bound instance; authored fallback binding; nested instances, siblings and repeated definitions; cycles/native aliases; depth limits; missing accessors; global-only files; trigger routing. | [widget-models.test.mjs](widget-models.test.mjs) |
| Dynamic UI | Every supported control type, authored defaults, enum selections, public list JSON, nested titles/tooltips, asset controls, static configuration agreement, and artboard selection indices. | [widget-controls.test.mjs](widget-controls.test.mjs) |
| JSON rules | Strict finite numbers, decimals and exponents; numeric text preservation; invalid numbers to zero; explicit booleans; omitted values; internal `__` and `_` write rules; nested reports; enum names/indices; immutable input. | [widget-json-rules.test.mjs](widget-json-rules.test.mjs), [widget-json.test.mjs](widget-json.test.mjs) |
| Lists | Arrays, JSON strings, single rows, arbitrary table wrappers, authored row identity/defaults, schema normalization, keyed sorting/deletion, sorting during writes, heterogeneous models, `_vm` replacement, empty/repopulate, and failed creation/insertion retries. | [widget-json.test.mjs](widget-json.test.mjs), [widget-json-rules.test.mjs](widget-json-rules.test.mjs) |
| Startup and reloads | Values arriving before load; latest values winning; persisted artboard/machine selection; stale callbacks; deferred cleanup; newest reload winning; asset ownership; synchronous audio assignment; late asset UI refresh; renderer fallback; watchdog; canvas/FPS behavior. | [widget-lifecycle.test.mjs](widget-lifecycle.test.mjs) |

## How the tests work

[widget-harness.mjs](helpers/widget-harness.mjs) executes the inline JavaScript from the actual `RiveLink/source/output.html` in a fresh Node VM for each fixture. The handlers under test are not copied or rewritten. Rive accessors, Singular's SDK, the DOM, timers, and fetch/decode boundaries are mocked. Async tests control response order with promises; fake timers avoid waiting for real delays.

Tests assert observable values, published controls, IDs, playback calls, warnings, and resource ownership. Compatibility fixtures intentionally hardcode IDs saved by existing overlays. When a test fails, investigate whether the behavior changed before updating its expected value.

The coverage command includes only the widget's inline JavaScript, excluding the test harness. It requires at least **90% line, 80% branch, and 90% function coverage**. Coverage measures executed code; it does not prove every file or every runtime behavior is supported.

## Release checks that still need Singular/RAV

These tests do not render pixels, execute Rive WASM/state machines/Luau, contact real font services, play audio, or run inside Singular's browser. Before a release affecting those boundaries:

1. Load representative `.riv` files in Singular using the pinned runtime. Verify a full page reload and a widget-only reload with linked data.
2. Switch artboards and machines; check that controls match the active bound model and globals remain accessible.
3. Exercise a table with nested properties, decimal strings, reorder/delete, empty/repopulate, and internal animation values.
4. Check image fades, font swaps, and referenced audio with the intended files and URLs. Check the browser console for failures.
5. Test saved overlays and Composition Scripting using their registered field IDs. RAV is useful for checking native accessor behavior, but does not replace this Singular check.

When fixing a bug, add a test reproducing its observable failure first, verify that it fails, then keep it with the fix. Add native/runtime smoke checks when a mock cannot reproduce the failure.
