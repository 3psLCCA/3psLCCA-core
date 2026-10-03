# 3psLCCA Core — In-Browser Brython Guide

This guide documents how to build, optimize, and consume the **production-level Brython distribution** of `three_ps_lcca_core` for client-side web applications.

---

## 1. Overview & Architecture

`three_ps_lcca_core` can run entirely in client-side web browsers without a backend Python server. 

While **Pyodide** runs Python via WebAssembly, it requires downloading a full CPython runtime (~7 MB Wasm + dependencies) and takes 7+ seconds to boot. **Brython** (Python 3 in the browser) transpiles Python directly into JavaScript, providing an ultra-lightweight, zero-install alternative:

| Metric | Pyodide (Wasm) | Brython (Production Bundle) |
| :--- | :--- | :--- |
| **Package Download Size** | ~7.5 MB (Wasm + Stdlib + Wheel) | **93 KB raw (23.5 KB Gzip)** |
| **Initial Boot / Transpile** | ~6,900 – 7,500 ms | **~400 ms** (cached) / ~1,700 ms (cold) |
| **Cold Execution Time** | ~13 – 21 ms | **~15 – 26 ms** |
| **Warm Execution Time** | ~7 – 10 ms | **~5 – 9 ms** |
| **RAM Footprint (JS Heap)** | ~15 – 22 MB | ~45 – 75 MB |
| **External Dependencies** | WebAssembly, micropip | None (vanilla JS scripts) |

---

## 2. Prerequisites

To build the production bundle from the Python source tree, install the following build dependencies:

```bash
pip install brython python-minifier
```

* **`brython`**: Provides the Virtual File System (VFS) packager (`brython.make_package`).
* **`python-minifier`**: Performs AST-level compression, docstring stripping, and literal hoisting.

---

## 3. How to Build the Production Bundle

The repository includes an automated build script: [`build_brython.py`](file:///C:/Users/Swas/Documents/GitHub/3psLCCA-core/build_brython.py).

### Run the Build Command:

```bash
python build_brython.py
```

### What the Build Script Does:
1. **Aggressive Python Minification**:
   - Recursively processes all 57 Python files in `src/three_ps_lcca_core/`.
   - Strips docstrings, developer comments, and redundant literals (`remove_literal_statements=True`).
   - Folds constants and hoists repeated literals (`hoist_literals=True`).
   - Combines imports and shortens local variable names.
   - **Crucial**: Preserves `@dataclass` field type annotations (`remove_annotations=False`), ensuring runtime compatibility with Python dataclasses and validators.
   - Preserves public function names (`rename_globals=False`).
   - Reduces raw Python source from **~237 KB down to 81 KB (65.7% compression)**.
2. **Brython VFS Packaging**:
   - Packs the minified modules into a single JavaScript file: `three_ps_lcca_core.brython.js`.
   - Generates an indexed in-memory package loaded via `__BRYTHON__.loadBrythonPackage(...)`.
   - Produces a production artifact of **~93 KB uncompressed (23.5 KB Gzip)**.

---

## 4. How to Use in the Browser

### Step 1: Include Scripts in `<head>`

Load Brython 3.14+ runtime and the production package bundle:

```html
<!-- 1. Brython Core Engine -->
<script src="https://cdn.jsdelivr.net/npm/brython@3.14.3/brython.min.js"></script>

<!-- 2. Brython Standard Library -->
<script src="https://cdn.jsdelivr.net/npm/brython@3.14.3/brython_stdlib.js"></script>

<!-- 3. 3psLCCA Core Production Bundle (93 KB) -->
<script src="three_ps_lcca_core.brython.js"></script>
```

### Step 2: Initialize Brython on `<body>`

Use `debug: 0` for optimal production performance (suppresses debug stack inspection):

```html
<body onload="brython({debug: 0})">
```

### Step 3: Run Analysis from Python (`<script type="text/python">`)

```html
<script type="text/python">
import json
from browser import document, bind, window
from three_ps_lcca_core.core.main import run_full_lcc_analysis, get_IRC_standard_suggestions

# Sample inputs
input_global = {
    "general_parameters": {
        "service_life_years": 75,
        "analysis_period_years": 150,
        "discount_rate_percent": 6.7,
        "inflation_rate_percent": 5.15,
        "interest_rate_percent": 7.75,
        "investment_ratio": 0.5,
        "social_cost_of_carbon_per_mtco2e": 86.4,
        "currency_conversion": 88.73,
        "construction_period_months": 5.2,
        "working_days_per_month": 26,
        "days_per_month": 30,
        "use_global_road_user_calculations": True,
    },
    "daily_road_user_cost_with_vehicular_emissions": {
        "total_daily_ruc": 128618.886,
        "total_carbon_emission": {
            "total_emission_kgCO2e": 772.24519225,
        },
    },
    "maintenance_and_stage_parameters": {
        "use_stage_cost": {
            "routine": {
                "inspection": {"percentage_of_initial_construction_cost_per_year": 0.1, "interval_in_years": 1},
                "maintenance": {"percentage_of_initial_construction_cost_per_year": 0.55, "percentage_of_initial_carbon_emission_cost": 0.55, "interval_in_years": 5},
            },
            "major": {
                "inspection": {"percentage_of_initial_construction_cost": 0.5, "interval_for_repair_and_rehabitation_in_years": 5},
                "repair": {"percentage_of_initial_construction_cost": 10, "percentage_of_initial_carbon_emission_cost": 0.55, "interval_for_repair_and_rehabitation_in_years": 60, "repairs_duration_months": 3},
            },
            "replacement_costs_for_bearing_and_expansion_joint": {
                "percentage_of_super_structure_cost": 12.5,
                "interval_of_replacement_in_years": 25,
                "duration_of_replacement_in_days": 2,
            },
        },
        "end_of_life_stage_costs": {
            "demolition_and_disposal": {"percentage_of_initial_construction_cost": 10, "percentage_of_initial_carbon_emission_cost": 10, "duration_for_demolition_and_disposal_in_months": 1},
        },
    },
}

construction_costs = {
    "initial_construction_cost": 12843979.44,
    "initial_carbon_emissions_cost": 2065434.91,
    "superstructure_construction_cost": 9356038.92,
    "total_scrap_value": 2164095.02,
}

# Run the analysis
results = run_full_lcc_analysis(input_global, construction_costs)

# Output Net Present Value (NPV)
npv = results["use_stage"]["Net Present Value (NPV)"]
print("Total LCCA Net Present Value:", npv)
</script>
```

---

## 5. Calling from JavaScript (Two-Way Bridge)

You can call the Python analysis functions directly from regular JavaScript:

```html
<script type="text/python">
from browser import window
import json
from three_ps_lcca_core.core.main import run_full_lcc_analysis, get_IRC_standard_suggestions

# Expose Python function directly onto JavaScript 'window'
def js_run_lcca(input_json_str, costs_json_str, wpi_json_str=None):
    inp = json.loads(input_json_str)
    costs = json.loads(costs_json_str)
    wpi = json.loads(wpi_json_str) if wpi_json_str else None
    
    result = run_full_lcc_analysis(inp, costs, wpi=wpi)
    return json.dumps(result)

window.runLCCA = js_run_lcca
</script>

<script>
// Call from standard JavaScript anywhere in your app:
function computeBridgeLCCA(inputData, constructionCosts) {
    const rawResultJson = window.runLCCA(
        JSON.stringify(inputData),
        JSON.stringify(constructionCosts)
    );
    const result = JSON.parse(rawResultJson);
    console.log("Calculated LCCA Result:", result);
    return result;
}
</script>
```

---

## 6. Main Thread vs. Web Worker

* **Main Thread (Recommended)**:
  * Warm execution takes **~5 to 9 ms**, which is well below the 16.6 ms (60 fps) browser frame budget.
  * No UI blocking or stutter occurs.
  * Avoids Web Worker thread-spawning and message serialization overhead.
* **Web Worker**:
  * Only necessary if implementing large Monte Carlo simulations (>50,000 iterations) taking multiple seconds.

---

## 7. Production Verification

To verify the production package locally:
1. Open [`brython_test.html`](file:///C:/Users/Swas/Documents/GitHub/3psLCCA-core/brython_test.html) in your browser.
2. The benchmark will auto-run and display the timings and JS heap memory:
   * **Module Import & Transpile:** ~400 ms (cached)
   * **First Run (Cold):** ~15 – 25 ms
   * **Repeat Run (Warm):** ~5 – 9 ms
   * **RAM Usage:** ~45 MB / 75 MB
3. Click **"📋 Copy Benchmark Stats"** to copy system metrics to your clipboard.
