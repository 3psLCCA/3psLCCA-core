#!/usr/bin/env python3
"""
build_brython.py
================
Builds an optimized, production-ready Brython package for 3psLCCA-core.

Features:
- Minifies all Python source code using python-minifier:
  * Strips docstrings, comments, and redundant literals
  * Folds constants and hoists repeated literals
  * Preserves dataclass field type annotations (required for Python dataclasses)
  * Preserves global symbol names (API endpoints like run_full_lcc_analysis)
- Bundles the minified Python files into a single Virtual File System (VFS) JS bundle:
  `three_ps_lcca_core.brython.js`
- Measures raw and Gzip sizes and compares with Pyodide wheel footprint.

Usage:
    python build_brython.py
"""

import os
import sys
import json
import gzip
import shutil
import tempfile
import python_minifier
from brython import make_package

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(ROOT_DIR, "src", "three_ps_lcca_core")
OUTPUT_BUNDLE = os.path.join(ROOT_DIR, "three_ps_lcca_core.brython.js")

def minify_source_tree(src_dir, dest_dir):
    """Recursively minifies Python files from src_dir into dest_dir."""
    total_orig = 0
    total_mini = 0
    file_count = 0

    for root, dirs, files in os.walk(src_dir):
        if "__pycache__" in dirs:
            dirs.remove("__pycache__")
        
        rel_path = os.path.relpath(root, src_dir)
        target_dir = os.path.join(dest_dir, rel_path) if rel_path != "." else dest_dir
        os.makedirs(target_dir, exist_ok=True)

        for f in files:
            src_file = os.path.join(root, f)
            dest_file = os.path.join(target_dir, f)

            if f.endswith(".py"):
                with open(src_file, "r", encoding="utf-8") as fp:
                    code = fp.read()
                
                orig_size = len(code.encode("utf-8"))
                total_orig += orig_size

                # Minify with aggressive size optimizations while preserving dataclass annotations
                minified = python_minifier.minify(
                    code,
                    remove_annotations=False,         # Required for dataclass fields
                    hoist_literals=True,              # Extract repeated strings/numbers
                    remove_literal_statements=True,   # Remove docstrings
                    combine_imports=True,
                    rename_globals=False,             # Keep public API names
                    preserve_shebang=False,
                )

                mini_size = len(minified.encode("utf-8"))
                total_mini += mini_size
                file_count += 1

                with open(dest_file, "w", encoding="utf-8") as fp:
                    fp.write(minified)
            else:
                shutil.copy2(src_file, dest_file)

    return file_count, total_orig, total_mini

def build(output_bundle=None):
    target_bundle = output_bundle or OUTPUT_BUNDLE
    print("=" * 65)
    print("  3psLCCA Core — Production Brython Package Builder")
    print("=" * 65)

    if not os.path.exists(SRC_DIR):
        print(f"Error: Source directory '{SRC_DIR}' does not exist.")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as staging_dir:
        staging_pkg = os.path.join(staging_dir, "three_ps_lcca_core")
        print(f"[*] Step 1: Minifying Python source tree...")
        count, orig_bytes, mini_bytes = minify_source_tree(SRC_DIR, staging_pkg)
        reduction = (1 - (mini_bytes / orig_bytes)) * 100 if orig_bytes else 0
        print(f"    - Minified {count} Python files.")
        print(f"    - Raw Python size: {orig_bytes / 1024:.2f} KB -> {mini_bytes / 1024:.2f} KB ({reduction:.1f}% reduction)")

        print(f"[*] Step 2: Packaging into Brython VFS bundle...")
        make_package.make(
            package_name="three_ps_lcca_core",
            package_path=staging_pkg,
            output_path=target_bundle
        )

    # Calculate bundle stats
    bundle_size = os.path.getsize(target_bundle)
    with open(target_bundle, "rb") as fp:
        gzip_size = len(gzip.compress(fp.read(), compresslevel=9))

    print("\n" + "=" * 65)
    print("  Build Succeeded!")
    print("=" * 65)
    print(f"Output File : {os.path.basename(target_bundle)}")
    print(f"Raw Size    : {bundle_size / 1024:.2f} KB ({bundle_size:,} bytes)")
    print(f"Gzip Size   : {gzip_size / 1024:.2f} KB ({gzip_size:,} bytes)")
    print("=" * 65)
    print(f"\nReady for in-browser use via <script src=\"{os.path.basename(target_bundle)}\"></script>.\n")
    return bundle_size, gzip_size

if __name__ == "__main__":
    build()

