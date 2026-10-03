# Developing the web delivery (`web-dev` → `web`)

This line of work packages `three_ps_lcca_core` for client-side browser execution across two supported runtimes:
1. **Brython (Recommended)** — Ultra-lightweight direct transpilation (~93 KB bundle, 23.5 KB Gzip, ~400 ms import, ~5 ms execution).
2. **Pyodide** — Full WebAssembly runtime (wheel installed in WASM via micropip).

It is **not** merged into `main` and is **not** used to publish to PyPI or conda — there is no CI/CD pipeline and no automatic versioning from git tags. Every release is built locally and stamped with a version you choose explicitly.

Two branches share the work:

- **`web-dev`** — where development happens: source, tooling, and the committed release ledger (`release/releases.json`).
- **`web`** — what GitHub Pages serves. Release content (`release/vX.Y.Z/` folders plus the ledger) is committed here directly.

## Layout

- `src/three_ps_lcca_core/` — the actual package. Included in built wheels and minified into the Brython bundle.
- `src/examples/` — demo input scripts (`from_dict`, `from_metadata`). Not shipped in the wheel; kept for local reference/testing only.
- `_build_backend.py` — a thin wrapper around `setuptools.build_meta` that enforces version rules, records confirmed builds in the ledger, and stages both Pyodide and Brython release artifacts.
- `build_brython.py` — standalone minifier and bundler that compresses the Python source tree using `python-minifier` (hoisting literals, removing docstrings, preserving `@dataclass` field annotations) into `three_ps_lcca_core.brython.js`.
- `3pslccacore.template.js` — the Pyodide browser wrapper template. Release builds render it to `3pslccacore.js` with `RELEASE_WHEEL_URL` and `RELEASE_PYODIDE_URL` filled in.
- `release.py` — validates a staged release against the ledger before publishing. Assembles both Pyodide and Brython artifacts into the temporary deploy clone.
- `verify_releases.py` — re-hashes wheels, `3pslccacore.js`, and `three_ps_lcca_core.brython.js` against `release/releases.json`.
- `index.html` — the releases page published to GitHub Pages, featuring drop-in snippets for both Pyodide and Brython.
- `release/releases.json` — committed ledger of every build made with `-C release=true` (version, kind, sha256s for wheel, JS wrapper, and Brython bundle, commit, `published` flag).
- `release/vX.Y.Z/` — staged release output:
  * `three_ps_lcca_core-X.Y.Z-py3-none-any.whl` + `.sha256`
  * `3pslccacore.js` (Pyodide wrapper)
  * `three_ps_lcca_core.brython.js` + `.sha256` (Brython bundle)
  * `NOTES.md` (optional release notes)
- `VERSION` — generated at build time, gitignored. Never edit or commit it.

## Building a Release

Requires the [`build`](https://pypi.org/project/build/) package (`pip install build`), `brython`, and `python-minifier`:

```bash
pip install build brython python-minifier
```

### 1. Dev / Checkpoint builds
```bash
python -m build --wheel -C version=1.2.0.dev0
```
This produces `dist/three_ps_lcca_core-1.2.0.dev0-py3-none-any.whl`.

### 2. Production Releases (Pyodide + Brython)
A **final** version (no `.devN` / `rcN` suffix) is treated as a production release and requires explicit confirmation with `-C release=true`:

```bash
python -m build --wheel -C version=1.0.3 -C release=true
```

### What `-C release=true` Does:
1. **Stages the Pyodide Wheel**: Copies `.whl` and writes `.sha256` to `release/vX.Y.Z/`.
2. **Renders the Pyodide Wrapper**: Generates `3pslccacore.js` with baked-in URLs.
3. **Builds the Production Brython Bundle**:
   - Runs `build_brython.py`, minifying all 57 Python modules.
   - Outputs `three_ps_lcca_core.brython.js` (93 KB raw, 23.5 KB Gzip) and its `.sha256`.
4. **Updates the Ledger**: Records `wheel_sha256`, `js_sha256`, `brython_bundle`, and `brython_sha256` in `release/releases.json`.

## Verifying Staged Releases

Run the integrity verification script:

```bash
python verify_releases.py
```

This verifies that the hashes of all local wheels, `3pslccacore.js`, and `three_ps_lcca_core.brython.js` match `release/releases.json`.

## Publishing to GitHub Pages (`web` Branch)

1. Build and verify the release on `web-dev`:
   ```bash
   python -m build --wheel -C version=1.0.3 -C release=true
   python verify_releases.py
   ```
2. Run `release.py`:
   ```bash
   python release.py --version 1.0.3
   ```
   Rerun with `--push` when ready to commit to origin.
3. Mark `"published": true` for that version in `release/releases.json`.
