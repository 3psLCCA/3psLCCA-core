# Developing the web delivery (`web-dev` → `web`)

This line of work packages `three_ps_lcca_core` as a wheel for use in a
browser/WASM runtime (Pyodide via micropip), plus the JS wrapper and release
pages that go with it. It is **not** merged into `main` and is **not** used
to publish to PyPI or conda — there is no CI/CD pipeline and no automatic
versioning from git tags. Every wheel is built locally and stamped with a
version you choose explicitly.

Two branches share the work:

- **`web-dev`** — where development happens: source, tooling, and the
  committed release ledger (`release/releases.json`).
- **`web`** — what GitHub Pages serves. Release content (`release/vX.Y.Z/`
  folders plus the ledger) is committed here directly, not merged from
  `web-dev` (see "Publishing a release" below).

## Layout

- `src/three_ps_lcca_core/` — the actual package. Only this is included in
  built wheels.
- `src/examples/` — demo input scripts (`from_dict`, `from_metadata`). Not
  shipped in the wheel; kept for local reference/testing only.
- `_build_backend.py` — a thin wrapper around `setuptools.build_meta` (see
  below) that enforces the version rules, records confirmed builds in the
  ledger, and stages release folders.
- `3pslccacore.template.js` — the browser wrapper template. Release builds
  render it to `3pslccacore.js` with `RELEASE_WHEEL_URL` and
  `RELEASE_PYODIDE_URL` filled in; the template itself is never loaded
  directly.
- `release.py` — validates a staged release against the ledger before
  publishing (it does not touch git at all). As a byproduct it assembles a
  `release/_publish/` bundle — gitignored, regenerated on every run, safe
  to delete; everything in it already exists in place.
- `verify_releases.py` — re-hashes wheels/JS in `dist/` and `release/`
  against `release/releases.json`; missing files are skipped, not flagged.
- `index.html` — the releases page published to GitHub Pages.
- `release/releases.json` — committed ledger of every build made with
  `-C release=true` (version, kind, sha256s, commit, `published` flag).
- `release/vX.Y.Z/` — staged release output (wheel, checksum, rendered JS,
  optional `NOTES.md`). Local staging only; never committed on `web-dev`.
- `VERSION` — generated at build time, gitignored. Never edit or commit it.

## Building a wheel

Requires the [`build`](https://pypi.org/project/build/) package
(`pip install build`).

```bash
python -m build --wheel -C version=1.2.0.dev0
```

This produces `dist/three_ps_lcca_core-1.2.0.dev0-py3-none-any.whl`.

`pip wheel . --no-deps -C version=1.2.0.dev0` works the same way, since
`-C`/`--config-setting` is a standard PEP 517 frontend flag, not a custom
script.

### The version is always required

There is no fallback version. `_build_backend.py` fails the build immediately
if `-C version=...` is missing, rather than silently producing an
unversioned or `0.0.0` wheel.

The value must be a valid [PEP 440](https://peps.python.org/pep-0440/)
version (the same spec `pip` and wheel filenames use). A leading `v` (e.g.
`v1.2.0`, matching this repo's git tag style) is accepted and normalized
away.

### Dev builds vs. production releases

Following the standard PEP 440 convention (the same one `pip` itself uses to
keep pre-releases out of normal installs), a **pre-release** version is
treated as a dev build and builds without any extra confirmation:

```bash
python -m build --wheel -C version=1.2.0.dev0   # ok
python -m build --wheel -C version=1.2.0rc1     # ok
```

A **final** version (no `.devN` / `aN` / `bN` / `rcN` suffix) is treated as a
production release and is rejected unless you explicitly confirm it:

```bash
python -m build --wheel -C version=1.2.0                    # fails
python -m build --wheel -C version=1.2.0 -C release=true    # ok
```

This exists so a plain local build can't accidentally stamp out something
that looks like a real release.

### What `-C release=true` does beyond building

Any build made with `-C release=true` is recorded in
`release/releases.json` — the committed ledger — with its version, kind
(`prerelease`/`release`), sha256s, and the git commit it was built from.
The flag also works with a pre-release version to log a checkpoint build
without it counting as a production release.

Any `-C release=true` build (final or prerelease checkpoint) additionally
stages `release/vX.Y.Z/` locally: the wheel, its `.sha256`, and `3pslccacore.js`
rendered from the template with `RELEASE_WHEEL_URL` set to the release's
fully-qualified GitHub Pages URL (derived from `git remote get-url origin`)
and `RELEASE_PYODIDE_URL` set to the Pyodide URL the build was tested
against (`-C pyodide=URL`, or prompted interactively; recorded in the
ledger as `pyodide_url`). With both baked in, the released wrapper
self-loads Pyodide when the embedding page didn't include it, so one
`<script src=".../3pslccacore.js">` is enough.

On an interactive terminal you may also be prompted to:

- confirm overwriting an already-recorded version (refused by default —
  versions are meant to be immutable; bump instead of rebuilding);
- mark the new version as `"latest"` in the ledger;
- scaffold an empty `NOTES.md` for the release (content is hand-edited
  afterward);
- run `verify_releases.py` right away.

Non-interactive builds (no attached terminal) skip the prompts and refuse
any overwrite.

## Cleaning up after a build

`dist/`, `build/`, `*.egg-info/`, and `VERSION` are gitignored build
artifacts, and staged `release/vX.Y.Z/` folders are disposable local output
(rebuild to regenerate them). Safe to delete anytime:

```bash
rm -rf dist build src/three_ps_lcca_core.egg-info VERSION release/v*
```

Do **not** delete `release/releases.json` — that's the committed build
ledger, not an artifact.

## Publishing a release

Once you have a production wheel (`-C release=true` on a final version, so
`release/vX.Y.Z/` is staged), run `release.py` as the pre-publish step. It
does **not** touch git — no clone, no commit, no push. It validates the
version (final releases only), checks the staged files against the ledger
entry, and assembles everything the `web` branch's root needs into
`release/_publish/`: the staged `release/vX.Y.Z/` folder, a *filtered*
`release/releases.json` (only entries already marked `"published": true`,
plus the version being released now, so the published page never links to
a version that only ever existed locally), `index.html`, and `.nojekyll`.
That folder is gitignored and disposable — regenerate it anytime by
rerunning `release.py`.

1. Fill in `release/vX.Y.Z/NOTES.md` first, if you want notes included —
   `release.py` just copies whatever's on disk when it runs, so notes added
   afterward won't make it into the bundle.
2. Build and run the pre-publish check:

   ```bash
   python -m build --wheel -C version=1.2.0 -C release=true
   python release.py --version 1.2.0
   ```

3. Checkout `web`, copy the *contents* of `release/_publish/` over its root
   (`release/vX.Y.Z/`, `release/releases.json`, `index.html`, `.nojekyll`),
   `git add -A`, commit, and push.
4. Set `"published": true` for that version in `web`'s
   `release/releases.json`, commit, and push again — so the ledger records
   it as actually live.
5. Back on `web-dev`, set the same version's `"published": true` in the
   local `release/releases.json` and commit it there too. `web-dev`'s
   ledger is the master record of every build, published or not — skipping
   this step is how the two ledgers drift out of agreement.

Published releases are immutable: don't hand-edit files on `web`, and bump
the version instead of restaging one that's already recorded (the build
backend refuses to overwrite a recorded version without explicit
confirmation).
