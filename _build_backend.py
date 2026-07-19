"""PEP 517 backend wrapping setuptools.build_meta to require an explicit version.

This project has no automatic version source (no git-tag/scm derivation).
Every build must pass the version as a config-setting:

    python -m build --wheel -C version=1.2.0.dev0
    pip wheel . --no-deps -C version=1.2.0.dev0

The value is written to VERSION (gitignored), which pyproject.toml's
`[tool.setuptools.dynamic] version = {file = "VERSION"}` then reads. Omitting
-C version fails the build immediately instead of silently producing an
unversioned wheel.

Final (non-pre-release) PEP 440 versions -- e.g. 1.2.0, as opposed to
1.2.0.dev0 / 1.2.0rc1 -- are treated as production releases and are
rejected unless -C release=true is also passed:

    python -m build --wheel -C version=1.2.0 -C release=true

This mirrors the standard packaging convention where pre-release identifiers
mark a build as not-for-production (pip won't install them without --pre)
and keeps a stamped "final" wheel from being produced by accident on a dev
machine.

Any build made with -C release=true is also appended to releases.json's
"versions" array (committed, unlike VERSION) with its version, kind
(prerelease/release), sha256, and the git commit it was built from -- a
ledger of builds the user explicitly flagged as meaningful, independent of
whether they were ever published via release.py. -C release=true is
required to build a final version at all, but can also be passed with a
pre-release version (e.g. 1.2.0.dev0 -C release=true) to log a checkpoint
build without it counting as a production release. Routine pre-release/dev
builds without the flag are not logged.

releases.json is shaped {"latest": "X.Y.Z" | null, "versions": [...]}.
After a confirmed *final* release build, you're asked "Make X the latest
release?" on an interactive terminal; only an explicit yes overwrites
"latest" (declining, or no attached terminal, leaves it untouched).
Pre-release checkpoint builds never touch "latest" -- that concept only
applies to actual releases.

Rebuilding an already-recorded version defaults to refusing (wheels aren't
byte-reproducible, so this is almost always an accidentally-unbumped
version) but prompts for an explicit y/N confirmation on an interactive
terminal; confirming once covers both the releases.json entry and the
staged release/ folder for that version. Non-interactive builds (CI, no
attached terminal) always refuse rather than block.

A confirmed *final* release build (release=true on a non-pre-release
version) additionally stages release/vX.Y.Z/ locally: a copy of the wheel,
its .sha256, and 3pslccacore.js rendered from 3pslccacore.template.js (the
repo-root template) with RELEASE_WHEEL_URL filled in. Staged
release/vX.Y.Z/ folders are disposable local output, never committed on
web-dev (only release/releases.json is) -- a staging area, not the publish
step. release.py picks up this already-assembled folder and bundles it
into release/_publish/, whose contents are then copied manually onto the
web branch (the one GitHub Pages serves; development happens on web-dev
instead); it no longer renders 3pslccacore.js itself. On an
interactive terminal you're also asked whether to add a
NOTES.md -- an empty scaffold file is created (content is hand-edited
afterward, not collected here), and the entry's "notes" field is set true
so index.html knows to link it.

RELEASE_WHEEL_URL is rendered as a *fully-qualified* URL (github.io Pages
origin, derived from `git remote get-url origin`), not a bare filename --
deliberately, so the wheel resolves correctly even if the embedding page's
script tag doesn't populate document.currentScript (dynamic insertion,
module scripts, some bundlers) or the page is served from a different
origin than the release. releases.json's release-kind entries record
that same computed URL, plus the sha256 of *both* staged files (wheel_sha256
and js_sha256) -- enough for an HTML page to link/verify a release without
recomputing anything. Every entry also starts with "published": false;
you flip it to true by hand after actually pushing the release to the web
branch, so index.html (via release.py, which only ever publishes
published-or-current entries) never links to a version that isn't really
there.
"""

import datetime
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

from packaging.version import InvalidVersion, Version
from setuptools import build_meta as _orig

ROOT = pathlib.Path(__file__).resolve().parent
VERSION_FILE = ROOT / "VERSION"
VERIFY_SCRIPT = ROOT / "verify_releases.py"
RELEASE_DIR = ROOT / "release"
RELEASES_FILE = RELEASE_DIR / "releases.json"
JS_TEMPLATE_FILE = ROOT / "3pslccacore.template.js"
RELEASE_URL_PATTERN = re.compile(r'const RELEASE_WHEEL_URL = "[^"]*";')

get_requires_for_build_sdist = _orig.get_requires_for_build_sdist
get_requires_for_build_wheel = _orig.get_requires_for_build_wheel
get_requires_for_build_editable = _orig.get_requires_for_build_editable


_TRUE_STRINGS = {"1", "true", "yes", "on"}


def _stamp_version(config_settings):
    config_settings = config_settings or {}
    version = config_settings.get("version")
    if not version:
        raise SystemExit(
            "error: missing -C version=X.Y.Z "
            "(e.g. `python -m build --wheel -C version=1.2.0.dev0`) -- "
            "this project has no automatic version source."
        )
    try:
        parsed = Version(version)
    except InvalidVersion as exc:
        raise SystemExit(
            f"error: -C version='{version}' is not a valid PEP 440 version ({exc}). "
            "Expected e.g. 1.2.0, 1.2.0rc1, or 1.2.0.dev0."
        ) from exc

    release = str(config_settings.get("release", "")).strip().lower() in _TRUE_STRINGS
    if not parsed.is_prerelease and not release:
        raise SystemExit(
            f"error: -C version='{version}' is a final release version. "
            "Dev builds must use a pre-release version (e.g. 1.2.0.dev0, "
            "1.2.0rc1) -- pass -C release=true to explicitly confirm a "
            "production build."
        )

    VERSION_FILE.write_text(str(parsed), encoding="utf-8")
    return parsed, release


def _git_commit():
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return result.stdout.strip()


_GITHUB_REMOTE_RE = re.compile(r"^(?:https://github\.com/|git@github\.com:)([^/]+)/(.+?)(?:\.git)?/?$")


def _pages_base_url():
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "remote", "get-url", "origin"],
            capture_output=True, text=True, check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise SystemExit(
            "error: could not read git remote 'origin' -- needed to compute "
            f"the release's public URL: {exc}"
        ) from exc
    remote = result.stdout.strip()
    match = _GITHUB_REMOTE_RE.match(remote)
    if not match:
        raise SystemExit(
            f"error: git remote 'origin' ({remote}) doesn't look like a GitHub "
            "remote -- can't compute a github.io Pages URL for the release."
        )
    owner, repo = match.group(1), match.group(2)
    return f"https://{owner}.github.io/{repo}"


def _sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


_confirmed_overwrites = set()


def _confirm_overwrite(version_key, message):
    if version_key in _confirmed_overwrites:
        return True
    if not sys.stdin.isatty():
        # No attached terminal (CI, some IDE build integrations) -- don't
        # block waiting for input that will never come; default to refusing.
        return False
    try:
        answer = input(f"{message} Overwrite? [y/N] ").strip().lower()
    except (EOFError, OSError):
        return False
    confirmed = answer in ("y", "yes")
    if confirmed:
        _confirmed_overwrites.add(version_key)
    return confirmed


def _load_history():
    if not RELEASES_FILE.is_file():
        return {"latest": None, "versions": []}
    try:
        history = json.loads(RELEASES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"error: {RELEASES_FILE.name} is not valid JSON ({exc}) -- "
            "fix or remove it before building."
        ) from exc
    if not isinstance(history, dict) or not isinstance(history.get("versions"), list):
        raise SystemExit(
            f'error: {RELEASES_FILE.name} must be a JSON object shaped like '
            '{"latest": null, "versions": []}.'
        )
    history.setdefault("latest", None)
    return history


def _confirm_latest(parsed_version, current_latest):
    if not sys.stdin.isatty():
        return False
    note = ""
    if current_latest:
        try:
            if Version(current_latest) > parsed_version:
                note = f" (current latest is {current_latest}, which is newer than {parsed_version})"
        except InvalidVersion:
            pass
    try:
        answer = input(f"\nMake {parsed_version} the latest release?{note} [y/N] ").strip().lower()
    except (EOFError, OSError):
        return False
    return answer in ("y", "yes")


def _record_build(directory, filename, parsed_version, release_confirmed,
                   sha256=None, path=None, url=None, js_sha256=None, notes=None):
    if not release_confirmed:
        return None
    if sha256 is None:
        sha256 = _sha256_file(pathlib.Path(directory) / filename)
    history = _load_history()
    versions = history["versions"]

    for i, existing in enumerate(versions):
        if existing.get("version") == str(parsed_version):
            # Wheel builds aren't byte-reproducible (dist-info/RECORD and
            # WHEEL embed a fresh build timestamp every time), so sha256
            # differs even for an unchanged source tree -- there's no
            # reliable way to tell "identical rebuild" from "changed
            # content" here. Refuse by default, same as release.py's
            # immutable release directories: bump the version instead,
            # unless explicitly confirmed otherwise.
            if not _confirm_overwrite(
                str(parsed_version),
                f"version '{parsed_version}' is already recorded in "
                f"{RELEASES_FILE.name} (sha256 {existing.get('wheel_sha256', '?')[:12]}...).",
            ):
                raise SystemExit(
                    f"error: version '{parsed_version}' is already recorded in "
                    f"{RELEASES_FILE.name}. Versions must be immutable -- "
                    "bump the version instead of rebuilding an already-recorded one."
                )
            del versions[i]
            break

    entry = {
        "version": str(parsed_version),
        "kind": "prerelease" if parsed_version.is_prerelease else "release",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "filename": filename,
        "path": path,
        "url": url,
        "wheel_sha256": sha256,
        "js_sha256": js_sha256,
        "notes": notes,
        "commit": _git_commit(),
        # Flipped to True by hand only after this version is actually pushed
        # to the web branch -- staging/recording here means "built", not
        # "published".
        "published": False,
    }
    versions.append(entry)

    # "Latest release" is only meaningful for confirmed final releases, not
    # dev/prerelease checkpoint builds. Declining, or no attached terminal,
    # leaves whatever "latest" already was untouched -- only an explicit yes
    # ever overwrites it.
    if not parsed_version.is_prerelease and _confirm_latest(parsed_version, history["latest"]):
        history["latest"] = str(parsed_version)

    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    RELEASES_FILE.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    _maybe_prompt_verify(parsed_version)
    return sha256


def _render_release_js(wheel_url):
    src = JS_TEMPLATE_FILE.read_text(encoding="utf-8")
    rendered, count = RELEASE_URL_PATTERN.subn(
        f'const RELEASE_WHEEL_URL = "{wheel_url}";', src
    )
    if count != 1:
        raise SystemExit(
            f"error: expected exactly one RELEASE_WHEEL_URL declaration in "
            f"{JS_TEMPLATE_FILE.name}, found {count}. The file may have changed "
            "shape -- update RELEASE_URL_PATTERN in _build_backend.py to match."
        )
    return rendered


def _stage_release(wheel_directory, filename, parsed_version):
    release_dir = RELEASE_DIR / f"v{parsed_version}"
    if release_dir.exists():
        if not _confirm_overwrite(
            str(parsed_version),
            f"{release_dir.relative_to(ROOT).as_posix()}/ already exists.",
        ):
            raise SystemExit(
                f"error: {release_dir.relative_to(ROOT)} already exists -- releases "
                "are immutable, bump the version instead of restaging one."
            )
        shutil.rmtree(release_dir)
    release_dir.mkdir(parents=True)

    sha256 = _sha256_file(pathlib.Path(wheel_directory) / filename)
    shutil.copy2(pathlib.Path(wheel_directory) / filename, release_dir / filename)
    (release_dir / f"{filename}.sha256").write_text(f"{sha256}  {filename}\n", encoding="utf-8")

    base_url = _pages_base_url()
    path = f"release/v{parsed_version}"
    url = f"{base_url}/{path}"
    js_path = release_dir / "3pslccacore.js"
    # newline="\n" pins the on-disk bytes to LF regardless of platform --
    # without it, write_text translates \n -> \r\n on Windows, and git (which
    # normalizes text files to LF) stores/serves different bytes than what
    # got hashed below, so js_sha256 would match the local file but not the
    # one GitHub Pages actually serves.
    js_path.write_text(_render_release_js(f"{url}/{filename}"), encoding="utf-8", newline="\n")
    js_sha256 = _sha256_file(js_path)

    notes = _prompt_notes(parsed_version)
    if notes:
        (release_dir / "NOTES.md").touch()

    print(f"staged release at {release_dir.relative_to(ROOT).as_posix()}/ ({url})")
    return sha256, path, url, js_sha256, notes


def _prompt_notes(parsed_version):
    # Just creates an empty scaffold file -- content is hand-edited
    # afterward, not collected here.
    if not sys.stdin.isatty():
        return False
    try:
        answer = input(f"\nAdd a NOTES.md for {parsed_version}? [y/N] ").strip().lower()
    except (EOFError, OSError):
        return False
    return answer in ("y", "yes")


_already_prompted = False


def _maybe_prompt_verify(parsed_version):
    global _already_prompted
    if _already_prompted:
        return
    _already_prompted = True
    if not sys.stdin.isatty():
        # No attached terminal (CI, some IDE build integrations) -- don't
        # block waiting for input that will never come.
        return
    try:
        answer = input(
            f"\nBuilt release {parsed_version}. Run verify_releases.py now? [y/N] "
        ).strip().lower()
    except (EOFError, OSError):
        return
    if answer in ("y", "yes"):
        subprocess.run([sys.executable, str(VERIFY_SCRIPT)])


def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):
    _stamp_version(config_settings)
    return _orig.prepare_metadata_for_build_wheel(metadata_directory, config_settings)


def prepare_metadata_for_build_editable(metadata_directory, config_settings=None):
    _stamp_version(config_settings)
    return _orig.prepare_metadata_for_build_editable(metadata_directory, config_settings)


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    parsed, release_confirmed = _stamp_version(config_settings)
    filename = _orig.build_wheel(wheel_directory, config_settings, metadata_directory)
    sha256 = path = url = js_sha256 = notes = None
    if release_confirmed and not parsed.is_prerelease:
        # Staged first, recorded second: the ledger entry should only ever
        # claim a path/url that was actually assembled successfully.
        sha256, path, url, js_sha256, notes = _stage_release(wheel_directory, filename, parsed)
    _record_build(wheel_directory, filename, parsed, release_confirmed, sha256, path, url, js_sha256, notes)
    return filename


def build_sdist(sdist_directory, config_settings=None):
    parsed, release_confirmed = _stamp_version(config_settings)
    filename = _orig.build_sdist(sdist_directory, config_settings)
    _record_build(sdist_directory, filename, parsed, release_confirmed)
    return filename


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    parsed, release_confirmed = _stamp_version(config_settings)
    filename = _orig.build_editable(wheel_directory, config_settings, metadata_directory)
    _record_build(wheel_directory, filename, parsed, release_confirmed)
    return filename
