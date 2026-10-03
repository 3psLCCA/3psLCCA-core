# 3psLCCA Core

Python package for performing **Life Cycle Cost Analysis (LCCA)** on bridge structures, with support for road user cost, carbon emission cost, maintenance, and end-of-life stage costs.

## Installation

```bash
pip install git+https://github.com/swas02/3psLCCA-core.git@main
```

Or a specific release:

```bash
pip install git+https://github.com/swas02/3psLCCA-core.git@v1.0.0
```

## Requirements

- Python >= 3.12

## Usage

```python
from three_ps_lcca_core.core.main import run_full_lcc_analysis
```

See `src/examples/` for complete input examples.

## Browser / Client-Side Web Deployment

The library supports running 100% in-browser without a backend Python server:

- **Brython (Recommended)**: 93 KB bundle (23.5 KB Gzip), instant ~400 ms load, ~5–9 ms execution. See [BRYTHON.md](BRYTHON.md) for build instructions, benchmarks, and integration guides.
- **Pyodide**: WebAssembly distribution for Pyodide v0.26+. See [index.html](index.html) and [pyodide_test.html](pyodide_test.html).
