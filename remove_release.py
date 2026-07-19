#!/usr/bin/env python3
"""Remove a release: its release/vX.Y.Z/ folder and its releases.json entry.

The inverse of a `-C release=true` build's staging step. For each version
given it deletes the staged release/v<version>/ folder (if present) and
drops the matching entry from release/releases.json. If the removed version
was "latest", latest is reset to the newest remaining final release (or
null when none are left).

Local-tree operation only -- it does not touch git, dist/, or anything
already pushed; a version that is live on the web branch stays live until
that branch is updated (the script warns when removing a published entry).

Usage:

    python remove_release.py 1.0.2.dev2
    python remove_release.py 1.0.0 1.0.1 --yes
"""

import argparse
import json
import pathlib
import shutil
import sys

from packaging.version import InvalidVersion, Version

ROOT = pathlib.Path(__file__).resolve().parent
RELEASE_DIR = ROOT / "release"
RELEASES_FILE = RELEASE_DIR / "releases.json"


def fail(message):
    sys.exit(f"error: {message}")


def parse_args():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("versions", nargs="+", help="Version(s) to remove, e.g. 1.0.2.dev2")
    parser.add_argument(
        "-y", "--yes", action="store_true",
        help="Skip the confirmation prompt (required when no terminal is attached).",
    )
    return parser.parse_args()


def load_ledger():
    if not RELEASES_FILE.is_file():
        fail(f"{RELEASES_FILE.relative_to(ROOT)} not found.")
    try:
        data = json.loads(RELEASES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"{RELEASES_FILE.relative_to(ROOT)} is not valid JSON ({exc}).")
    if not isinstance(data, dict) or not isinstance(data.get("versions"), list):
        fail(
            f"{RELEASES_FILE.relative_to(ROOT)} must be a JSON object shaped like "
            '{"latest": null, "versions": []}.'
        )
    return data


def recompute_latest(entries):
    """Newest remaining *final* release, or None -- "latest" never means a
    prerelease, matching _build_backend.py."""
    finals = []
    for e in entries:
        if e.get("kind") != "release":
            continue
        try:
            finals.append(Version(e["version"]))
        except InvalidVersion:
            continue
    return str(max(finals)) if finals else None


def confirm(prompt):
    if not sys.stdin.isatty():
        fail("no terminal attached for the confirmation prompt -- pass --yes.")
    try:
        return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")
    except (EOFError, KeyboardInterrupt):
        return False


def main():
    args = parse_args()
    data = load_ledger()
    entries = data["versions"]
    by_version = {e.get("version"): e for e in entries}

    targets = []
    for raw in args.versions:
        entry = by_version.get(raw)
        folder = RELEASE_DIR / f"v{raw}"
        if entry is None and not folder.is_dir():
            fail(f"nothing to remove for '{raw}': no ledger entry and no {folder.relative_to(ROOT).as_posix()}/.")
        targets.append((raw, entry, folder))

    print("will remove:")
    for raw, entry, folder in targets:
        bits = []
        if entry is not None:
            bits.append("ledger entry")
            if entry.get("published"):
                bits.append("PUBLISHED -- stays live on the web branch until that branch is updated")
        if folder.is_dir():
            bits.append(f"{folder.relative_to(ROOT).as_posix()}/")
        print(f"  {raw}: {', '.join(bits)}")

    if not args.yes and not confirm("Proceed?"):
        sys.exit("aborted.")

    removed = {raw for raw, _, _ in targets}
    data["versions"] = [e for e in entries if e.get("version") not in removed]
    if data.get("latest") in removed:
        data["latest"] = recompute_latest(data["versions"])
        print(f'latest -> {data["latest"] or "null"}')

    for raw, _, folder in targets:
        if folder.is_dir():
            shutil.rmtree(folder)
            print(f"deleted {folder.relative_to(ROOT).as_posix()}/")

    RELEASES_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"updated {RELEASES_FILE.relative_to(ROOT).as_posix()} ({len(data['versions'])} entries).")


if __name__ == "__main__":
    main()
