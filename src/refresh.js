// Reiner, testbarer Kern fuer den "Jetzt aktualisieren"-Button des Duell-Dashboards.
// Laeuft als klassisches Browser-Script (window.DUELL_REFRESH) UND als CommonJS-Modul (Tests).
//
// Dieser Kern ist PUR: kein DOM, kein fetch, kein Date.now(), keine Timer. Jede Zeitangabe
// kommt ueber Event-Payloads herein (Feld `at` = ms-Timestamp). Die DOM/Fetch-Glue-Schicht
// wird spaeter separat UNTER diesem UMD-Block ergaenzt (siehe Platzhalter am Dateiende).
//
// -- SHAPES ------------------------------------------------------------------
// State: {
//   name,            // einer der Zustaende (siehe EVENTS/Tabelle unten)
//   attached,        // true = wir haben uns an einen bereits laufenden Run gehaengt
//   dispatchedAt,    // ms-Timestamp des erfolgreichen Dispatch (oder null)
//   runId,           // GitHub-Actions Run-Id (oder null)
//   baselineSha,     // Commit-SHA vor dem Dispatch, fuer den spaeteren Vergleich (oder null)
//   phaseStartedAt,  // ms-Timestamp des Eintritts in die aktuelle Phase (fuer Timeouts)
//   timeoutPhase     // Phase, in der ein Timeout passierte (fuer die Statustexte) oder null
// }
//
// Event: { type, ...payload }  -- type ist ein Wert aus EVENTS.
//   Wichtige Payload-Felder: at (ms), hasToken, activeRun ({id}|null), baselineSha,
//   runId, conclusion, shaChanged.
//
// Effect: String-Konstante aus EFFECTS. reduce() liefert { state, effects: [ ... ] }.
//   Die Glue-Schicht fuehrt die Effects aus (Dialog zeigen, Token loeschen, pollen, Daten anwenden).
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DUELL_REFRESH = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Event-Typen (kommen von der Glue-Schicht bzw. den Timern).
  const EVENTS = {
    CLICK: "CLICK",
    TOKEN_SUBMITTED: "TOKEN_SUBMITTED",
    CANCELLED: "CANCELLED",
    VALIDATE_OK: "VALIDATE_OK",
    AUTH_FAILED: "AUTH_FAILED",
    DISPATCH_OK: "DISPATCH_OK",
    DISPATCH_FAILED: "DISPATCH_FAILED",
    RUN_FOUND: "RUN_FOUND",
    RUN_COMPLETED: "RUN_COMPLETED",
    DATA_CHANGED: "DATA_CHANGED",
    TICK: "TICK",
    NETWORK_ERROR: "NETWORK_ERROR"
  };

  // Effect-Konstanten. reduce() gibt sie als Array zurueck; die Glue fuehrt sie aus.
  const EFFECTS = {
    SHOW_TOKEN_DIALOG: "SHOW_TOKEN_DIALOG",
    CLEAR_TOKEN: "CLEAR_TOKEN",
    VALIDATE_TOKEN: "VALIDATE_TOKEN",
    DISPATCH: "DISPATCH",
    START_POLL: "START_POLL",
    APPLY_DATA: "APPLY_DATA"
  };

  // Timeout-Grenzen je Phase (ms). running deckt auch die Dispatch->Fertig-Spanne ab.
  const TIMEOUTS = {
    locatingRun: 60000,
    running: 720000,
    awaitingPages: 300000
  };

  // Poll-Intervalle je Zustand (ms). 0 = nicht pollen.
  const POLL_DELAYS = {
    locatingRun: 3000,
    running: 5000,
    awaitingPages: 10000
  };

  // Clock-Skew-Marge (ms) fuer das Zuordnen des frisch dispatchten Runs.
  const RUN_MATCH_SKEW = 30000;

  // Conclusions, die als Fehlschlag zaehlen.
  const FAIL_CONCLUSIONS = ["failure", "cancelled", "skipped", "timed_out"];

  function initialState() {
    return {
      name: "idle",
      attached: false,
      dispatchedAt: null,
      runId: null,
      baselineSha: null,
      phaseStartedAt: null,
      timeoutPhase: null
    };
  }

  // Flacher Merge auf Basis von initialState -- so bleiben nicht gesetzte Felder auf ihren Defaults.
  function make(overrides) {
    const base = initialState();
    if (overrides) {
      for (const k in overrides) {
        if (Object.prototype.hasOwnProperty.call(overrides, k)) base[k] = overrides[k];
      }
    }
    return base;
  }

  function noChange(state) {
    return { state: state, effects: [] };
  }

  // Startet (oder startet neu) aus einem Klick heraus: mit Token -> validieren,
  // ohne Token -> Dialog. Wird von idle UND von den Ende-/Fehlerzustaenden genutzt.
  function fromClick(event) {
    if (event && event.hasToken) {
      return { state: make({ name: "validating" }), effects: [EFFECTS.VALIDATE_TOKEN] };
    }
    return { state: make({ name: "needToken" }), effects: [EFFECTS.SHOW_TOKEN_DIALOG] };
  }

  // Zentrale Zustandsmaschine. Unbekannte/unpassende Events lassen den Zustand unveraendert
  // (defensiv, kein Throw). Zeit kommt ausschliesslich ueber event.at herein.
  function reduce(state, event) {
    if (!state) state = initialState();
    if (!event || !event.type) return noChange(state);

    const t = event.type;
    const name = state.name;

    // NETWORK_ERROR bricht aus jedem "aktiven" Zustand heraus (nicht aus idle/done*/error*).
    if (t === EVENTS.NETWORK_ERROR) {
      if (isBusy(name)) return { state: make({ name: "errorNetwork" }), effects: [] };
      return noChange(state);
    }

    switch (name) {
      case "idle":
        if (t === EVENTS.CLICK) return fromClick(event);
        return noChange(state);

      case "needToken":
        if (t === EVENTS.TOKEN_SUBMITTED) {
          return { state: make({ name: "validating" }), effects: [EFFECTS.VALIDATE_TOKEN] };
        }
        if (t === EVENTS.CANCELLED) {
          return { state: make({ name: "idle" }), effects: [] };
        }
        return noChange(state);

      case "validating":
        if (t === EVENTS.VALIDATE_OK) {
          if (event.activeRun && event.activeRun.id != null) {
            // An einen bereits laufenden Run haengen. baselineSha auch hier behalten,
            // damit der SHA-Vergleich nach Run-Ende funktioniert.
            return {
              state: make({
                name: "running",
                attached: true,
                runId: event.activeRun.id,
                baselineSha: event.baselineSha != null ? event.baselineSha : null,
                phaseStartedAt: event.at != null ? event.at : null,
                dispatchedAt: event.at != null ? event.at : null
              }),
              effects: [EFFECTS.START_POLL]
            };
          }
          // Kein laufender Run -> selbst dispatchen. Baseline-SHA merken.
          return {
            state: make({ name: "dispatching", baselineSha: event.baselineSha != null ? event.baselineSha : null }),
            effects: [EFFECTS.DISPATCH]
          };
        }
        if (t === EVENTS.AUTH_FAILED) {
          return { state: make({ name: "needToken" }), effects: [EFFECTS.CLEAR_TOKEN, EFFECTS.SHOW_TOKEN_DIALOG] };
        }
        return noChange(state);

      case "dispatching":
        if (t === EVENTS.DISPATCH_OK) {
          const at = event.at != null ? event.at : null;
          return {
            state: make({ name: "locatingRun", baselineSha: state.baselineSha, dispatchedAt: at, phaseStartedAt: at }),
            effects: [EFFECTS.START_POLL]
          };
        }
        if (t === EVENTS.AUTH_FAILED) {
          return { state: make({ name: "needToken" }), effects: [EFFECTS.CLEAR_TOKEN, EFFECTS.SHOW_TOKEN_DIALOG] };
        }
        if (t === EVENTS.DISPATCH_FAILED) {
          return { state: make({ name: "errorDispatch" }), effects: [] };
        }
        return noChange(state);

      case "locatingRun":
        if (t === EVENTS.RUN_FOUND && event.runId != null) {
          return {
            state: make({
              name: "running",
              attached: state.attached,
              runId: event.runId,
              baselineSha: state.baselineSha,
              dispatchedAt: state.dispatchedAt,
              phaseStartedAt: state.phaseStartedAt
            }),
            effects: []
          };
        }
        if (t === EVENTS.TICK) {
          if (timedOut(state, event, TIMEOUTS.locatingRun)) {
            return { state: make({ name: "errorTimeout", timeoutPhase: "locatingRun" }), effects: [] };
          }
          return noChange(state);
        }
        return noChange(state);

      case "running":
        if (t === EVENTS.RUN_COMPLETED) {
          if (event.conclusion === "success") {
            // shaChanged entscheidet: neue Daten -> auf Pages-Deploy warten, sonst fertig-unveraendert.
            // Gilt auch im Attach-Fall: die Glue liefert dort ebenfalls einen shaChanged-Vergleich.
            if (event.shaChanged) {
              return {
                state: make({
                  name: "awaitingPages",
                  attached: state.attached,
                  runId: state.runId,
                  baselineSha: state.baselineSha,
                  dispatchedAt: state.dispatchedAt,
                  phaseStartedAt: event.at != null ? event.at : null
                }),
                effects: []
              };
            }
            return { state: make({ name: "doneUnchanged" }), effects: [] };
          }
          if (FAIL_CONCLUSIONS.indexOf(event.conclusion) !== -1) {
            return { state: make({ name: "errorRunFailed" }), effects: [] };
          }
          return noChange(state);
        }
        if (t === EVENTS.TICK) {
          // Timeout relativ zum Phasenstart (bzw. Dispatch-Zeitpunkt als Fallback).
          const anchor = state.phaseStartedAt != null ? state.phaseStartedAt : state.dispatchedAt;
          if (anchor != null && event.at != null && event.at - anchor > TIMEOUTS.running) {
            return { state: make({ name: "errorTimeout", timeoutPhase: "running" }), effects: [] };
          }
          return noChange(state);
        }
        return noChange(state);

      case "awaitingPages":
        if (t === EVENTS.DATA_CHANGED) {
          return { state: make({ name: "doneUpdated" }), effects: [EFFECTS.APPLY_DATA] };
        }
        if (t === EVENTS.TICK) {
          if (timedOut(state, event, TIMEOUTS.awaitingPages)) {
            return { state: make({ name: "errorTimeout", timeoutPhase: "awaitingPages" }), effects: [] };
          }
          return noChange(state);
        }
        return noChange(state);

      // Ende- und Fehlerzustaende: ein erneuter Klick startet frisch (wie idle-CLICK).
      case "doneUpdated":
      case "doneUnchanged":
      case "errorAuth":
      case "errorDispatch":
      case "errorRunFailed":
      case "errorTimeout":
      case "errorNetwork":
        if (t === EVENTS.CLICK) return fromClick(event);
        return noChange(state);

      default:
        return noChange(state);
    }
  }

  // Timeout-Check gegen phaseStartedAt anhand event.at. Fehlt eine der Zeiten -> kein Timeout.
  function timedOut(state, event, limit) {
    if (!state || state.phaseStartedAt == null || !event || event.at == null) return false;
    return event.at - state.phaseStartedAt > limit;
  }

  // Waehlt den neuesten workflow_dispatch-Run, dessen created_at >= dispatchedAt - Skew liegt.
  // runsJson: { workflow_runs: [{ id, event, status, conclusion, created_at, ... }] }.
  // Kein Treffer / leere / fehlende Liste -> null.
  function pickDispatchedRun(runsJson, dispatchedAtIso) {
    const runs = runsJson && runsJson.workflow_runs;
    if (!runs || !runs.length) return null;
    const threshold = Date.parse(dispatchedAtIso) - RUN_MATCH_SKEW;
    let best = null;
    let bestT = -Infinity;
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      const created = Date.parse(r.created_at);
      if (isNaN(created) || created < threshold) continue;
      if (created > bestT) { bestT = created; best = r; }
    }
    return best;
  }

  // Run-Ausgang aus { status, conclusion }.
  function runOutcome(runJson) {
    if (!runJson || runJson.status !== "completed") return "STILL_RUNNING";
    return runJson.conclusion === "success" ? "COMPLETED_OK" : "COMPLETED_FAILED";
  }

  // Vergleicht zwei { history, videos }-Objekte mit ROH-TEXT-Strings (Response-Texte).
  // true, sobald sich mindestens einer unterscheidet. Fehlender fresh-Text zaehlt als
  // unveraendert (defensiv gegen null/undefined -- ein nicht geladener Text loest nichts aus).
  function dataChanged(baseline, fresh) {
    if (!baseline || !fresh) return false;
    const keys = ["history", "videos"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const f = fresh[k];
      if (f == null) continue; // fehlender frischer Text -> als unveraendert werten
      if (f !== baseline[k]) return true;
    }
    return false;
  }

  // Zustand -> deutscher UI-Text (mit echten Umlauten!). idle/needToken bleiben leer.
  function statusText(state) {
    const name = state && state.name;
    switch (name) {
      case "idle": return "";
      case "needToken": return "";
      case "validating": return "Prüfe Zugang …";
      case "dispatching": return "Starte Daten-Lauf …";
      case "locatingRun": return "Warte auf den Start des Laufs …";
      case "running":
        return state.attached
          ? "Ein Update läuft bereits — ich warte mit."
          : "Daten-Lauf läuft … (ca. 1–2 Minuten)";
      case "awaitingPages": return "Lauf fertig — warte auf die Veröffentlichung …";
      case "doneUpdated": return "Aktualisiert — Follower und Likes sind frisch.";
      case "doneUnchanged": return "Keine neuen Daten — alles schon aktuell.";
      case "errorAuth": return "Token ungültig oder abgelaufen — bitte neu eingeben.";
      case "errorDispatch": return "Konnte den Lauf nicht starten — später erneut versuchen.";
      case "errorRunFailed": return "Der Daten-Lauf ist fehlgeschlagen. Details im Actions-Tab auf GitHub.";
      case "errorTimeout":
        return state.timeoutPhase === "awaitingPages"
          ? "Die Veröffentlichung dauert länger — beim nächsten Laden der Seite sind die Daten da."
          : "Zeitüberschreitung — bitte später erneut versuchen.";
      case "errorNetwork": return "Keine Verbindung zu GitHub — später erneut versuchen.";
      default: return "";
    }
  }

  // Poll-Intervall (ms) fuer einen Zustandsnamen; 0 = nicht pollen.
  function pollDelay(stateName) {
    return POLL_DELAYS[stateName] || 0;
  }

  // true, solange ein Lauf aktiv verfolgt wird (Button disabled).
  function isBusy(stateName) {
    return stateName === "validating" || stateName === "dispatching" ||
      stateName === "locatingRun" || stateName === "running" || stateName === "awaitingPages";
  }

  return {
    initialState, reduce, EVENTS, EFFECTS, TIMEOUTS,
    pickDispatchedRun, runOutcome, dataChanged, statusText, pollDelay, isBusy
  };
});

// ============================================================================
// DOM-Glue + GitHub-Client — ab hier Browser-only (in Node/Tests inert).
// ============================================================================
(function () {
  "use strict";
  if (typeof document === "undefined" || typeof window === "undefined") return;

  var R = window.DUELL_REFRESH;

  var API = "https://api.github.com/repos/lachmannmika-coder/tiktok-duel";
  var WORKFLOW = "daily.yml";
  var LS_KEY = "duell.gh.pat";

  // In-Memory-Fallback, falls localStorage nicht verfuegbar ist (z. B. Private Mode).
  var memToken = null;

  function getToken() {
    try { return window.localStorage.getItem(LS_KEY) || memToken; }
    catch (e) { return memToken; }
  }
  function setToken(value) {
    memToken = value;
    try { window.localStorage.setItem(LS_KEY, value); } catch (e) { /* Fallback reicht */ }
  }
  function clearToken() {
    memToken = null;
    try { window.localStorage.removeItem(LS_KEY); } catch (e) { /* egal */ }
  }

  // Einziger Weg zu api.github.com: Token nur im Authorization-Header, nie in URLs/Logs.
  function gh(path, opts) {
    var headers = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": "Bearer " + getToken()
    };
    var init = { method: (opts && opts.method) || "GET", headers: headers, cache: "no-store" };
    if (opts && opts.body) init.body = opts.body;
    return window.fetch(API + path, init);
  }

  // ---- Zustand + UI ---------------------------------------------------------

  var state = R.initialState();
  var pollTimer = null;
  var baselineTexts = null;  // { history, videos } als Roh-Text vor dem Dispatch
  var freshParsed = null;    // { db, videos } geparst, sobald neue Daten gesehen wurden

  var btn = document.getElementById("refresh-btn");
  var statusEl = document.getElementById("refresh-status");
  var dialog = document.getElementById("refresh-dialog");
  var tokenInput = document.getElementById("refresh-token-input");
  var dialogError = document.getElementById("refresh-dialog-error");
  var cancelBtn = document.getElementById("refresh-cancel");
  var saveBtn = document.getElementById("refresh-save");

  function updateUi() {
    var busy = R.isBusy(state.name);
    btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
    btn.textContent = busy ? "Aktualisiere …" : "Jetzt aktualisieren";
    statusEl.textContent = R.statusText(state);
    statusEl.classList.toggle("refresh-status--error", /^error/.test(state.name));
  }

  // Zentraler Einstieg: Event durch den Reducer, UI nachziehen, Effects ausfuehren, Poll planen.
  function send(event) {
    var res = R.reduce(state, event);
    state = res.state;
    updateUi();
    for (var i = 0; i < res.effects.length; i++) runEffect(res.effects[i], res.effects);
    schedulePoll();
  }

  function runEffect(effect, all) {
    if (effect === R.EFFECTS.SHOW_TOKEN_DIALOG) {
      // Nach einem 401 (CLEAR_TOKEN im selben Effect-Satz) den Grund im Dialog anzeigen.
      openDialog(all.indexOf(R.EFFECTS.CLEAR_TOKEN) !== -1
        ? "Token ungültig oder abgelaufen — bitte neu eingeben."
        : null);
    } else if (effect === R.EFFECTS.CLEAR_TOKEN) {
      clearToken();
    } else if (effect === R.EFFECTS.VALIDATE_TOKEN) {
      effectValidate();
    } else if (effect === R.EFFECTS.DISPATCH) {
      effectDispatch();
    } else if (effect === R.EFFECTS.APPLY_DATA) {
      if (freshParsed && window.DUELL_DASHBOARD) {
        window.DUELL_DASHBOARD.applyData(freshParsed.db, freshParsed.videos);
      }
    }
    // START_POLL braucht nichts Eigenes: schedulePoll() laeuft nach jedem send().
  }

  // ---- Effects: Validieren + Dispatchen --------------------------------------

  // Prueft Token/Zugang, sucht einen evtl. schon laufenden Run, merkt Baseline
  // (Commit-SHA + Roh-Texte der Daten-JSONs) und meldet dann VALIDATE_OK.
  function effectValidate() {
    var activeRun = null;
    gh("/actions/workflows/" + WORKFLOW).then(function (res) {
      if (res.status === 401 || res.status === 403) throw { auth: true };
      if (!res.ok) throw { net: true };
      return gh("/actions/workflows/" + WORKFLOW + "/runs?per_page=5");
    }).then(function (res) {
      if (!res.ok) throw { net: true };
      return res.json();
    }).then(function (runs) {
      var list = (runs && runs.workflow_runs) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].status === "queued" || list[i].status === "in_progress") {
          activeRun = { id: list[i].id };
          break;
        }
      }
      return gh("/commits?per_page=1&sha=main");
    }).then(function (res) {
      if (!res.ok) throw { net: true };
      return res.json();
    }).then(function (commits) {
      var sha = commits && commits[0] && commits[0].sha;
      return captureBaseline().then(function () {
        send({ type: R.EVENTS.VALIDATE_OK, activeRun: activeRun, baselineSha: sha || null, at: Date.now() });
      });
    }).catch(handleFetchError);
  }

  function effectDispatch() {
    gh("/actions/workflows/" + WORKFLOW + "/dispatches", {
      method: "POST",
      body: JSON.stringify({ ref: "main" })
    }).then(function (res) {
      if (res.status === 204) send({ type: R.EVENTS.DISPATCH_OK, at: Date.now() });
      else if (res.status === 401 || res.status === 403) send({ type: R.EVENTS.AUTH_FAILED });
      else send({ type: R.EVENTS.DISPATCH_FAILED });
    }).catch(handleFetchError);
  }

  function handleFetchError(err) {
    if (err && err.auth) send({ type: R.EVENTS.AUTH_FAILED });
    else send({ type: R.EVENTS.NETWORK_ERROR });
  }

  // Roh-Texte der ausgelieferten JSONs festhalten (Cache-Buster gegen den Pages-CDN).
  function captureBaseline() {
    return fetchDataTexts().then(function (texts) { baselineTexts = texts; });
  }

  function fetchDataTexts() {
    var bust = "?ts=" + Date.now();
    function txt(url) {
      return window.fetch(url + bust, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .catch(function () { return null; });
    }
    return Promise.all([txt("data/history.json"), txt("data/videos.json")])
      .then(function (both) { return { history: both[0], videos: both[1] }; });
  }

  // ---- Poll-Loop --------------------------------------------------------------

  function schedulePoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    var delay = R.pollDelay(state.name);
    if (!delay) return;
    pollTimer = setTimeout(pollOnce, delay);
  }

  function pollOnce() {
    pollTimer = null;
    if (state.name === "locatingRun") pollLocating();
    else if (state.name === "running") pollRunning();
    else if (state.name === "awaitingPages") pollPages();
  }

  function pollLocating() {
    gh("/actions/workflows/" + WORKFLOW + "/runs?event=workflow_dispatch&per_page=5")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (runs) {
        var run = runs ? R.pickDispatchedRun(runs, new Date(state.dispatchedAt).toISOString()) : null;
        if (run) send({ type: R.EVENTS.RUN_FOUND, runId: run.id, at: Date.now() });
        else send({ type: R.EVENTS.TICK, at: Date.now() });
      }).catch(handleFetchError);
  }

  function pollRunning() {
    gh("/actions/runs/" + state.runId)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (run) {
        var outcome = run ? R.runOutcome(run) : "STILL_RUNNING";
        if (outcome === "STILL_RUNNING") { send({ type: R.EVENTS.TICK, at: Date.now() }); return; }
        if (outcome === "COMPLETED_FAILED") {
          send({ type: R.EVENTS.RUN_COMPLETED, conclusion: run.conclusion || "failure", at: Date.now() });
          return;
        }
        // Erfolg: pruefen, ob der Lauf etwas committet hat (Head-SHA vs. Baseline).
        gh("/commits?per_page=1&sha=main")
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (commits) {
            var sha = commits && commits[0] && commits[0].sha;
            var changed = !!(sha && state.baselineSha && sha !== state.baselineSha);
            send({ type: R.EVENTS.RUN_COMPLETED, conclusion: "success", shaChanged: changed, at: Date.now() });
          }).catch(handleFetchError);
      }).catch(handleFetchError);
  }

  function pollPages() {
    fetchDataTexts().then(function (texts) {
      if (R.dataChanged(baselineTexts, texts)) {
        try {
          freshParsed = {
            db: texts.history != null ? JSON.parse(texts.history) : null,
            videos: texts.videos != null ? JSON.parse(texts.videos) : undefined
          };
          send({ type: R.EVENTS.DATA_CHANGED, at: Date.now() });
          return;
        } catch (e) { /* halber Deploy — beim naechsten Poll erneut versuchen */ }
      }
      send({ type: R.EVENTS.TICK, at: Date.now() });
    });
  }

  // ---- Token-Dialog ------------------------------------------------------------

  function openDialog(errorMsg) {
    if (!dialog || typeof dialog.showModal !== "function") {
      // Uralt-Browser ohne <dialog>: schlichter Prompt als Fallback.
      var v = window.prompt("GitHub Personal Access Token (Actions: Read and write, nur tiktok-duel):");
      if (v) { setToken(v.trim()); send({ type: R.EVENTS.TOKEN_SUBMITTED }); }
      else send({ type: R.EVENTS.CANCELLED });
      return;
    }
    tokenInput.value = "";
    showDialogError(errorMsg);
    dialog.showModal();
  }

  function showDialogError(msg) {
    dialogError.textContent = msg || "";
    dialogError.hidden = !msg;
  }

  function onDialogSubmit(e) {
    e.preventDefault();
    var candidate = tokenInput.value.trim();
    if (!candidate) { showDialogError("Bitte ein Token eingeben."); return; }
    saveBtn.disabled = true;
    // Validierung VOR dem Speichern: erst wenn GitHub das Token akzeptiert, wird es abgelegt.
    window.fetch(API + "/actions/workflows/" + WORKFLOW, {
      headers: {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": "Bearer " + candidate
      },
      cache: "no-store"
    }).then(function (res) {
      saveBtn.disabled = false;
      if (res.ok) {
        setToken(candidate);
        tokenInput.value = "";
        send({ type: R.EVENTS.TOKEN_SUBMITTED }); // vor close(), damit der close-Handler kein CANCELLED sendet
        dialog.close("save");
      } else if (res.status === 401 || res.status === 403) {
        showDialogError("Token wird nicht akzeptiert — Berechtigung „Actions: Read and write“ auf tiktok-duel nötig.");
      } else {
        showDialogError("GitHub antwortet nicht wie erwartet (HTTP " + res.status + ") — später erneut versuchen.");
      }
    }).catch(function () {
      saveBtn.disabled = false;
      showDialogError("Keine Verbindung zu GitHub — später erneut versuchen.");
    });
  }

  // ---- Verkabelung ---------------------------------------------------------------

  function init() {
    if (!btn || !statusEl) return;
    var proto = window.location.protocol;
    // Nur auf http(s) sinnvoll (fetch + CORS); ueber file:// bleibt der Button versteckt.
    if (proto !== "http:" && proto !== "https:") return;
    if (typeof window.fetch !== "function" || !window.DUELL_DASHBOARD) return;

    btn.hidden = false;
    btn.addEventListener("click", function () {
      if (R.isBusy(state.name)) return; // doppelte Klicks waehrend eines Laufs ignorieren
      send({ type: R.EVENTS.CLICK, hasToken: !!getToken(), at: Date.now() });
    });

    if (dialog) {
      dialog.addEventListener("submit", onDialogSubmit);
      cancelBtn.addEventListener("click", function () { dialog.close("cancel"); });
      dialog.addEventListener("close", function () {
        // Nur ein echter Abbruch (Esc/Abbrechen) meldet CANCELLED; nach erfolgreichem
        // Submit ist der Zustand schon weiter (validating) und nichts passiert.
        if (state.name === "needToken") send({ type: R.EVENTS.CANCELLED });
      });
    }

    updateUi();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
