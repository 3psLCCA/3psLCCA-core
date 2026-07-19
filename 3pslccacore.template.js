// 3psLCCA Core browser wrapper: boots Pyodide, installs three_ps_lcca_core
// from the local wheel via micropip, and exposes the functions needed to
// run a life-cycle cost analysis from the browser.
//
// A release build loads Pyodide on its own (from the baked-in
// RELEASE_PYODIDE_URL below) the first time it's needed, so a single
// <script src=".../3pslccacore.js"> is enough. Loading pyodide.js with your
// own <script> tag beforehand still works and takes precedence. Must be
// loaded before any script that uses `window.ThreePsLccaCore`.

(function (global) {
  // This is the release template (hence the .template.js name) -- it is
  // never loaded directly. A confirmed release build
  // (`python -m build --wheel -C version=X.Y.Z -C release=true`) has
  // _build_backend.py render a copy of it as plain 3pslccacore.js, replacing
  // RELEASE_WHEEL_URL below
  // with that release's *fully-qualified* wheel URL (its github.io Pages
  // origin, computed from `git remote get-url origin`, + release/vX.Y.Z/ +
  // filename) and RELEASE_PYODIDE_URL with the Pyodide URL the release was
  // built and tested against (the ledger's pyodide_url), and stage the
  // result alongside the wheel itself in
  // release/vX.Y.Z/ (local staging only, never committed on web-dev).
  // release.py then bundles that already-assembled folder into
  // release/_publish/, whose contents are copied manually onto the web
  // branch (the one GitHub Pages serves; development happens on web-dev
  // instead, see DEVELOPER.md) -- it doesn't render this file itself.
  //
  // The wheel's URL is resolved at runtime, in order of preference:
  //   1. Script-src-relative: the wheel is always staged/published next to
  //      this script in release/vX.Y.Z/, so resolving the wheel's filename
  //      against document.currentScript.src finds it wherever that folder
  //      is served from -- github.io, a localhost server during testing, a
  //      mirror. (currentScript IS set for classic scripts however they're
  //      inserted, including dynamic injection; it's only null for
  //      ES modules and code copied inline/bundled.)
  //   2. The baked-in absolute RELEASE_WHEEL_URL -- the release's canonical
  //      published URL -- for exactly those currentScript-less contexts.
  // Consequence: serving this file *without* the wheel colocated fails
  // checkEnvironment's reachability pre-check with a clear message; the
  // `wheelUrl` option overrides either resolution. RELEASE_WHEEL_URL is a
  // plain string literal (not a template token) so this file stays valid,
  // runnable JS in every staged/published copy.
  const RELEASE_WHEEL_URL = "";
  // Stamped the same way as RELEASE_WHEEL_URL, from the same ledger entry
  // (releases.json pyodide_url). init() only uses it when the page didn't
  // load pyodide.js itself -- a page-provided Pyodide always wins, so the
  // pre-existing two-<script> embedding keeps working unchanged.
  const RELEASE_PYODIDE_URL = "";
  const PACKAGE_NAME = "three_ps_lcca_core";

  // Captured now, during script evaluation -- currentScript is null again
  // once execution moves past this script.
  const SCRIPT_SRC =
    typeof document !== "undefined" && document.currentScript && document.currentScript.src
      ? document.currentScript.src
      : null;

  function resolveWheelUrl() {
    if (!RELEASE_WHEEL_URL || !SCRIPT_SRC) return RELEASE_WHEEL_URL;
    const filename = RELEASE_WHEEL_URL.split("/").pop();
    try {
      return new URL(filename, SCRIPT_SRC).href;
    } catch (e) {
      return RELEASE_WHEEL_URL;
    }
  }

  // This repo-root copy has both RELEASE_* URLs empty (it's a template, not
  // a release), which leaves WHEEL_URL empty too -- for local dev testing,
  // pass the wheel's URL explicitly via the `wheelUrl` option to
  // init()/performAnalysis() (and, if the page doesn't include pyodide.js
  // itself, a `pyodideUrl`) instead.
  const WHEEL_URL = resolveWheelUrl();
  const PYODIDE_URL = RELEASE_PYODIDE_URL;

  let pyodidePromise = null;
  let activeWheelUrl = null;
  // The pyodide.js <script> is injected at most once per page: a loaded
  // script can't be unloaded, so a *different* pyodideUrl passed after
  // Pyodide is already on the page can't take effect (init() warns and
  // keeps the loaded copy). A *failed* injection is not cached; the next
  // init() re-injects.
  let pyodideScriptPromise = null;
  let activePyodideUrl = null;
  // Monotonic id of the latest init attempt. A superseded attempt (a newer
  // init started with a different wheel URL while it was in flight) keeps
  // running, but must no longer write to the shared `state` below.
  let initAttempt = 0;

  // Tracks how far initialization got, so callers can tell exactly what is
  // (or isn't) installed. `stage` is one of: idle, checking-environment,
  // loading-pyodide-script, booting-pyodide, loading-micropip,
  // fetching-wheel, installing-wheel, verifying-package, ready, error.
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

  // User-facing copy for "we need the network and don't have it" failures,
  // kept in one place so every offline-shaped error reads the same way.
  const OFFLINE_MESSAGE =
    "You're offline. Running an analysis the first time needs to download " +
    "some files (the Python runtime and the analysis package) — please " +
    "reconnect to the internet and try again.";

  // Init error variant for offline/network failures: same bookkeeping as
  // fail(), but tags the error as `.isOffline = true` and swaps in
  // OFFLINE_MESSAGE so callers can show a friendly banner instead of a raw
  // fetch/network exception. `detail` (the original error/string) is kept
  // on the error for logging, just not shown to the user.
  function failOffline(stage, detail) {
    state.stage = "error";
    state.error = { stage, message: OFFLINE_MESSAGE, detail: String(detail) };
    const err = makeError(stage, OFFLINE_MESSAGE);
    err.isOffline = true;
    err.detail = String(detail);
    return err;
  }

  // Best-effort check for "we clearly have no network". `navigator.onLine`
  // can false-positive (true even on a flaky/captive-portal connection) but
  // it reliably catches the common case of being fully offline, so it's
  // useful as a fast pre-check before even attempting a fetch.
  function isOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  // Network-shaped errors from fetch()/Pyodide/micropip don't carry a
  // consistent type across browsers, so this matches on the common
  // messages/names instead of relying on `instanceof`.
  function looksLikeNetworkError(e) {
    if (isOffline()) return true;
    const msg = String((e && e.message) || e || "").toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network error") ||
      msg.includes("load failed") ||
      msg.includes("err_internet_disconnected") ||
      msg.includes("err_network_changed") ||
      msg.includes("err_connection")
    );
  }

  // Pre-flight checks that don't need Pyodide running yet. Returns a list of
  // human-readable problems; empty list means the environment looks usable.
  async function checkEnvironment(customWheelUrl, customPyodideUrl) {
    const problems = [];
    const wheelUrl = customWheelUrl || WHEEL_URL;
    const pyodideUrl = customPyodideUrl || activePyodideUrl || PYODIDE_URL;

    if (isOffline()) {
      problems.push(OFFLINE_MESSAGE);
      return problems;
    }

    if (!wheelUrl) {
      problems.push(
        "No wheel URL configured: this copy is the un-rendered template with " +
          "no baked-in URL. Pass the wheel's URL via the `wheelUrl` option, " +
          "or use a release build of 3pslccacore.js."
      );
    }

    // Pyodide missing from the page is only a problem when there's no URL
    // to load it from on demand -- a release build has one baked in, so
    // init() fetches it itself.
    if (typeof global.loadPyodide !== "function" && !pyodideUrl) {
      problems.push(
        "Pyodide is not loaded and no Pyodide URL is configured: this copy " +
          "is the un-rendered template with no baked-in URL. Include " +
          '<script src=".../pyodide.js"></script> before 3pslccacore.js, ' +
          "or pass its URL via the `pyodideUrl` option."
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
    // which reports missing files with a much less obvious error. (An empty
    // wheelUrl must skip this: fetch("") resolves against the page's own URL
    // and would falsely pass.)
    if (wheelUrl && global.location && global.location.protocol !== "file:") {
      try {
        const resp = await fetch(wheelUrl, { method: "HEAD" });
        if (!resp.ok) {
          problems.push(
            `Wheel not found at ${wheelUrl} (HTTP ${resp.status}). ` +
              "Build a release (`python -m build --wheel -C version=X.Y.Z -C release=true`, " +
              "see DEVELOPER.md) so it's colocated with this script, or pass the wheel's " +
              "URL explicitly via the `wheelUrl` option."
          );
        }
      } catch (e) {
        if (looksLikeNetworkError(e)) {
          problems.push(OFFLINE_MESSAGE);
        } else {
          problems.push(`Could not reach wheel at ${wheelUrl}: ${e}`);
        }
      }
    }

    return problems;
  }

  // Injects <script src=pyodideUrl> into the page and resolves once
  // `loadPyodide` exists. No-op when Pyodide is already on the page (a
  // page-provided copy always wins). Shared across concurrent init
  // attempts; a failed load clears the cache so the next call re-injects.
  function loadPyodideScript(pyodideUrl) {
    if (typeof global.loadPyodide === "function") return Promise.resolve();
    if (!pyodideScriptPromise) {
      pyodideScriptPromise = new Promise((resolve, reject) => {
        const doc = global.document;
        if (!doc || !doc.head) {
          reject(new Error("No DOM available to inject the Pyodide <script> into."));
          return;
        }
        const script = doc.createElement("script");
        script.src = pyodideUrl;
        script.onload = () => {
          if (typeof global.loadPyodide === "function") {
            resolve();
          } else {
            reject(
              new Error(
                `Script at ${pyodideUrl} loaded but did not define \`loadPyodide\` -- ` +
                  "is it really pyodide.js?"
              )
            );
          }
        };
        script.onerror = () => {
          script.remove();
          reject(new Error(`Failed to load Pyodide script from ${pyodideUrl}.`));
        };
        doc.head.appendChild(script);
      });
      pyodideScriptPromise.catch(() => {
        pyodideScriptPromise = null;
      });
    }
    return pyodideScriptPromise;
  }

  // Idempotent: repeated calls return the same in-flight/settled promise.
  // Rejects with an Error carrying a `.stage` property naming the failed step.
  //
  // - Omitting `customWheelUrl` reuses the URL of the current/previous
  //   attempt (falling back to the baked-in WHEEL_URL), so a follow-up call
  //   without options doesn't tear down a runtime that was initialized with
  //   an explicit wheelUrl. `customPyodideUrl` behaves the same way
  //   (falling back to the baked-in PYODIDE_URL).
  // - A failed attempt is not cached: the next call starts over, so
  //   "reconnect and try again" actually works.
  // - Passing a *different* wheel URL starts a fresh attempt; a superseded
  //   in-flight attempt keeps running but stops touching `state`. A
  //   different *Pyodide* URL cannot do that -- a loaded pyodide.js script
  //   can't be unloaded -- so once Pyodide is on the page the option is
  //   ignored with a console warning.
  // - Progress notifications only reach the `onStatus` of the call that
  //   started the attempt; later callers joining an in-flight init share
  //   its promise but get no status callbacks.
  function init(onStatus, customWheelUrl, customPyodideUrl) {
    const notify = onStatus || (() => {});
    const wheelUrl = customWheelUrl || activeWheelUrl || WHEEL_URL;
    const pyodideUrl = customPyodideUrl || activePyodideUrl || PYODIDE_URL;
    if (
      customPyodideUrl &&
      typeof global.loadPyodide === "function" &&
      customPyodideUrl !== activePyodideUrl
    ) {
      console.warn(
        "[ThreePsLccaCore] Pyodide is already loaded on this page; the " +
          "`pyodideUrl` option only applies before Pyodide first loads and " +
          "is ignored now."
      );
    }
    if (pyodidePromise && activeWheelUrl !== wheelUrl) {
      pyodidePromise = null;
    }
    if (!pyodidePromise) {
      if (!wheelUrl) {
        return Promise.reject(
          fail(
            "checking-environment",
            "No wheel URL configured: this copy is the un-rendered template " +
              "with no baked-in URL. Pass the wheel's URL via the `wheelUrl` " +
              "option, or use a release build of 3pslccacore.js."
          )
        );
      }
      activeWheelUrl = wheelUrl;
      activePyodideUrl = pyodideUrl;
      const attemptId = ++initAttempt;
      const current = () => attemptId === initAttempt;
      // These write to the shared `state` (and fire onStatus) only while
      // this attempt is still the latest one, so a superseded attempt can't
      // clobber the progress of the attempt that replaced it.
      const setStage = (stage, message) => {
        if (current()) {
          state.stage = stage;
          notify(message);
        }
      };
      const stageFail = (stage, message) =>
        current() ? fail(stage, message) : makeError(stage, message);
      const stageFailOffline = (stage, detail) => {
        if (current()) return failOffline(stage, detail);
        const err = makeError(stage, OFFLINE_MESSAGE);
        err.isOffline = true;
        err.detail = String(detail);
        return err;
      };

      const attempt = (async () => {
        setStage("checking-environment", "Checking environment...");
        const problems = await checkEnvironment(wheelUrl, pyodideUrl);
        if (problems.length > 0) {
          throw stageFail("checking-environment", problems.join(" | "));
        }

        // checkEnvironment guarantees pyodideUrl is non-empty whenever
        // loadPyodide is absent, so this stage always has a URL to fetch.
        if (typeof global.loadPyodide !== "function") {
          setStage("loading-pyodide-script", "Loading Pyodide script...");
          try {
            await loadPyodideScript(pyodideUrl);
          } catch (e) {
            throw looksLikeNetworkError(e)
              ? stageFailOffline("loading-pyodide-script", e)
              : stageFail("loading-pyodide-script", String((e && e.message) || e));
          }
        }

        setStage("booting-pyodide", "Booting Pyodide runtime...");
        let pyodide;
        try {
          pyodide = await global.loadPyodide();
        } catch (e) {
          throw looksLikeNetworkError(e)
            ? stageFailOffline("booting-pyodide", e)
            : stageFail("booting-pyodide", "Pyodide failed to start: " + e);
        }
        if (current()) state.pyodideVersion = pyodide.version;

        setStage("loading-micropip", "Loading micropip...");
        try {
          await pyodide.loadPackage("micropip");
        } catch (e) {
          throw looksLikeNetworkError(e)
            ? stageFailOffline("loading-micropip", e)
            : stageFail("loading-micropip", "Failed to load micropip (network/CDN issue?): " + e);
        }

        setStage("installing-wheel", `Installing ${PACKAGE_NAME} from local wheel...`);
        const micropip = pyodide.pyimport("micropip");
        try {
          // Path is resolved relative to the page's URL.
          await micropip.install(wheelUrl);
        } catch (e) {
          throw looksLikeNetworkError(e)
            ? stageFailOffline("installing-wheel", e)
            : stageFail("installing-wheel", `micropip failed to install ${wheelUrl}: ` + e);
        }

        setStage("verifying-package", `Verifying ${PACKAGE_NAME} import...`);
        let packageVersion;
        try {
          packageVersion = await pyodide.runPythonAsync(`
from importlib.metadata import version
import ${PACKAGE_NAME}.core.main  # noqa: F401 — proves the analysis entry point imports
version("${PACKAGE_NAME.replace(/_/g, "-")}")
          `);
        } catch (e) {
          throw stageFail(
            "verifying-package",
            `${PACKAGE_NAME} installed but failed to import (broken wheel or missing dependency?): ` + e
          );
        }
        if (current()) state.packageVersion = packageVersion;

        setStage("ready", "Ready.");
        return pyodide;
      })();

      pyodidePromise = attempt;
      // Drop a failed attempt from the cache (unless a newer attempt has
      // already replaced it) so the next init() retries from scratch.
      attempt.catch(() => {
        if (pyodidePromise === attempt) {
          pyodidePromise = null;
        }
      });
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

    let payload;
    try {
      payload = JSON.parse(payloadJson);
    } catch (e) {
      throw makeError(stage, "Python returned a malformed JSON payload: " + e);
    }

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
        # allow_nan=False: Python's json would happily emit NaN/Infinity,
        # which aren't valid JSON and would make JSON.parse throw on the JS
        # side; force such results down the structured-error path instead.
        return json.dumps(payload, allow_nan=False)
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
    const { debug = false, onStatus, onOutput, wheelUrl, pyodideUrl } = options;

    requirePlainObject("inputData", inputData);
    requirePlainObject("constructionCosts", constructionCosts);
    requirePlainObject("wpi", wpi);

    const pyodide = await init(onStatus, wheelUrl, pyodideUrl);

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
    const { onStatus, onOutput, wheelUrl, pyodideUrl } = options;
    const pyodide = await init(onStatus, wheelUrl, pyodideUrl);

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
    isOffline,
  };
})(window);
