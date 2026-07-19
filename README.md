# 3psLCCA Core

Python package for performing **Life Cycle Cost Analysis (LCCA)** on bridge structures, with support for road user cost, carbon emission cost, maintenance, and end-of-life stage costs — and a browser build that runs the same engine entirely client-side via [Pyodide](https://pyodide.org) (WebAssembly).

This is the **`web` branch**: the branch GitHub Pages serves. Besides the Python source, it carries the published release artifacts and the site around them.

## Live site

| Page | What it does |
| --- | --- |
| [Releases](https://3psLCCA.github.io/3psLCCA-core/) | All published versions of `3pslccacore.js`, with drop-in snippets and integrity hashes |
| [Notebook](https://3psLCCA.github.io/3psLCCA-core/lcca-notebook.html) | Interactive in-browser LCCA notebook |
| [Docs](https://3psLCCA.github.io/3psLCCA-core/view_documentation.html) | Renders any Markdown file from this branch (`#file=release/v1.0.0/NOTES.md`, etc.) |

## Use in the browser

One script tag per release — the wheel and Pyodide URLs are baked in (from
v1.0.2 the wrapper loads Pyodide itself), no server or install needed:

```html
<script src="https://3psLCCA.github.io/3psLCCA-core/release/v1.0.2/3pslccacore.js"></script>
<script>
  const { sample, performAnalysis } = window.ThreePsLccaCore;
  performAnalysis(sample.input, sample.constructionCosts, sample.wpi)
    .then((result) => console.log(result));
</script>
```

See each release's `NOTES.md` (linked from the releases page) for the full `window.ThreePsLccaCore` API.

## What's on this branch

| Path | Purpose |
| --- | --- |
| `index.html`, `lcca-notebook.html`, `view_documentation.html` | The GitHub Pages site |
| `release/releases.json` | Machine-readable release index (drives the releases page) |
| `release/vX.Y.Z/` | Published artifacts per version: `3pslccacore.js`, wheel + `.sha256`, `NOTES.md` |
| `3pslccacore.template.js` | Template the release build renders into each version's `3pslccacore.js` |
| `release.py`, `verify_releases.py`, `_build_backend.py` | Release tooling: build the wheel, assemble the bundle, publish it here |
| `src/` | The Python package (`three_ps_lcca_core`) and examples |

Development happens on the `web-dev` branch; releases are built there (`python -m build --wheel -C version=X.Y.Z -C release=true`) and `release.py` copies the assembled `release/vX.Y.Z/` folder onto this branch.
