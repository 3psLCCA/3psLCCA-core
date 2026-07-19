#!/usr/bin/env python3
"""Publish a staged release to the feature/js-client-delivery GitHub Pages
branch.

This is the *only* thing that should ever write to that branch. Not every
commit is a release -- there's exactly one path to publishing: this script,
run once per version. Don't hand-edit files on that branch directly (see
plan.md) -- past experience doing that by hand got a working directory's
branch flipped out from under an in-progress edit.

It works entirely in a throwaway temp clone of feature/js-client-delivery --
it never checks out that branch, or touches the branch you have checked out,
in this repo's own working directory. The temp clone is deleted before the
script exits either way.

It doesn't build or render anything itself -- a confirmed release build
(`python -m build --wheel -C version=X.Y.Z -C release=true`) already has
_build_backend.py stage the wheel, its .sha256, and a rendered
3pslccacore.js into release/vX.Y.Z/ locally, plus record a matching entry
in release/releases.json (all gitignored except releases.json itself, see
DEVELOPING.md). This script copies that already-assembled folder onto the
pages branch, alongside a filtered releases.json (only entries already
marked "published": true, plus the one being published now -- so the
published page never links to a version that only ever existed locally)
and this repo's index.html (a static page that reads that releases.json;
not templated, just copied as-is).

Usage, after a production wheel build (see DEVELOPING.md):

    python -m build --wheel -C version=1.2.0 -C release=true
    python release.py --version 1.2.0            # commits in a temp clone, doesn't push
    python release.py --version 1.2.0 --push      # rerun with --push once you're satisfied

Without --push, nothing on origin changes -- the printed commit summary is
your review step. Rerun with --push once you're satisfied (this re-does the
temp clone + commit; that's cheap and deterministic for the same inputs).
Only on a successful --push is release/releases.json's local entry for this
version flipped to "published": true -- a dry run never touches it.
"""

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

from packaging.version import InvalidVersion, Version

ROOT = pathlib.Path(__file__).resolve().parent
PACKAGE_NAME = "three_ps_lcca_core"
PAGES_BRANCH = "feature/js-client-delivery"
BOT_AUTHOR = "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>"
INDEX_HTML_FILE = ROOT / "index.html"
RELEASES_FILE = ROOT / "release" / "releases.json"


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--version",
        required=True,
        help="Version being released, e.g. 1.2.0 (must be a final, non-prerelease PEP 440 version).",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Push the release commit to origin. Without this, the commit is made and shown in a temp clone, then discarded.",
    )
    return parser.parse_args()


def fail(message):
    sys.exit(f"error: {message}")


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=True, **kwargs)


def validate_version(raw):
    try:
        version = Version(raw)
    except InvalidVersion as exc:
        fail(f"--version '{raw}' is not a valid PEP 440 version ({exc}).")
    if version.is_prerelease:
        fail(
            f"--version '{raw}' is a pre-release. Releasing only ships final versions "
            "-- build with -C release=true first (see DEVELOPING.md)."
        )
    return version


def find_staged_release(version):
    release_dir = ROOT / "release" / f"v{version}"
    if not release_dir.is_dir():
        fail(
            f"no staged release at release/v{version}/. Build it first:\n"
            f"  python -m build --wheel -C version={version} -C release=true"
        )

    wheels = sorted(release_dir.glob(f"{PACKAGE_NAME}-{version}-*.whl"))
    if not wheels:
        fail(f"release/v{version}/ has no wheel matching {PACKAGE_NAME}-{version}-*.whl.")
    if len(wheels) > 1:
        fail(f"release/v{version}/ has multiple wheels: {wheels}. Clean it and rebuild.")
    wheel = wheels[0]

    sha_file = release_dir / f"{wheel.name}.sha256"
    js_file = release_dir / "3pslccacore.js"
    if not sha_file.is_file():
        fail(f"release/v{version}/ is missing {wheel.name}.sha256.")
    if not js_file.is_file():
        fail(f"release/v{version}/ is missing 3pslccacore.js.")

    notes_file = release_dir / "NOTES.md"
    if not notes_file.is_file():
        notes_file = None  # optional -- not every release has "what's new" notes

    return wheel, sha_file, js_file, notes_file


def origin_url():
    result = run(["git", "-C", str(ROOT), "remote", "get-url", "origin"], capture_output=True, text=True)
    return result.stdout.strip()


def load_local_releases():
    if not RELEASES_FILE.is_file():
        fail(f"{RELEASES_FILE.relative_to(ROOT)} not found. Build a release first (see DEVELOPING.md).")
    try:
        data = json.loads(RELEASES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"{RELEASES_FILE.relative_to(ROOT)} is not valid JSON ({exc}).")
    if not isinstance(data, dict) or not isinstance(data.get("versions"), list):
        fail(f'{RELEASES_FILE.relative_to(ROOT)} must be a JSON object shaped like {{"latest": null, "versions": []}}.')
    return data


def find_ledger_entry(data, version):
    for entry in data["versions"]:
        if entry.get("version") == str(version):
            return entry
    fail(
        f"no entry for version {version} in {RELEASES_FILE.relative_to(ROOT)}. Build it first:\n"
        f"  python -m build --wheel -C version={version} -C release=true"
    )


def published_releases_payload(data, version):
    """The releases.json to publish: only entries already live on the pages
    branch, plus the one being published right now -- never a version that
    only ever existed in the local ledger."""
    published = [e for e in data["versions"] if e.get("kind") == "release" and e.get("published")]
    if not any(e.get("version") == str(version) for e in published):
        published.append(find_ledger_entry(data, version))
    return {"latest": str(version), "versions": published}


def main():
    args = parse_args()
    version = validate_version(args.version)
    wheel, sha_file, js_file, notes_file = find_staged_release(version)
    checksum = sha_file.read_text(encoding="utf-8").split()[0]

    if not INDEX_HTML_FILE.is_file():
        fail(f"{INDEX_HTML_FILE.relative_to(ROOT)} not found.")
    local_data = load_local_releases()
    entry = find_ledger_entry(local_data, version)
    pages_releases = published_releases_payload(local_data, version)

    with tempfile.TemporaryDirectory(prefix="3pslcca-release-") as tmp:
        tmp = pathlib.Path(tmp) / "clone"
        run(
            ["git", "clone", "--quiet", "--branch", PAGES_BRANCH, "--single-branch", origin_url(), str(tmp)]
        )
        branch = run(
            ["git", "-C", str(tmp), "branch", "--show-current"], capture_output=True, text=True
        ).stdout.strip()
        if branch != PAGES_BRANCH:
            fail(f"cloned branch is '{branch}', expected '{PAGES_BRANCH}'.")

        release_dir = tmp / "release" / f"v{version}"
        if release_dir.exists():
            fail(f"v{version} already exists on {PAGES_BRANCH} -- releases are immutable. Bump the version instead.")

        release_dir.mkdir(parents=True)
        shutil.copy2(wheel, release_dir / wheel.name)
        shutil.copy2(sha_file, release_dir / sha_file.name)
        shutil.copy2(js_file, release_dir / "3pslccacore.js")
        if notes_file:
            shutil.copy2(notes_file, release_dir / "NOTES.md")

        (tmp / "release" / "releases.json").write_text(
            json.dumps(pages_releases, indent=2) + "\n", encoding="utf-8"
        )
        shutil.copy2(INDEX_HTML_FILE, tmp / "index.html")
        nojekyll = tmp / ".nojekyll"
        if not nojekyll.exists():
            nojekyll.touch()

        run(["git", "-C", str(tmp), "add", "-A"])
        run(
            [
                "git", "-C", str(tmp), "commit",
                "--author", BOT_AUTHOR,
                "-m", f"Release v{version}",
            ]
        )

        print(f"committed in temp clone ({wheel.name}, sha256={checksum[:12]}...):\n")
        run(["git", "-C", str(tmp), "show", "--stat", "HEAD"])

        if args.push:
            run(["git", "-C", str(tmp), "push"])
            print(f"\npushed v{version} to {PAGES_BRANCH} on origin.")
            entry["published"] = True
            RELEASES_FILE.write_text(json.dumps(local_data, indent=2) + "\n", encoding="utf-8")
            print(f"marked v{version} as published in {RELEASES_FILE.relative_to(ROOT)}.")
        else:
            print(f"\nnot pushed. Review the summary above, then rerun with --push to publish v{version}.")


if __name__ == "__main__":
    main()
