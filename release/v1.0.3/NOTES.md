# 3psLCCA Core v1.0.3 — Release Notes

**Released:** 2026-10-03 · **Commit:** `b6c5d06` · **Kind:** stable release

Feature release: **Dual-target client-side distribution**. Version 1.0.3 introduces the official, production-minified **Brython distribution** (`three_ps_lcca_core.brython.js`) alongside the established **Pyodide WebAssembly wrapper** (`3pslccacore.js`).

---

## What's in this release

| Artifact | Target Runtime | Size (Raw / Gzip) | Description |
| :--- | :--- | :--- | :--- |
| **`three_ps_lcca_core.brython.js`** | **Brython 3.14+** | **93.3 KB / 23.5 KB** | Production minified Brython VFS package. Instant load, ~5 ms execution. |
| **`3pslccacore.js`** | **Pyodide v0.26+** | 24 KB wrapper | Self-loading Pyodide WebAssembly wrapper. |
| **`three_ps_lcca_core-1.0.3-py3-none-any.whl`** | Python / Wasm | 70.6 KB | Standard Python wheel installed by Pyodide micropip. |

---

## How to Use the Brython Version

Brython runs Python directly in the browser by transpiling to JavaScript on the fly. It downloads in **93 KB** (vs 7 MB for WebAssembly), boots in **~400 ms**, and executes calculations in **~5 ms** on the main thread without UI lag.

### Step 1: Add Scripts to `<head>`

Load Brython core, standard library, and the `v1.0.3` production bundle:

```html
<head>
  <!-- Brython Engine & Standard Library -->
  <script src="https://cdn.jsdelivr.net/npm/brython@3.14.3/brython.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/brython@3.14.3/brython_stdlib.js"></script>

  <!-- 3psLCCA Core Brython Bundle (v1.0.3) -->
  <script src="https://3psLCCA.github.io/3psLCCA-core/release/v1.0.3/three_ps_lcca_core.brython.js"></script>
</head>
```

### Step 2: Initialize Brython on `<body>`

Use `{debug: 0}` for production mode:

```html
<body onload="brython({debug: 0})">
```

---

### Method A: Writing Code in Python (`<script type="text/python">`)

You can write normal Python directly inside HTML:

```html
<script type="text/python">
import json
from browser import document, window
from three_ps_lcca_core.core.main import run_full_lcc_analysis, get_IRC_standard_suggestions

# 1. Define LCCA Inputs
sample_input = {
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

sample_costs = {
    "initial_construction_cost": 12843979.44,
    "initial_carbon_emissions_cost": 2065434.91,
    "superstructure_construction_cost": 9356038.92,
    "total_scrap_value": 2164095.02,
}

# 2. Run the Analysis (~5 ms)
results = run_full_lcc_analysis(sample_input, sample_costs)

# 3. Access Results
npv = results["use_stage"]["Net Present Value (NPV)"]
print("Calculated Net Present Value:", npv)
</script>
```

---

### Method B: Calling from Regular JavaScript

You can expose a JavaScript callable function so your React, Vue, or vanilla JS code can trigger calculations:

```html
<!-- Expose Python to JavaScript -->
<script type="text/python">
from browser import window
import json
from three_ps_lcca_core.core.main import run_full_lcc_analysis, get_IRC_standard_suggestions

def js_run_lcca(input_data_json, costs_data_json, wpi_json=None):
    inp = json.loads(input_data_json)
    costs = json.loads(costs_data_json)
    wpi = json.loads(wpi_json) if wpi_json else None
    
    result = run_full_lcc_analysis(inp, costs, wpi=wpi)
    return json.dumps(result)

window.runBridgeLCCA = js_run_lcca
window.getIrcSuggestions = lambda: json.dumps(get_IRC_standard_suggestions())
</script>

<!-- Call from standard JavaScript anywhere in your app -->
<script>
window.addEventListener("DOMContentLoaded", () => {
  // Wait for Brython to initialize
  setTimeout(() => {
    if (window.runBridgeLCCA) {
      const resultJson = window.runBridgeLCCA(
        JSON.stringify(sampleInput),
        JSON.stringify(sampleCosts)
      );
      const result = JSON.parse(resultJson);
      console.log("LCCA Result:", result);
    }
  }, 500);
});
</script>
```

---

## Using the Pyodide Version (Alternative)

If you prefer Pyodide (WebAssembly), use the drop-in `3pslccacore.js` wrapper:

```html
<script src="https://3psLCCA.github.io/3psLCCA-core/release/v1.0.3/3pslccacore.js"></script>
<script>
  const { sample, performAnalysis } = window.ThreePsLccaCore;
  performAnalysis(sample.input, sample.constructionCosts, sample.wpi)
    .then(result => console.log(result));
</script>
```

---

## Comparison: Brython vs. Pyodide

| Feature | Brython (`three_ps_lcca_core.brython.js`) | Pyodide (`3pslccacore.js`) |
| :--- | :--- | :--- |
| **Download Size** | **93.3 KB** (23.5 KB Gzip) | ~7.5 MB (Wasm + Stdlib) |
| **Boot Time** | **~400 ms** (cached) / ~1.7s (cold) | ~7,000 ms |
| **Execution Time** | **~5 – 9 ms** (Warm) | ~7 – 10 ms (Warm) |
| **Best For** | Web forms, interactive sliders, mobile | Heavy scientific data pipelines |
