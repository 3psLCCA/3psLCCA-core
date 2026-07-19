#!/usr/bin/env python3
"""Verify releases.json against the wheels sitting in dist/ and release/.

releases.json is shaped {"latest": "X.Y.Z" | null, "versions": [...]}.
"latest", if set, must reference an entry actually present in "versions".

For each entry in "versions": if dist/<filename> exists, its sha256 is
recomputed and compared to wheel_sha256; if release-kind and path/release/
vX.Y.Z/ exists, the staged wheel and 3pslccacore.js copies are checked the
same way against wheel_sha256/js_sha256. Files that aren't present locally
are skipped, not flagged -- dist/ and staged release/vX.Y.Z/ folders are
disposable local build output, safe to delete anytime (see DEVELOPER.md),
so a missing file just means there's nothing to check for it, not that
something is wrong.

Usage:

    python verify_releases.py
"""

import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RELEASE_DIR = ROOT / "release"
RELEASES_FILE = RELEASE_DIR / "releases.json"
DIST_DIR = ROOT / "dist"


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check(label, path, expected_sha256, counters, mismatches):
    if expected_sha256 is None or not path.is_file():
        counters["skipped"] += 1
        return
    counters["checked"] += 1
    actual = sha256_file(path)
    if actual == expected_sha256:
        print(f"  {label}: OK ({path.relative_to(ROOT).as_posix()})")
    else:
        mismatches.append(
            f"{label}: {path.relative_to(ROOT).as_posix()} sha256 mismatch "
            f"(recorded {expected_sha256[:12]}..., actual {actual[:12]}...)"
        )


def main():
    if not RELEASES_FILE.is_file():
        sys.exit(f"error: {RELEASES_FILE} not found.")
    data = json.loads(RELEASES_FILE.read_text(encoding="utf-8"))
    history = data["versions"]
    latest = data.get("latest")

    print(f"latest: {latest or '(unset)'}")
    if latest is not None and not any(e.get("version") == latest for e in history):
        sys.exit(f'error: "latest" is {latest!r} but no entry with that version exists in "versions".')

    counters = {"checked": 0, "skipped": 0}
    mismatches = []
    for entry in history:
        version = entry["version"]
        _check(version, DIST_DIR / entry["filename"], entry.get("wheel_sha256"), counters, mismatches)
        if entry.get("path"):
            release_dir = ROOT / entry["path"]
            _check(f"{version} (staged wheel)", release_dir / entry["filename"],
                   entry.get("wheel_sha256"), counters, mismatches)
            _check(f"{version} (staged 3pslccacore.js)", release_dir / "3pslccacore.js",
                   entry.get("js_sha256"), counters, mismatches)

    print(f"\nchecked {counters['checked']}, skipped {counters['skipped']} (not present locally)")
    if mismatches:
        for m in mismatches:
            print(f"  ! {m}")
        sys.exit(f"\n{len(mismatches)} mismatch(es) found.")
    print("releases.json OK.")


if __name__ == "__main__":
    main()
