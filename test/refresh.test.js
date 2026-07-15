// Unit-Tests fuer den reinen Kern des "Jetzt aktualisieren"-Buttons.
// Laeuft mit: node --test test/refresh.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const R = require("../src/refresh.js");
const E = R.EVENTS;
const FX = R.EFFECTS;

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

// Baut einen Zustand auf Basis der echten Defaults, mit gezielten Overrides.
function st(overrides) {
  return Object.assign(R.initialState(), overrides || {});
}

// ---------------------------------------------------------------------------
// reduce: Happy Path komplett
// ---------------------------------------------------------------------------

test("reduce: kompletter Happy Path idle -> doneUpdated, Zustand + Effects je Schritt", () => {
  // idle --CLICK(hasToken)--> validating
  let r = R.reduce(R.initialState(), { type: E.CLICK, hasToken: true });
  assert.equal(r.state.name, "validating");
  assert.deepEqual(r.effects, [FX.VALIDATE_TOKEN]);

  // validating --VALIDATE_OK(kein activeRun, baselineSha)--> dispatching
  r = R.reduce(r.state, { type: E.VALIDATE_OK, activeRun: null, baselineSha: "sha-baseline", at: 1000 });
  assert.equal(r.state.name, "dispatching");
  assert.deepEqual(r.effects, [FX.DISPATCH]);
  assert.equal(r.state.baselineSha, "sha-baseline");

  // dispatching --DISPATCH_OK--> locatingRun
  r = R.reduce(r.state, { type: E.DISPATCH_OK, at: 2000 });
  assert.equal(r.state.name, "locatingRun");
  assert.deepEqual(r.effects, [FX.START_POLL]);
  assert.equal(r.state.dispatchedAt, 2000);
  assert.equal(r.state.phaseStartedAt, 2000);
  assert.equal(r.state.baselineSha, "sha-baseline");

  // locatingRun --RUN_FOUND--> running
  r = R.reduce(r.state, { type: E.RUN_FOUND, runId: 900000002, at: 3000 });
  assert.equal(r.state.name, "running");
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.runId, 900000002);

  // running --RUN_COMPLETED(success, shaChanged=true)--> awaitingPages
  r = R.reduce(r.state, { type: E.RUN_COMPLETED, conclusion: "success", shaChanged: true, at: 4000 });
  assert.equal(r.state.name, "awaitingPages");
  assert.deepEqual(r.effects, []);

  // awaitingPages --DATA_CHANGED--> doneUpdated mit APPLY_DATA
  r = R.reduce(r.state, { type: E.DATA_CHANGED, at: 5000 });
  assert.equal(r.state.name, "doneUpdated");
  assert.deepEqual(r.effects, [FX.APPLY_DATA]);
});

test("reduce: doneUnchanged-Pfad bei success + shaChanged=false", () => {
  const running = st({ name: "running", runId: 42, phaseStartedAt: 100, dispatchedAt: 100 });
  const r = R.reduce(running, { type: E.RUN_COMPLETED, conclusion: "success", shaChanged: false, at: 200 });
  assert.equal(r.state.name, "doneUnchanged");
  assert.deepEqual(r.effects, []);
});

test("reduce: errorRunFailed bei conclusion 'failure' UND 'cancelled'", () => {
  const running = st({ name: "running", runId: 42, phaseStartedAt: 100 });
  const fail = R.reduce(running, { type: E.RUN_COMPLETED, conclusion: "failure", at: 200 });
  assert.equal(fail.state.name, "errorRunFailed");
  assert.deepEqual(fail.effects, []);
  const cancelled = R.reduce(running, { type: E.RUN_COMPLETED, conclusion: "cancelled", at: 200 });
  assert.equal(cancelled.state.name, "errorRunFailed");
  assert.deepEqual(cancelled.effects, []);
});

test("reduce: AUTH_FAILED waehrend dispatching -> needToken mit CLEAR_TOKEN + SHOW_TOKEN_DIALOG", () => {
  const dispatching = st({ name: "dispatching", baselineSha: "x" });
  const r = R.reduce(dispatching, { type: E.AUTH_FAILED });
  assert.equal(r.state.name, "needToken");
  assert.deepEqual(r.effects, [FX.CLEAR_TOKEN, FX.SHOW_TOKEN_DIALOG]);
});

// ---------------------------------------------------------------------------
// reduce: Timeouts (Grenzen aus den exportierten TIMEOUTS)
// ---------------------------------------------------------------------------

test("reduce: locatingRun TICK unter 60s bleibt, ueber 60s -> errorTimeout(locatingRun)", () => {
  const limit = R.TIMEOUTS.locatingRun;
  const base = st({ name: "locatingRun", phaseStartedAt: 0, dispatchedAt: 0 });
  const under = R.reduce(base, { type: E.TICK, at: limit - 1 });
  assert.equal(under.state.name, "locatingRun");
  assert.deepEqual(under.effects, []);
  const over = R.reduce(base, { type: E.TICK, at: limit + 1 });
  assert.equal(over.state.name, "errorTimeout");
  assert.equal(over.state.timeoutPhase, "locatingRun");
});

test("reduce: running TICK unter 12min bleibt, ueber 12min -> errorTimeout(running)", () => {
  const limit = R.TIMEOUTS.running;
  const base = st({ name: "running", runId: 1, phaseStartedAt: 0, dispatchedAt: 0 });
  const under = R.reduce(base, { type: E.TICK, at: limit - 1 });
  assert.equal(under.state.name, "running");
  const over = R.reduce(base, { type: E.TICK, at: limit + 1 });
  assert.equal(over.state.name, "errorTimeout");
  assert.equal(over.state.timeoutPhase, "running");
});

test("reduce: awaitingPages TICK unter 5min bleibt, ueber 5min -> errorTimeout(awaitingPages)", () => {
  const limit = R.TIMEOUTS.awaitingPages;
  const base = st({ name: "awaitingPages", phaseStartedAt: 0 });
  const under = R.reduce(base, { type: E.TICK, at: limit - 1 });
  assert.equal(under.state.name, "awaitingPages");
  const over = R.reduce(base, { type: E.TICK, at: limit + 1 });
  assert.equal(over.state.name, "errorTimeout");
  assert.equal(over.state.timeoutPhase, "awaitingPages");
});

// ---------------------------------------------------------------------------
// reduce: Attach-Pfad
// ---------------------------------------------------------------------------

test("reduce: VALIDATE_OK mit activeRun -> running mit attached=true, START_POLL", () => {
  const validating = st({ name: "validating" });
  const r = R.reduce(validating, { type: E.VALIDATE_OK, activeRun: { id: 555 }, at: 7000 });
  assert.equal(r.state.name, "running");
  assert.equal(r.state.attached, true);
  assert.equal(r.state.runId, 555);
  assert.deepEqual(r.effects, [FX.START_POLL]);
  // statusText im Attach-Fall enthaelt "warte mit"
  assert.ok(R.statusText(r.state).includes("warte mit"));
});

// ---------------------------------------------------------------------------
// reduce: Neustart aus Ende-/Fehlerzustaenden
// ---------------------------------------------------------------------------

test("reduce: CLICK in doneUpdated verhaelt sich wie idle-CLICK (mit/ohne Token)", () => {
  const done = st({ name: "doneUpdated" });
  const withToken = R.reduce(done, { type: E.CLICK, hasToken: true });
  assert.equal(withToken.state.name, "validating");
  assert.deepEqual(withToken.effects, [FX.VALIDATE_TOKEN]);
  const withoutToken = R.reduce(done, { type: E.CLICK, hasToken: false });
  assert.equal(withoutToken.state.name, "needToken");
  assert.deepEqual(withoutToken.effects, [FX.SHOW_TOKEN_DIALOG]);
});

test("reduce: CLICK in errorNetwork verhaelt sich wie idle-CLICK (mit/ohne Token)", () => {
  const err = st({ name: "errorNetwork" });
  const withToken = R.reduce(err, { type: E.CLICK, hasToken: true });
  assert.equal(withToken.state.name, "validating");
  assert.deepEqual(withToken.effects, [FX.VALIDATE_TOKEN]);
  const withoutToken = R.reduce(err, { type: E.CLICK, hasToken: false });
  assert.equal(withoutToken.state.name, "needToken");
  assert.deepEqual(withoutToken.effects, [FX.SHOW_TOKEN_DIALOG]);
});

test("reduce: kein Zustands-Leak — Neustart aus doneUpdated setzt runId/attached/baselineSha zurueck", () => {
  const done = st({ name: "doneUpdated", runId: 999, attached: true, baselineSha: "alt", dispatchedAt: 123 });
  const r = R.reduce(done, { type: E.CLICK, hasToken: true });
  assert.equal(r.state.name, "validating");
  assert.equal(r.state.runId, null);
  assert.equal(r.state.attached, false);
  assert.equal(r.state.baselineSha, null);
  assert.equal(r.state.dispatchedAt, null);
});

// ---------------------------------------------------------------------------
// reduce: NETWORK_ERROR
// ---------------------------------------------------------------------------

test("reduce: NETWORK_ERROR in running -> errorNetwork", () => {
  const running = st({ name: "running", runId: 1, phaseStartedAt: 10 });
  const r = R.reduce(running, { type: E.NETWORK_ERROR });
  assert.equal(r.state.name, "errorNetwork");
  assert.deepEqual(r.effects, []);
});

test("reduce: NETWORK_ERROR in idle aendert nichts", () => {
  const idle = R.initialState();
  const r = R.reduce(idle, { type: E.NETWORK_ERROR });
  assert.equal(r.state.name, "idle");
  assert.deepEqual(r.effects, []);
  assert.deepEqual(r.state, idle);
});

// ---------------------------------------------------------------------------
// reduce: robustes Verhalten bei unbekannten Events
// ---------------------------------------------------------------------------

test("reduce: unbekanntes Event laesst jeden Zustand unveraendert, ohne Effects, ohne Throw", () => {
  const states = [
    "idle", "needToken", "validating", "dispatching", "locatingRun",
    "running", "awaitingPages", "doneUpdated", "doneUnchanged",
    "errorAuth", "errorDispatch", "errorRunFailed", "errorTimeout", "errorNetwork"
  ];
  for (const name of states) {
    const before = st({ name: name });
    const r = R.reduce(before, { type: "TOTAL_UNKNOWN_EVENT", at: 123 });
    assert.equal(r.state.name, name);
    assert.deepEqual(r.effects, []);
    assert.deepEqual(r.state, before);
  }
});

test("reduce: leeres/fehlendes Event wirft nicht und aendert nichts", () => {
  const s = st({ name: "running", runId: 3 });
  assert.deepEqual(R.reduce(s, undefined).state, s);
  assert.deepEqual(R.reduce(s, {}).effects, []);
});

// ---------------------------------------------------------------------------
// pickDispatchedRun
// ---------------------------------------------------------------------------

test("pickDispatchedRun: waehlt den frischen dispatch-Run nach dispatchedAt, nicht den Cron von gestern", () => {
  const runs = load("gh_runs_dispatch.json");
  const chosen = R.pickDispatchedRun(runs, "2026-07-15T10:00:00Z");
  assert.ok(chosen);
  assert.equal(chosen.id, 900000002);
  assert.equal(chosen.event, "workflow_dispatch");
});

test("pickDispatchedRun: Run 10s VOR dispatchedAt wird dank Clock-Skew (<=30s) trotzdem gewaehlt", () => {
  const runs = load("gh_runs_dispatch.json");
  // fresh Run erstellt 10:00:05; dispatchedAt 10:00:15 -> Run 10s davor, innerhalb 30s-Skew.
  const chosen = R.pickDispatchedRun(runs, "2026-07-15T10:00:15Z");
  assert.ok(chosen);
  assert.equal(chosen.id, 900000002);
});

test("pickDispatchedRun: leere workflow_runs -> null", () => {
  const runs = load("gh_runs_empty.json");
  assert.equal(R.pickDispatchedRun(runs, "2026-07-15T10:00:00Z"), null);
});

test("pickDispatchedRun: fehlendes/kaputtes Objekt -> null", () => {
  assert.equal(R.pickDispatchedRun(null, "2026-07-15T10:00:00Z"), null);
  assert.equal(R.pickDispatchedRun({}, "2026-07-15T10:00:00Z"), null);
  assert.equal(R.pickDispatchedRun({ workflow_runs: null }, "2026-07-15T10:00:00Z"), null);
});

// ---------------------------------------------------------------------------
// runOutcome
// ---------------------------------------------------------------------------

test("runOutcome: queued/in_progress -> STILL_RUNNING", () => {
  assert.equal(R.runOutcome({ status: "queued", conclusion: null }), "STILL_RUNNING");
  assert.equal(R.runOutcome({ status: "in_progress", conclusion: null }), "STILL_RUNNING");
});

test("runOutcome: completed+success -> COMPLETED_OK (Fixture)", () => {
  assert.equal(R.runOutcome(load("gh_run_completed_success.json")), "COMPLETED_OK");
});

test("runOutcome: completed+failure -> COMPLETED_FAILED (Fixture)", () => {
  assert.equal(R.runOutcome(load("gh_run_completed_failure.json")), "COMPLETED_FAILED");
});

test("runOutcome: completed+skipped -> COMPLETED_FAILED", () => {
  assert.equal(R.runOutcome({ status: "completed", conclusion: "skipped" }), "COMPLETED_FAILED");
});

// ---------------------------------------------------------------------------
// dataChanged
// ---------------------------------------------------------------------------

test("dataChanged: identische Texte -> false", () => {
  const base = { history: "H", videos: "V" };
  const fresh = { history: "H", videos: "V" };
  assert.equal(R.dataChanged(base, fresh), false);
});

test("dataChanged: geaenderter history-Text -> true", () => {
  assert.equal(R.dataChanged({ history: "H", videos: "V" }, { history: "H2", videos: "V" }), true);
});

test("dataChanged: nur geaenderter videos-Text -> true", () => {
  assert.equal(R.dataChanged({ history: "H", videos: "V" }, { history: "H", videos: "V2" }), true);
});

test("dataChanged: fresh null/fehlend -> false", () => {
  assert.equal(R.dataChanged({ history: "H", videos: "V" }, null), false);
  // fehlende Einzelfelder im fresh zaehlen als unveraendert
  assert.equal(R.dataChanged({ history: "H", videos: "V" }, { history: null, videos: undefined }), false);
});

// ---------------------------------------------------------------------------
// statusText
// ---------------------------------------------------------------------------

test("statusText: idle/needToken leer, alle anderen Zustaende nicht-leer", () => {
  assert.equal(R.statusText(st({ name: "idle" })), "");
  assert.equal(R.statusText(st({ name: "needToken" })), "");
  const nonEmpty = [
    "validating", "dispatching", "locatingRun", "running", "awaitingPages",
    "doneUpdated", "doneUnchanged", "errorAuth", "errorDispatch",
    "errorRunFailed", "errorTimeout", "errorNetwork"
  ];
  for (const name of nonEmpty) {
    const txt = R.statusText(st({ name: name }));
    assert.equal(typeof txt, "string");
    assert.ok(txt.length > 0, "erwartet nicht-leeren Text fuer " + name);
  }
});

test("statusText: doneUpdated enthaelt NICHT das Wort 'Video'", () => {
  const txt = R.statusText(st({ name: "doneUpdated" }));
  assert.ok(txt.length > 0);
  assert.ok(!txt.includes("Video"));
});

test("statusText: errorTimeout(awaitingPages) unterscheidet sich vom generischen errorTimeout", () => {
  const pages = R.statusText(st({ name: "errorTimeout", timeoutPhase: "awaitingPages" }));
  const generic = R.statusText(st({ name: "errorTimeout", timeoutPhase: "running" }));
  assert.notEqual(pages, generic);
  assert.ok(pages.length > 0 && generic.length > 0);
});

// ---------------------------------------------------------------------------
// pollDelay / isBusy / TIMEOUTS
// ---------------------------------------------------------------------------

test("pollDelay: 3000/5000/10000 fuer die pollenden Zustaende, 0 sonst", () => {
  assert.equal(R.pollDelay("locatingRun"), 3000);
  assert.equal(R.pollDelay("running"), 5000);
  assert.equal(R.pollDelay("awaitingPages"), 10000);
  assert.equal(R.pollDelay("idle"), 0);
  assert.equal(R.pollDelay("doneUpdated"), 0);
  assert.equal(R.pollDelay("unbekannt"), 0);
});

test("isBusy: true nur fuer die 5 aktiven Zustaende", () => {
  const busy = ["validating", "dispatching", "locatingRun", "running", "awaitingPages"];
  for (const name of busy) assert.equal(R.isBusy(name), true, name + " sollte busy sein");
  const idleStates = [
    "idle", "needToken", "doneUpdated", "doneUnchanged",
    "errorAuth", "errorDispatch", "errorRunFailed", "errorTimeout", "errorNetwork"
  ];
  for (const name of idleStates) assert.equal(R.isBusy(name), false, name + " sollte nicht busy sein");
});

test("TIMEOUTS: exportierte Grenzen 60s / 12min / 5min", () => {
  assert.equal(R.TIMEOUTS.locatingRun, 60000);
  assert.equal(R.TIMEOUTS.running, 720000);
  assert.equal(R.TIMEOUTS.awaitingPages, 300000);
});
