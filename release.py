#!/usr/bin/env python3
"""Assemble a ready-to-publish bundle for the web branch, which GitHub Pages
serves.

Development happens on web-dev, not web -- web is reserved for published
release content only, kept separate so source history and publish history
don't get mixed.

This script does *not* touch git at all -- no clone, no commit, no push.
It just validates the version, finds the already-staged release/vX.Y.Z/
files (wheel, .sha256, 3pslccacore.js, optional NOTES.md -- built by
`python -m build --wheel -C version=X.Y.Z -C release=true`, see
DEVELOPING.md), and assembles everything the web branch's root needs --
index.html, a filtered release/releases.json (only entries already marked
"published": true in the local ledger, plus the one being built now -- so
the published page never links to a version that only ever existed
locally), and the staged release/vX.Y.Z/ folder -- into release/_publish/
locally. Copy that folder's *contents* onto the web branch yourself
(checkout web, copy, `git add -A`, commit, push) -- that part is manual.

After you've actually pushed, flip this version's "published" field to
true in release/releases.json yourself, so future runs of this script
carry it forward into the filtered payload for later releases.

Usage, after a production wheel build:

    python -m build --wheel -C version=1.2.0 -C release=true
    python release.py --version 1.2.0
    # then: checkout web, copy release/_publish/* over it, commit, push
"""

import argparse
import json
import pathlib
import shutil
import sys

from packaging.version import InvalidVersion, Version

ROOT = pathlib.Path(__file__).resolve().parent
PACKAGE_NAME = "three_ps_lcca_core"
INDEX_HTML_FILE = ROOT / "index.html"
RELEASES_FILE = ROOT / "release" / "releases.json"
PUBLISH_DIR = ROOT / "release" / "_publish"


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--version",
        required=True,
        help="Version being released, e.g. 1.2.0 (must be a final, non-prerelease PEP 440 version).",
    )
    return parser.parse_args()


def fail(message):
    sys.exit(f"error: {message}")


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
    """The releases.json to publish: only entries already marked published,
    plus the one being built right now -- never a version that only ever
    existed in the local ledger."""
    published = [e for e in data["versions"] if e.get("kind") == "release" and e.get("published")]
    if not any(e.get("version") == str(version) for e in published):
        published.append(find_ledger_entry(data, version))
    return {"latest": str(version), "versions": published}


def main():
    args = parse_args()
    version = validate_version(args.version)
    wheel, sha_file, js_file, notes_file = find_staged_release(version)

    if not INDEX_HTML_FILE.is_file():
        fail(f"{INDEX_HTML_FILE.relative_to(ROOT)} not found.")
    local_data = load_local_releases()
    pages_releases = published_releases_payload(local_data, version)

    if PUBLISH_DIR.exists():
        shutil.rmtree(PUBLISH_DIR)
    release_dir = PUBLISH_DIR / "release" / f"v{version}"
    release_dir.mkdir(parents=True)
    shutil.copy2(wheel, release_dir / wheel.name)
    shutil.copy2(sha_file, release_dir / sha_file.name)
    shutil.copy2(js_file, release_dir / "3pslccacore.js")
    if notes_file:
        shutil.copy2(notes_file, release_dir / "NOTES.md")

    (PUBLISH_DIR / "release" / "releases.json").write_text(
        json.dumps(pages_releases, indent=2) + "\n", encoding="utf-8"
    )
    shutil.copy2(INDEX_HTML_FILE, PUBLISH_DIR / "index.html")
    (PUBLISH_DIR / ".nojekyll").touch()

    print(f"assembled at {PUBLISH_DIR.relative_to(ROOT).as_posix()}/:")
    for p in sorted(PUBLISH_DIR.rglob("*")):
        if p.is_file():
            print(f"  {p.relative_to(PUBLISH_DIR).as_posix()}")
    print(
        f"\nNext (manual): checkout web, copy {PUBLISH_DIR.relative_to(ROOT).as_posix()}/* over its "
        f"root, git add -A, commit, push. Afterward, set \"published\": true for {version} in "
        f"{RELEASES_FILE.relative_to(ROOT)} yourself."
    )


if __name__ == "__main__":
    main()
