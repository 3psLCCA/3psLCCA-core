# 3psLCCA Core v1.0.1 - Release Notes

**Released:** 2026-07-19 · **Commit:** `db8b6e4` · **Kind:** stable release

Patch release: reliability fixes for the `3pslccacore.js` browser wrapper.
The Python analysis core is unchanged from v1.0.0 (the wheel is re-stamped
as 1.0.1 so the release stays self-contained).

## Quick start

```html
<script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"></script>
<script src="https://3psLCCA.github.io/3psLCCA-core/release/v1.0.1/3pslccacore.js"></script>
<script>
  const { sample, performAnalysis } = window.ThreePsLccaCore;
  performAnalysis(sample.input, sample.constructionCosts, sample.wpi)
    .then((result) => console.log(result));
</script>
```

Pyodide must be loaded first, and the page has to be served over HTTP -
`file://` won't work (the wrapper checks and tells you).

## Fixed

- **Retrying after a failed initialization now works.** A failed `init()`
  (e.g. a dropped connection while downloading Pyodide or the wheel) was
  cached forever, so every later call returned the same stale rejection
  until a full page reload - even though the offline error message says
  "reconnect and try again". Failed attempts are no longer cached; the next
  call starts initialization over.
- **Omitting `wheelUrl` on a follow-up call no longer tears down a working
  runtime.** Previously, initializing with an explicit `wheelUrl` option and
  then making any call without it silently discarded the initialized runtime
  and re-initialized against an empty URL, failing deep inside micropip.
  Calls without the option now reuse the URL the runtime was initialized
  with, and an empty/unconfigured wheel URL fails fast with a clear message
  (`checkEnvironment` reports it too).
- **Non-finite numbers in results are reported properly.** A `NaN` or
  `Infinity` anywhere in an analysis result made Python emit invalid JSON,
  crashing the wrapper with a raw `SyntaxError` outside its error handling.
  Such results now surface as a structured `LccaError`
  (`SerializationError`) with captured stdout/stderr intact.

## Hardened

- A malformed payload from the Python side now throws a proper `LccaError`
  (with the failing stage) instead of an unhandled parse error.
- If initialization is restarted with a different `wheelUrl` while a
  previous attempt is still in flight, the superseded attempt can no longer
  overwrite the progress/error state (`getState()`) of the attempt that
  replaced it.

## What's in this release

| Artifact | Notes |
| --- | --- |
| `3pslccacore.js` | Browser wrapper; wheel URL baked in as an absolute URL |
| `three_ps_lcca_core-1.0.1-py3-none-any.whl` | Python analysis core, installed by the wrapper at runtime |
| `NOTES.md` | This file |

The wrapper points at its own colocated wheel
(`https://3psLCCA.github.io/3psLCCA-core/release/v1.0.1/three_ps_lcca_core-1.0.1-py3-none-any.whl`),
so the one `<script src>` is self-sufficient. For local development you can
override this with the `wheelUrl` option on any API call.

## API

Unchanged from [v1.0.0](../v1.0.0/NOTES.md): `performAnalysis`,
`getIrcStandardSuggestions`, `init`, `checkEnvironment`, `getState` /
`isReady`, `sample`, and `LccaError` on `window.ThreePsLccaCore`.

## Integrity

| File | sha256 |
| --- | --- |
| `3pslccacore.js` | `6ebb956ec682f578233d321e63c288adf0b07fdad5ed504e3a81000b1cc668d4` |
| `three_ps_lcca_core-1.0.1-py3-none-any.whl` | `b6e48e82e4dc86dd635cec20e47980ba737c719a541a4094be865f0652daad49` |

The [releases page](../../index.html) generates a drop-in snippet with a
matching Subresource Integrity attribute.
