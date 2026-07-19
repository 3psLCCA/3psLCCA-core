// 3psLCCA Core browser wrapper: boots Pyodide, installs three_ps_lcca_core
// from the local wheel via micropip, and exposes the functions needed to
// run a life-cycle cost analysis from the browser.
//
// Must be loaded after https://cdn.jsdelivr.net/pyodide/v.../full/pyodide.js
// and before any script that uses `window.ThreePsLccaCore`.

(function (global) {
  // This is the release template (hence the .template.js name) -- it is
  // never loaded directly. A confirmed release build
  // (`python -m build --wheel -C version=X.Y.Z -C release=true`) has
  // _build_backend.py render a copy of it as plain 3pslccacore.js, replacing
  // RELEASE_WHEEL_URL below
  // with that release's *fully-qualified* wheel URL (its github.io Pages
  // origin, computed from `git remote get-url origin`, + release/vX.Y.Z/ +
  // filename), and stage the result alongside the wheel itself in
  // release/vX.Y.Z/ (gitignored, local only). release.py then copies that
  // already-assembled folder onto the feature/js-client-delivery branch
  // (see DEVELOPING.md) -- it doesn't render this file itself.
  //
  // RELEASE_WHEEL_URL is deliberately baked in as an absolute URL rather
  // than a path resolved at runtime against document.currentScript.src:
  // that resolution breaks if the script tag doesn't populate
  // currentScript (dynamic insertion, module scripts, some bundlers), and
  // if the embedding page happens to be served from a different origin
  // than the release, a relative path would resolve against the *page's*
  // origin instead of the wheel's and fail to fetch. An absolute URL has
  // neither problem. RELEASE_WHEEL_URL is a plain string literal (not a
  // template token) so this file stays valid, runnable JS in every
  // staged/published copy.
  const RELEASE_WHEEL_URL = "";
  const PACKAGE_NAME = "three_ps_lcca_core";

  // This repo-root copy has RELEASE_WHEEL_URL empty (it's a template, not a
  // release) -- for local dev testing, pass the wheel's URL explicitly via
  // the `wheelUrl` option to init()/performAnalysis() instead.
  const WHEEL_URL = RELEASE_WHEEL_URL;

  let pyodidePromise = null;
  let activeWheelUrl = null;

  // Tracks how far initialization got, so callers can tell exactly what is
  // (or isn't) installed. `stage` is one of: idle, checking-environment,
  // booting-pyodide, loading-micropip, fetching-wheel, installing-wheel,
  // verifying-package, ready, error.
  const state = {
    stage: "idle",
    pyodideVersion: null,
    packageVersion: null,
    error: null,
  };

  // Custom JSON-serializable LCCA Error class
  class LccaError extends Error {
    constructor(stage, message, pythonType = null, traceback = null, stdout = "", stderr = "") {
      super(message);
      this.name = "LccaError";
      this.stage = stage || "unknown";
      this.pythonType = pythonType || null;
      this.traceback = traceback || null;
      this.stdout = stdout || "";
      this.stderr = stderr || "";

      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, LccaError);
      }
    }

    // Custom serialization to support JSON.stringify() directly on the Error object
    toJSON() {
      return {
        error: this.pythonType || this.name,
        message: this.message,
        stage: this.stage,
        traceback: this.traceback ? this.traceback.trim().split("\n") : [],
        stdout: this.stdout,
        stderr: this.stderr
      };
    }
  }

  // Per-call error: tags the Error with the failed stage without touching
  // init state (the runtime may still be perfectly usable).
  function makeError(stage, message, pythonType = null, traceback = null, stdout = "", stderr = "") {
    return new LccaError(stage, message, pythonType, traceback, stdout, stderr);
  }

  // Init error: also records the failure in `state` so getState() shows it.
  function fail(stage, message) {
    state.stage = "error";
    state.error = { stage, message };
    return makeError(stage, message);
  }

  // Pre-flight checks that don't need Pyodide running yet. Returns a list of
  // human-readable problems; empty list means the environment looks usable.
  async function checkEnvironment(customWheelUrl) {
    const problems = [];
    const wheelUrl = customWheelUrl || WHEEL_URL;

    if (typeof global.loadPyodide !== "function") {
      problems.push(
        "Pyodide is not loaded: `loadPyodide` is undefined. Include " +
          '<script src="https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js"></script> ' +
          "before 3pslccacore.js."
      );
    }

    if (global.location && global.location.protocol === "file:") {
      problems.push(
        "Page is served via file:// — Pyodide and micropip need HTTP. " +
          "Serve the repo root (e.g. `python -m http.server`) and open this page over http://, not file://."
      );
    }

    if (typeof global.WebAssembly === "undefined") {
      problems.push("This browser does not support WebAssembly, which Pyodide requires.");
    }

    // Confirm the wheel is actually reachable before handing it to micropip,
    // which reports missing files with a much less obvious error.
    if (global.location && global.location.protocol !== "file:") {
      try {
        const resp = await fetch(wheelUrl, { method: "HEAD" });
        if (!resp.ok) {
          problems.push(
            `Wheel not found at ${wheelUrl} (HTTP ${resp.status}). ` +
              "Build a release (`python -m build --wheel -C version=X.Y.Z -C release=true`, " +
              "see DEVELOPING.md) so it's colocated with this script, or pass the wheel's " +
              "URL explicitly via the `wheelUrl` option."
          );
        }
      } catch (e) {
        problems.push(`Could not reach wheel at ${wheelUrl}: ${e}`);
      }
    }

    return problems;
  }

  // Idempotent: repeated calls return the same in-flight/settled promise.
  // Rejects with an Error carrying a `.stage` property naming the failed step.
  function init(onStatus, customWheelUrl) {
    const notify = onStatus || (() => {});
    const wheelUrl = customWheelUrl || WHEEL_URL;
    if (pyodidePromise && activeWheelUrl !== wheelUrl) {
      pyodidePromise = null;
    }
    if (!pyodidePromise) {
      activeWheelUrl = wheelUrl;
      pyodidePromise = (async () => {
        state.stage = "checking-environment";
        notify("Checking environment...");
        const problems = await checkEnvironment(wheelUrl);
        if (problems.length > 0) {
          throw fail("checking-environment", problems.join(" | "));
        }

        state.stage = "booting-pyodide";
        notify("Booting Pyodide runtime...");
        let pyodide;
        try {
          pyodide = await global.loadPyodide();
        } catch (e) {
          throw fail("booting-pyodide", "Pyodide failed to start: " + e);
        }
        state.pyodideVersion = pyodide.version;

        state.stage = "loading-micropip";
        notify("Loading micropip...");
        try {
          await pyodide.loadPackage("micropip");
        } catch (e) {
          throw fail("loading-micropip", "Failed to load micropip (network/CDN issue?): " + e);
        }

        state.stage = "installing-wheel";
        notify(`Installing ${PACKAGE_NAME} from local wheel...`);
        const micropip = pyodide.pyimport("micropip");
        try {
          // Path is resolved relative to the page's URL.
          await micropip.install(wheelUrl);
        } catch (e) {
          throw fail("installing-wheel", `micropip failed to install ${wheelUrl}: ` + e);
        }

        state.stage = "verifying-package";
        notify(`Verifying ${PACKAGE_NAME} import...`);
        try {
          state.packageVersion = await pyodide.runPythonAsync(`
from importlib.metadata import version
import ${PACKAGE_NAME}.core.main  # noqa: F401 — proves the analysis entry point imports
version("${PACKAGE_NAME.replace(/_/g, "-")}")
          `);
        } catch (e) {
          throw fail(
            "verifying-package",
            `${PACKAGE_NAME} installed but failed to import (broken wheel or missing dependency?): ` + e
          );
        }

        state.stage = "ready";
        notify("Ready.");
        return pyodide;
      })();
    }
    return pyodidePromise;
  }

  // Snapshot of initialization progress; safe to call at any time.
  function getState() {
    return { ...state, error: state.error ? { ...state.error } : null };
  }

  function isReady() {
    return state.stage === "ready";
  }

  function requirePlainObject(name, value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw makeError("validating-arguments", `${name} must be a plain object, got ${value === null ? "null" : Array.isArray(value) ? "an array" : typeof value}.`);
    }
  }

  // Runs Python code that must end with `_guarded(fn)` (see PY_GUARD), which
  // yields JSON: {"ok": ..., "result"/"error": ..., "stdout": ..., "stderr": ...}.
  // Python prints/warnings are captured per call and forwarded to `onOutput`
  // (default: browser console). On Python failure, throws an Error with
  // `.stage`, `.pythonType`, `.traceback`, `.stdout` and `.stderr`.
  async function runPythonJson(pyodide, stage, code, onOutput) {
    let payloadJson;
    try {
      payloadJson = await pyodide.runPythonAsync(code);
    } catch (e) {
      // Errors outside our try/except (e.g. SyntaxError) land here.
      throw makeError(stage, "Python execution failed: " + e);
    }

    const payload = JSON.parse(payloadJson);

    const emit = onOutput || ((text, kind) => {
      (kind === "stderr" ? console.warn : console.log)(`[ThreePsLccaCore] python ${kind}:\n${text}`);
    });
    if (payload.stdout) emit(payload.stdout, "stdout");
    if (payload.stderr) emit(payload.stderr, "stderr");

    if (!payload.ok) {
      const { type, message, traceback } = payload.error;
      const err = makeError(stage, message, type, traceback, payload.stdout, payload.stderr);
      console.error(`[ThreePsLccaCore] ${stage} failed\n` + traceback);
      throw err;
    }
    return payload.result;
  }

  // Captures stdout/stderr (print statements, warnings) alongside the result,
  // and keeps json.dumps itself inside a guard so a non-serializable result
  // still comes back as a structured error instead of a raw PythonError.
  const PY_GUARD = `
import io, json, traceback
from contextlib import redirect_stdout, redirect_stderr

def _guarded(fn):
    out, err = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            payload = {"ok": True, "result": fn()}
    except Exception as e:
        payload = {"ok": False, "error": {
            "type": type(e).__name__,
            "message": str(e),
            "traceback": traceback.format_exc(),
        }}
    payload["stdout"] = out.getvalue()
    payload["stderr"] = err.getvalue()
    try:
        return json.dumps(payload)
    except (TypeError, ValueError) as e:
        return json.dumps({
            "ok": False,
            "error": {"type": "SerializationError",
                      "message": "Result is not JSON-serializable: " + str(e),
                      "traceback": ""},
            "stdout": out.getvalue(),
            "stderr": err.getvalue(),
        })
`;

  async function performAnalysis(inputData, constructionCosts, wpi, options = {}) {
    const { debug = false, onStatus, onOutput, wheelUrl } = options;

    requirePlainObject("inputData", inputData);
    requirePlainObject("constructionCosts", constructionCosts);
    requirePlainObject("wpi", wpi);

    const pyodide = await init(onStatus, wheelUrl);

    pyodide.globals.set("input_data_json", JSON.stringify(inputData));
    pyodide.globals.set("wpi_json", JSON.stringify(wpi));
    pyodide.globals.set("construction_costs_json", JSON.stringify(constructionCosts));
    pyodide.globals.set("debug_flag", debug);

    return runPythonJson(
      pyodide,
      "running-analysis",
      `${PY_GUARD}
from three_ps_lcca_core.core.main import run_full_lcc_analysis

def _run():
    input_data = json.loads(input_data_json)
    wpi = json.loads(wpi_json)
    construction_costs = json.loads(construction_costs_json)
    return run_full_lcc_analysis(input_data, construction_costs, wpi=wpi, debug=debug_flag)

_guarded(_run)
    `,
      onOutput
    );
  }

  // Indian Road Congress (IRC) standard constraints and default values
  // (IRC SP:30-2019 and IRC 106:1990), as exposed by the Python core.
  async function getIrcStandardSuggestions(options = {}) {
    const { onStatus, onOutput, wheelUrl } = options;
    const pyodide = await init(onStatus, wheelUrl);

    return runPythonJson(
      pyodide,
      "fetching-irc-suggestions",
      `${PY_GUARD}
from three_ps_lcca_core.core.main import get_IRC_standard_suggestions

_guarded(get_IRC_standard_suggestions)
    `,
      onOutput
    );
  }

  const sample = {
    input: {
      general_parameters: {
        service_life_years: 150,
        analysis_period_years: 100,
        discount_rate_percent: 6.7,
        inflation_rate_percent: 5.15,
        interest_rate_percent: 7.75,
        investment_ratio: 0.5,
        social_cost_of_carbon_per_mtco2e: 86.4,
        currency_conversion: 88.73,
        construction_period_months: 1 / 30,
        working_days_per_month: 26,
        days_per_month: 30,
        use_global_road_user_calculations: false,
      },
      traffic_and_road_data: {
        vehicle_data: {
          small_cars: { vehicles_per_day: 7271, carbon_emissions_kgCO2e_per_km: 0.103, accident_percentage: 12.18 },
          big_cars: { vehicles_per_day: 7269, carbon_emissions_kgCO2e_per_km: 0.269, accident_percentage: 11.75 },
          two_wheelers: { vehicles_per_day: 3409, carbon_emissions_kgCO2e_per_km: 0.0351, accident_percentage: 74.61 },
          o_buses: { vehicles_per_day: 2, carbon_emissions_kgCO2e_per_km: 0.45483, accident_percentage: 0.88 },
          d_buses: { vehicles_per_day: 480, carbon_emissions_kgCO2e_per_km: 0.60644, accident_percentage: 0 },
          lcv: { vehicles_per_day: 564, carbon_emissions_kgCO2e_per_km: 0.307, accident_percentage: 0 },
          mcv: { vehicles_per_day: 0, carbon_emissions_kgCO2e_per_km: 0.7375, accident_percentage: 0, pwr: 8 },
          hcv: { vehicles_per_day: 40, carbon_emissions_kgCO2e_per_km: 0.5928, accident_percentage: 0.59, pwr: 7.22 },
        },
        accident_severity_distribution: { minor: 25.7, major: 61.42, fatal: 12.88 },
        additional_inputs: {
          alternate_road_carriageway: "2L",
          carriage_width_in_m: 8,
          road_roughness_mm_per_km: 2000,
          road_rise_m_per_km: 0,
          road_fall_m_per_km: 0,
          additional_reroute_distance_km: 0.175,
          additional_travel_time_min: 0.525,
          crash_rate_accidents_per_million_km: 3385.23,
          work_zone_multiplier: 1.0,
          peak_hour_traffic_percent_per_hour: [0.1, 0.1],
          hourly_capacity: 1900,
          force_free_flow_off_peak: true,
        },
      },
      maintenance_and_stage_parameters: {
        use_stage_cost: {
          routine: {
            inspection: { percentage_of_initial_construction_cost_per_year: 0.1, interval_in_years: 1 },
            maintenance: {
              percentage_of_initial_construction_cost_per_year: 0.55,
              percentage_of_initial_carbon_emission_cost: 0.55,
              interval_in_years: 5,
            },
          },
          major: {
            inspection: { percentage_of_initial_construction_cost: 0.5, interval_for_repair_and_rehabitation_in_years: 5 },
            repair: {
              percentage_of_initial_construction_cost: 10,
              percentage_of_initial_carbon_emission_cost: 0.55,
              interval_for_repair_and_rehabitation_in_years: 60,
              repairs_duration_months: 3,
            },
          },
          replacement_costs_for_bearing_and_expansion_joint: {
            percentage_of_super_structure_cost: 12.5,
            interval_of_replacement_in_years: 25,
            duration_of_replacement_in_days: 2,
          },
        },
        end_of_life_stage_costs: {
          demolition_and_disposal: {
            percentage_of_initial_construction_cost: 10,
            percentage_of_initial_carbon_emission_cost: 10,
            duration_for_demolition_and_disposal_in_months: 1,
          },
        },
      },
    },

    // Global RUC mode: set use_global_road_user_calculations to true and
    // supply daily_road_user_cost_with_vehicular_emissions instead of
    // traffic_and_road_data (mirrors examples/from_dict/Input_global.py).
    inputGlobal: {
      general_parameters: {
        service_life_years: 75,
        analysis_period_years: 150,
        discount_rate_percent: 6.7,
        inflation_rate_percent: 5.15,
        interest_rate_percent: 7.75,
        investment_ratio: 0.5,
        social_cost_of_carbon_per_mtco2e: 86.4,
        currency_conversion: 88.73,
        construction_period_months: 5.2,
        working_days_per_month: 26,
        days_per_month: 30,
        use_global_road_user_calculations: true,
      },
      daily_road_user_cost_with_vehicular_emissions: {
        total_daily_ruc: 128618.886,
        total_carbon_emission: {
          total_emission_kgCO2e: 772.24519225,
        },
      },
      maintenance_and_stage_parameters: {
        use_stage_cost: {
          routine: {
            inspection: { percentage_of_initial_construction_cost_per_year: 0.1, interval_in_years: 1 },
            maintenance: {
              percentage_of_initial_construction_cost_per_year: 0.55,
              percentage_of_initial_carbon_emission_cost: 0.55,
              interval_in_years: 5,
            },
          },
          major: {
            inspection: { percentage_of_initial_construction_cost: 0.5, interval_for_repair_and_rehabitation_in_years: 5 },
            repair: {
              percentage_of_initial_construction_cost: 10,
              percentage_of_initial_carbon_emission_cost: 0.55,
              interval_for_repair_and_rehabitation_in_years: 20,
              repairs_duration_months: 3,
            },
          },
          replacement_costs_for_bearing_and_expansion_joint: {
            percentage_of_super_structure_cost: 12.5,
            interval_of_replacement_in_years: 25,
            duration_of_replacement_in_days: 2,
          },
        },
        end_of_life_stage_costs: {
          demolition_and_disposal: {
            percentage_of_initial_construction_cost: 10,
            percentage_of_initial_carbon_emission_cost: 10,
            duration_for_demolition_and_disposal_in_months: 1,
          },
        },
      },
    },

    wpi: {
      year: 2024,
      WPI: {
        small_cars: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1266129032258065, spare_parts: 1.1412544169611307, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        big_cars: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1266129032258065, spare_parts: 1.1412544169611307, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        two_wheelers: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1401923076923077, spare_parts: 1.1412544169611307, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        o_buses: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1926153846153846, spare_parts: 1.282155477031802, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        d_buses: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1926153846153846, spare_parts: 1.282155477031802, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        lcv: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1926153846153846, spare_parts: 1.0099035933391762, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        hcv: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1926153846153846, spare_parts: 1.0099035933391762, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
        mcv: { petrol: 1.7209601873536298, diesel: 1.7102754237288134, engine_oil: 1.4496951219512195, other_oil: 1.6295135135135135, grease: 1.6295135135135135, property_damage: 1.1485865724381625, tyre_cost: 1.1926153846153846, spare_parts: 1.0099035933391762, fixed_depreciation: 1.1463971880492092, commodity_holding_cost: 1.4412979351032449, passenger_cost: 1.2783003300330034, crew_cost: 1.2783003300330034, fatal: 1.105509433962264, major: 1.105509433962264, minor: 1.105509433962264, vot_cost: 1.2783003300330034 },
      },
    },

    constructionCosts: {
      initial_construction_cost: 12843979.44,
      initial_carbon_emissions_cost: 2065434.91,
      superstructure_construction_cost: 9356038.92,
      total_scrap_value: 2164095.02,
    },
  };

  global.ThreePsLccaCore = {
    LccaError,
    sample,
    init,
    performAnalysis,
    getIrcStandardSuggestions,
    checkEnvironment,
    getState,
    isReady,
  };
})(window);
