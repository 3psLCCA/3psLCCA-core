# 3psLCCA Core v1.0.2 - Release Notes

**Released:** 2026-07-19 · **Commit:** `0960535` · **Kind:** stable release

Feature release: the `3pslccacore.js` browser wrapper is now fully
self-sufficient - one `<script>` tag, no manual Pyodide include.
The Python analysis core is unchanged from v1.0.0 (the wheel is re-stamped
as 1.0.2 so the release stays self-contained).

## Quick start

```html
<script src="https://3psLCCA.github.io/3psLCCA-core/release/v1.0.2/3pslccacore.js"></script>
<script>
  const { sample, performAnalysis } = window.ThreePsLccaCore;
  performAnalysis(sample.input, sample.constructionCosts, sample.wpi)
    .then((result) => console.log(result));
</script>
```

The page has to be served over HTTP - `file://` won't work (the wrapper
checks and tells you).

## New

- **Pyodide loads itself.** The Pyodide URL this release was built and
  tested against (`https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js`)
  is baked into the wrapper; the first call injects the `<script>` on
  demand as a new `loading-pyodide-script` stage, with the same offline
  handling and retry-after-failure behavior as every other stage. Loading
  pyodide.js with your own `<script>` tag beforehand still works and
  always wins - the two-script embedding from v1.0.0/v1.0.1 keeps working
  unchanged.
- **New `pyodideUrl` option** on `init` / `performAnalysis` /
  `getIrcStandardSuggestions`, mirroring `wheelUrl`: follow-up calls
  without the option reuse the URL of the current runtime. Since a loaded
  pyodide.js script can't be unloaded, passing a *different* URL once
  Pyodide is on the page is ignored with a console warning rather than
  tearing down the runtime.
- **The wheel is found next to the script, wherever it's served from.**
  The wrapper resolves the wheel's filename against its own
  `document.currentScript.src`, so the release folder works as a unit from
  github.io, a localhost server, or a mirror - which is what makes a
  staged, not-yet-published build testable locally. The absolute published
  URL stays baked in as the fallback for contexts without `currentScript`
  (ES-module imports, bundler inlining).

## What's in this release

| Artifact | Notes |
| --- | --- |
| `3pslccacore.js` | Browser wrapper; Pyodide URL baked in, wheel resolved relative to the script itself |
| `three_ps_lcca_core-1.0.2-py3-none-any.whl` | Python analysis core, installed by the wrapper at runtime |
| `NOTES.md` | This file |

For local development you can still override both sources with the
`wheelUrl` and `pyodideUrl` options on any API call.

## API

Same surface as [v1.0.1](../v1.0.1/NOTES.md): `performAnalysis`,
`getIrcStandardSuggestions`, `init`, `checkEnvironment`, `getState` /
`isReady`, `sample`, and `LccaError` on `window.ThreePsLccaCore` - plus the
new `pyodideUrl` option described above. `getState().stage` can now also
report `loading-pyodide-script`.

## Integrity

| File | sha256 |
| --- | --- |
| `3pslccacore.js` | `ae243e83e9641416f3d55ce93126e9e58a331008f2f76418c26ce9b844f088f8` |
| `three_ps_lcca_core-1.0.2-py3-none-any.whl` | `c69379930c8bdf215196fe76337d8649dfef43286fac7c2ef43edbb8cd639e5f` |

The [releases page](../../index.html) generates a drop-in snippet with a
matching Subresource Integrity attribute.
