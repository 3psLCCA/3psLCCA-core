# 3psLCCA Core v1.0.0 - Release Notes

**Released:** 2026-07-19 · **Commit:** `cb93b15` · **Kind:** stable release

First public release of `3pslccacore.js` - the single-script browser build of
**three_ps_lcca_core**, a life-cycle cost analysis (LCCA) engine for pavements
and bridges. The script boots [Pyodide](https://pyodide.org) (Python on
WebAssembly), installs the bundled Python wheel via micropip, and exposes the
analysis entry points on `window.ThreePsLccaCore`. No server, no install -
everything runs in the browser.

## Quick start

```html
<script src="https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js"></script>
<script src="https://3psLCCA.github.io/3psLCCA-core/release/v1.0.0/3pslccacore.js"></script>
<script>
  const { sample, performAnalysis } = window.ThreePsLccaCore;
  performAnalysis(sample.input, sample.constructionCosts, sample.wpi)
    .then((result) => console.log(result));
</script>
```

Pyodide must be loaded first, and the page has to be served over HTTP -
`file://` won't work (the wrapper checks and tells you).

## What's in this release

| Artifact | Notes |
| --- | --- |
| `3pslccacore.js` | Browser wrapper; wheel URL baked in as an absolute URL |
| `three_ps_lcca_core-1.0.0-py3-none-any.whl` | Python analysis core, installed by the wrapper at runtime |
| `NOTES.md` | This file |

The wrapper points at its own colocated wheel
(`https://3psLCCA.github.io/3psLCCA-core/release/v1.0.0/three_ps_lcca_core-1.0.0-py3-none-any.whl`),
so the one `<script src>` is self-sufficient. For local development you can
override this with the `wheelUrl` option on any API call.

## API - `window.ThreePsLccaCore`

- **`performAnalysis(inputData, constructionCosts, wpi, options?)`** - runs the
  full life-cycle cost analysis (`run_full_lcc_analysis` in the Python core)
  and resolves with a JSON-serializable result. Options: `debug`, `onStatus`,
  `onOutput`, `wheelUrl`. Initializes the runtime automatically on first call.
- **`getIrcStandardSuggestions(options?)`** - returns Indian Road Congress
  standard constraints and default values (IRC SP:30-2019 and IRC 106:1990) as
  exposed by the Python core.
- **`init(onStatus?, wheelUrl?)`** - boots the runtime eagerly (Pyodide →
  micropip → wheel install → import verification). Idempotent: repeated calls
  share one in-flight promise. `onStatus` receives human-readable progress
  messages, handy for loading UIs.
- **`checkEnvironment(wheelUrl?)`** - pre-flight checks without starting
  Pyodide: Pyodide script present, not `file://`, WebAssembly support, wheel
  reachable. Resolves with a list of problems (empty = good to go).
- **`getState()` / `isReady()`** - snapshot of initialization progress. Stages:
  `idle → checking-environment → booting-pyodide → loading-micropip →
  installing-wheel → verifying-package → ready` (or `error`).
- **`sample`** - ready-to-run example payloads: `sample.input` (per-vehicle
  traffic mode), `sample.inputGlobal` (global road-user-cost mode),
  `sample.wpi`, and `sample.constructionCosts`.
- **`LccaError`** - the error class every failure is reported with.

## Error handling

All failures throw an `LccaError` carrying structured context: `stage` (which
step failed), `pythonType`, `traceback`, plus captured Python `stdout` and
`stderr`. It implements `toJSON()`, so `JSON.stringify(err)` gives a complete,
loggable report. Python `print` output and warnings from a call are forwarded
to the `onOutput` callback (default: the browser console).

## Input modes

Two ways to describe road-user costs, selected by
`general_parameters.use_global_road_user_calculations`:

- **Per-vehicle mode** (`false`) - supply `traffic_and_road_data` with
  per-class vehicle counts, emissions, and accident data (see `sample.input`).
- **Global mode** (`true`) - supply a precomputed
  `daily_road_user_cost_with_vehicular_emissions` total instead (see
  `sample.inputGlobal`).

## Integrity

| File | sha256 |
| --- | --- |
| `3pslccacore.js` | `aa06b01df399ab117f4047feae9ed211e71931894eadd9cfff3718d2a55733af` |
| `three_ps_lcca_core-1.0.0-py3-none-any.whl` | `4ef659c7258edc0b524f4f6548d51a9d72b8925e989fd9363f3a0d406dbd2e20` |

The [releases page](../../index.html) generates a drop-in snippet with a
matching Subresource Integrity attribute.
