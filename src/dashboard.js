// Dashboard-Verkabelung (Phase 4a): Hero, KPI-Karten, Chart "Das Rennen", Meilensteine.
// Klassisches Browser-Script (kein ESM), laeuft auch via file:// ohne fetch (SEED-Fallback).
// Nutzt window.DUELL (logic.js) + window.DUELL_CONFIG (config.js). logic.js bleibt DOM-frei.
(function () {
  "use strict";
  var L = window.DUELL, CFG = window.DUELL_CONFIG;

  // =========================================================================
  // Fundament (gemeinsam fuer Phase 4a UND 4b: Helfer, Laden, State)
  // =========================================================================

  // Bildet die echte Datenlage nach: 5 Snapshots inkl. 18-Tage-Luecke 21.06. -> 09.07.
  // Bei den juengeren Snapshots hat nur Seite a ein viewsTotal (fehlendes viewsTotal
  // bei b ist ein realer Fall und wird NIE als 0 behandelt).
  var SEED = {
    creators: {
      a: { handle: "mika.nature.enjoyer", nickname: "Mika" },
      b: { handle: "tego..11", nickname: "Tino" }
    },
    snapshots: [
      { date: "2026-06-21",
        a: { followers: 129, following: 453, likes: 23057, videos: 30 },
        b: { followers: 24, following: 19, likes: 858, videos: 7 } },
      { date: "2026-07-09",
        a: { followers: 171, following: 460, likes: 55776, videos: 37 },
        b: { followers: 25, following: 33, likes: 1022, videos: 12 } },
      { date: "2026-07-10",
        a: { followers: 171, following: 460, likes: 55793, videos: 37 },
        b: { followers: 25, following: 33, likes: 1025, videos: 12 } },
      { date: "2026-07-11",
        a: { followers: 173, following: 460, likes: 55822, videos: 37, viewsTotal: 337465 },
        b: { followers: 26, following: 33, likes: 1029, videos: 12 } },
      { date: "2026-07-12",
        a: { followers: 173, following: 460, likes: 55870, videos: 38, viewsTotal: 338669 },
        b: { followers: 26, following: 33, likes: 1030, videos: 12 } }
    ]
  };

  var $ = function (id) { return document.getElementById(id); };
  var SEP = " · "; // &ensp;·&ensp;

  function fmt(n) { return Math.round(n).toLocaleString("de-CH"); }
  function fmt1(n) {
    return Number(n).toLocaleString("de-CH", { maximumFractionDigits: 1 });
  }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n)); }
  function deDateFull(iso) { var p = iso.split("-"); return p[2] + "." + p[1] + "." + p[0]; }
  function deDateShort(iso) { var p = iso.split("-"); return p[2] + "." + p[1] + "."; }
  function deltaClass(n) { return n > 0 ? "delta--pos" : n < 0 ? "delta--neg" : "delta--neutral"; }
  function setText(id, txt) { var el = $(id); if (el) el.textContent = txt; }
  function tagen(n) { return n === 1 ? "1 Tag" : n + " Tagen"; } // Dativ: "in 41 Tagen"

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function qparam(name) {
    var m = new RegExp("[?&]" + name + "=([^&]+)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function loadJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " HTTP " + r.status);
      return r.json();
    });
  }

  // ?data=test/fixtures/… laedt gezielt eine Fixture; via file:// greift der SEED.
  function loadData() {
    if (typeof fetch === "undefined") return Promise.resolve(SEED);
    var url = qparam("data") || "data/history.json";
    return loadJSON(url).then(function (j) {
      if (j && j.snapshots) return j;
      return SEED;
    }).catch(function () { return SEED; });
  }

  function creators(db) { return (db && db.creators) || SEED.creators; }
  function nick(db, side) { return creators(db)[side].nickname; }

  // Count-up auf dem grossen Follower-Wert; bei reduced motion sofort setzen.
  var countAnims = {};
  function countUp(el, target) {
    if (!el) return;
    if (countAnims[el.id]) cancelAnimationFrame(countAnims[el.id]);
    if (reducedMotion()) { el.textContent = fmt(target); return; }
    var t0 = performance.now(), dur = 700;
    function step(t) {
      var p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) countAnims[el.id] = requestAnimationFrame(step);
    }
    countAnims[el.id] = requestAnimationFrame(step);
  }

  var state = { db: null, mode: "daily", range: "all" };

  // =========================================================================
  // Sektion 2: Hero — Sieger des Tages
  // =========================================================================

  function setScore(el, x, y) {
    if (!el) return;
    el.innerHTML = fmt(x) + '&nbsp;<span class="score-sep">:</span>&nbsp;' + fmt(y);
    el.setAttribute("aria-label", "Punktestand " + fmt(x) + " zu " + fmt(y));
  }

  // Avatar-Bild neu aufbauen (das alte kann per onerror bereits entfernt sein).
  function setHeroAvatar(side, initial) {
    var box = document.querySelector("#hero-main .hero-avatar");
    if (!box) return;
    setText("hero-avatar-initialen", initial);
    var old = $("hero-avatar-img");
    if (old) old.remove();
    var img = document.createElement("img");
    img.id = "hero-avatar-img";
    img.alt = "";
    img.addEventListener("error", function () { img.remove(); });
    img.src = "assets/avatars/" + side + ".jpg";
    box.appendChild(img);
  }

  function breakdownText(sc) {
    var w = CFG.scoring;
    var f = sc.parts.followers.value, l = sc.parts.likes.value, v = sc.parts.videos.value;
    return signed(f) + " Follower ×" + w.followers + SEP +
      signed(l) + " Likes" + SEP +
      fmt(v) + " Video" + (Math.abs(v) === 1 ? "" : "s") + " ×" + w.videos;
  }

  function renderHero(db, snaps) {
    var hero = $("hero");
    var main = $("hero-main"), tie = $("hero-tie"), gap = $("hero-gap");
    if (!hero || !main || !tie || !gap) return;

    var dw = L.dayWinner(snaps, CFG.scoring);

    // Chips: Streak + W:L (7 Tage); Countdown tickt separat (startCountdown).
    var st = L.streak(snaps, CFG.scoring);
    setText("hero-streak", st.count > 0
      ? nick(db, st.side) + " ×" + st.count + (st.count > 1 ? " — " + st.count + " Tage in Folge" : "")
      : "keine Serie");
    var wl = L.winLoss7d(snaps, CFG.scoring);
    var persp = (dw.hasResult && !dw.isGap && dw.winner) ? dw.winner : "a";
    setText("hero-wl", nick(db, persp) + " " + wl[persp].wins + ":" + wl[persp].losses);

    // Genau EINE Modifier-Klasse; inaktive Varianten-Bloecke [hidden].
    hero.classList.remove("hero--win-a", "hero--win-b", "hero--tie", "hero--gap");
    main.hidden = true; tie.hidden = true; gap.hidden = true;

    if (!dw.hasResult) {
      hero.classList.add("hero--gap");
      gap.hidden = false;
      setText("hero-gap-span", "Verlauf startet — ab dem zweiten Schnappschuss gibt es Tageswertungen.");
      return;
    }
    if (dw.isGap) {
      hero.classList.add("hero--gap");
      gap.hidden = false;
      setText("hero-gap-span", "über " + dw.spanDays + " Tage — kein Tagessieg");
      return;
    }
    if (!dw.winner) {
      hero.classList.add("hero--tie");
      tie.hidden = false;
      setScore($("hero-tie-score"), dw.scoreA.total, dw.scoreB.total);
      return;
    }
    hero.classList.add(dw.winner === "a" ? "hero--win-a" : "hero--win-b");
    main.hidden = false;
    var name = nick(db, dw.winner);
    var winScore = dw.winner === "a" ? dw.scoreA : dw.scoreB;
    var loseScore = dw.winner === "a" ? dw.scoreB : dw.scoreA;
    setText("hero-winner-name", name);
    setScore($("hero-score"), winScore.total, loseScore.total); // Sieger zuerst
    setText("hero-breakdown", breakdownText(winScore));
    setHeroAvatar(dw.winner, name.charAt(0).toUpperCase());
  }

  // Countdown bis zum naechsten Daten-Lauf: nur Text, tickt alle 30 s.
  var countdownTimer = null;
  function startCountdown() {
    var el = $("hero-countdown");
    if (!el) return;
    function tick() {
      var next = L.nextUpdate(Date.now(), CFG.updateUtcHour);
      var mins = Math.max(0, Math.round((next.getTime() - Date.now()) / 60000));
      var h = Math.floor(mins / 60), m = mins % 60;
      el.textContent = h > 0 ? "in " + h + "h " + m + "m" : (m > 0 ? "in " + m + "m" : "jetzt gleich");
    }
    tick();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 30000);
  }

  // =========================================================================
  // Sektion 4: KPI-Karten
  // =========================================================================

  function renderKpis(db, snaps) {
    var cur = snaps.length ? snaps[snaps.length - 1] : null;
    var gains = L.dayGains(snaps);
    var views = L.viewsGain(snaps);

    ["a", "b"].forEach(function (side) {
      var big = $("kpi-followers-" + side);
      if (!cur) {
        if (big) big.textContent = "—";
        setText("kpi-likes-" + side, "—");
        setText("kpi-videos-" + side, "—");
        setText("kpi-views-" + side, "—");
      } else {
        var c = cur[side];
        countUp(big, c.followers);
        setText("kpi-likes-" + side, fmt(c.likes));
        setText("kpi-videos-" + side, fmt(c.videos));
        // Fehlendes viewsTotal ist KEINE 0 — dann neutraler Strich.
        setText("kpi-views-" + side, typeof c.viewsTotal === "number" ? fmt(c.viewsTotal) : "—");
      }

      // Follower-Delta-Chip
      var chip = $("kpi-followers-delta-" + side);
      if (chip) {
        if (!gains.hasResult) {
          chip.className = "delta delta--neutral";
          chip.textContent = "Verlauf startet";
        } else {
          var d = (side === "a" ? gains.deltaA : gains.deltaB).followers;
          if (gains.spanDays > 1) {
            chip.className = "delta delta--neutral";
            chip.textContent = signed(d) + " über " + gains.spanDays + " Tage";
          } else {
            chip.className = "delta " + deltaClass(d);
            chip.textContent = signed(d) + " heute";
          }
        }
      }

      // Views-Delta-Chip: null (nicht auswertbar) -> neutral, NIE 0 anzeigen.
      var vchip = $("kpi-views-delta-" + side);
      if (vchip) {
        var g = views.hasResult ? views[side] : null;
        if (g === null) {
          vchip.className = "delta delta--neutral delta--sm";
          vchip.textContent = "Tracking läuft ab heute";
        } else if (views.spanDays > 1) {
          vchip.className = "delta delta--neutral delta--sm";
          vchip.textContent = signed(g) + " über " + views.spanDays + " Tage";
        } else {
          vchip.className = "delta " + deltaClass(g) + " delta--sm";
          vchip.textContent = signed(g);
        }
      }
    });
  }

  // Stand-Datum (Header) + Footer-Zeit auf das juengste Snapshot-Datum setzen.
  function renderStand(snaps) {
    if (!snaps.length) return;
    var iso = snaps[snaps.length - 1].date;
    var hh = ("0" + CFG.updateUtcHour).slice(-2);
    var stand = $("stand-datum");
    if (stand) { stand.textContent = deDateFull(iso); stand.setAttribute("datetime", iso); }
    var foot = $("footer-updated");
    if (foot) {
      foot.textContent = deDateFull(iso) + ", " + hh + ":00 UTC";
      foot.setAttribute("datetime", iso + "T" + hh + ":00:00Z");
    }
  }

  // =========================================================================
  // Sektion 5: Chart "Das Rennen" (Chart.js 4, Kategorie-Achse mit echten Daten)
  // =========================================================================

  var chart = null;

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function rangeKey(r) { return r === "7" ? "7d" : r === "30" ? "30d" : "all"; }

  // Serien fuer beide Modi. gap[i]/span[i] markieren Luecken-Uebergaenge,
  // damit die 18-Tage-Luecke sichtbar bleibt statt weginterpoliert zu werden.
  function buildSeries(snaps, mode) {
    if (mode === "cumulative") {
      var fs = L.followerSeries(snaps);
      var gap = fs.labels.map(function (d, i) {
        return i > 0 && L.daysBetween(fs.labels[i - 1], d) > 1;
      });
      var span = fs.labels.map(function (d, i) {
        return i > 0 ? L.daysBetween(fs.labels[i - 1], d) : 0;
      });
      return { labels: fs.labels, a: fs.a, b: fs.b, gap: gap, span: span };
    }
    // daily: Zuwachs pro Tag; Luecken-Uebergaenge als Ø pro Tag (ehrlich normiert).
    var labels = [], a = [], b = [], gap = [], span = [];
    for (var i = 1; i < snaps.length; i++) {
      var days = L.daysBetween(snaps[i - 1].date, snaps[i].date);
      var dA = L.delta(snaps[i - 1], snaps[i], "a").followers;
      var dB = L.delta(snaps[i - 1], snaps[i], "b").followers;
      labels.push(snaps[i].date);
      gap.push(days > 1);
      span.push(days);
      a.push(days > 1 ? Math.round((dA / days) * 10) / 10 : dA);
      b.push(days > 1 ? Math.round((dB / days) * 10) / 10 : dB);
    }
    return { labels: labels, a: a, b: b, gap: gap, span: span };
  }

  function drawChart() {
    var frame = document.querySelector(".chart-frame");
    var canvas = $("chart-growth");
    if (!canvas || typeof Chart === "undefined") {
      if (frame) frame.classList.remove("skeleton");
      return;
    }
    var db = state.db || SEED;
    var snaps = L.filterByRange((db.snapshots || []), rangeKey(state.range));
    var s = buildSeries(snaps, state.mode);

    var colA = cssVar("--c-gold", CFG.colors.a);
    var colB = cssVar("--c-platin", CFG.colors.b);
    var dim = cssVar("--t-dim", CFG.colors.muted);
    var gridCol = "rgba(255,255,255,0.06)";
    var mode = state.mode;

    var datasets;
    if (mode === "cumulative") {
      var ctx2d = canvas.getContext("2d");
      var h = canvas.clientHeight || 300;
      var gradA = ctx2d.createLinearGradient(0, 0, 0, h);
      gradA.addColorStop(0, colA + "2E"); gradA.addColorStop(1, colA + "00");
      var gradB = ctx2d.createLinearGradient(0, 0, 0, h);
      gradB.addColorStop(0, colB + "2E"); gradB.addColorStop(1, colB + "00");
      // Luecken-Segmente gestrichelt + gedimmt statt stillschweigend interpoliert.
      function lineDs(name, data, col, grad) {
        return {
          label: name, data: data, borderColor: col, backgroundColor: grad, fill: true,
          tension: 0.3, borderWidth: 2.5, pointRadius: 3.5, pointHoverRadius: 5.5,
          pointBackgroundColor: col, pointBorderColor: "#0b0b10", pointBorderWidth: 1.5,
          spanGaps: true,
          segment: {
            borderDash: function (c) { return s.gap[c.p1DataIndex] ? [5, 5] : undefined; },
            borderColor: function (c) { return s.gap[c.p1DataIndex] ? col + "73" : undefined; }
          }
        };
      }
      datasets = [
        lineDs(nick(db, "a"), s.a, colA, gradA),
        lineDs(nick(db, "b"), s.b, colB, gradB)
      ];
    } else {
      // daily als Balken; Luecken-Balken (Ø/Tag) deutlich blasser.
      function barDs(name, data, col) {
        return {
          label: name, data: data,
          backgroundColor: s.gap.map(function (g) { return col + (g ? "40" : "CC"); }),
          borderColor: col, borderWidth: 1, borderRadius: 3, maxBarThickness: 26
        };
      }
      datasets = [
        barDs(nick(db, "a"), s.a, colA),
        barDs(nick(db, "b"), s.b, colB)
      ];
    }

    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart(canvas, {
      type: mode === "cumulative" ? "line" : "bar",
      data: { labels: s.labels.map(deDateShort), datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 400 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#141419",
            borderColor: "rgba(255,255,255,0.12)",
            borderWidth: 1,
            titleColor: "#f0ede6",
            bodyColor: "#b9b6ae",
            padding: 10,
            boxPadding: 4,
            cornerRadius: 8,
            callbacks: {
              title: function (items) {
                return items.length ? deDateFull(s.labels[items[0].dataIndex]) : "";
              },
              afterTitle: function (items) {
                if (!items.length) return "";
                var i = items[0].dataIndex;
                if (!s.gap[i]) return "";
                return mode === "daily"
                  ? "Ø pro Tag über " + s.span[i] + " Tage (Daten-Lücke)"
                  : "Daten-Lücke: " + s.span[i] + " Tage seit letztem Punkt";
              },
              label: function (item) {
                return " " + item.dataset.label + ": " + fmt1(item.parsed.y);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: dim, maxRotation: 0, autoSkipPadding: 16, font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: gridCol },
            border: { display: false },
            ticks: { color: dim, precision: 0, font: { size: 11 } }
          }
        }
      }
    });
    if (frame) frame.classList.remove("skeleton");
  }

  function initChartControls() {
    function wire(wrapId, attr, apply) {
      var wrap = $(wrapId);
      if (!wrap) return;
      wrap.addEventListener("click", function (e) {
        var btn = e.target.closest("button[" + attr + "]");
        if (!btn || !wrap.contains(btn) || btn.classList.contains("active")) return;
        wrap.querySelectorAll("button").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        apply(btn.getAttribute(attr));
      });
    }
    wire("chart-mode", "data-mode", function (v) { state.mode = v; drawChart(); });
    wire("chart-range", "data-range", function (v) { state.range = v; drawChart(); });
  }

  // =========================================================================
  // Sektion 8: Meilensteine
  // =========================================================================

  function renderMilestones(db, snaps) {
    ["a", "b"].forEach(function (side) {
      var card = $("milestone-" + side);
      if (!card) return;
      var zielEl = $("milestone-ziel-" + side);
      var fill = $("milestone-bar-" + side);
      var etaEl = $("milestone-eta-" + side);
      var barBox = card.querySelector(".ms-bar");
      var name = nick(db, side);

      if (!snaps.length) {
        if (zielEl) zielEl.textContent = "Nächstes Ziel: —";
        if (fill) fill.style.width = "0%";
        if (barBox) {
          barBox.setAttribute("aria-valuenow", "0");
          barBox.setAttribute("aria-label", "Fortschritt " + name + ": noch keine Daten");
        }
        if (etaEl) {
          etaEl.classList.remove("ms-eta--never");
          etaEl.innerHTML = '<span class="ms-current">—</span> · Verlauf startet';
        }
        return;
      }

      var current = snaps[snaps.length - 1][side].followers;
      var p = L.milestoneProjection(snaps, side);
      if (zielEl) zielEl.textContent = "Nächstes Ziel: " + fmt(p.target) + " Follower";
      var pct = Math.max(0, Math.min(100, (current / p.target) * 100));
      if (fill) fill.style.width = pct.toFixed(1) + "%";
      if (barBox) {
        barBox.setAttribute("aria-valuenow", String(current));
        barBox.setAttribute("aria-valuemax", String(p.target));
        barBox.setAttribute("aria-label",
          "Fortschritt " + name + ": " + fmt(current) + " von " + fmt(p.target) + " Followern");
      }
      if (etaEl) {
        var cw = '<span class="ms-current">' + fmt(current) + " / " + fmt(p.target) + "</span>";
        if (p.etaDate === null) {
          etaEl.classList.add("ms-eta--never");
          etaEl.innerHTML = cw + " · bei dem Tempo: nie 💀";
        } else {
          etaEl.classList.remove("ms-eta--never");
          etaEl.innerHTML = cw + " · ~" + deDateFull(p.etaDate) +
            ' <span class="ms-eta-rel">(in ' + tagen(p.days) + ")</span>";
        }
      }
    });
  }

  // =========================================================================
  // Zentraler Render — bekommt das geladene db-Objekt
  // =========================================================================

  function render(db) {
    state.db = db;
    var snaps = db.snapshots || [];
    renderStand(snaps);
    renderHero(db, snaps);
    renderKpis(db, snaps);
    renderMilestones(db, snaps);
    drawChart();

    // ---- Phase 4b dockt hier an: -----------------------------------------
    // renderSpruch(db, snaps);           // Sektion 3  (#spruch-text)
    // renderVideoBattle(db, videos);     // Sektion 6  (#battle, braucht data/videos.json)
    // renderOutputChart(db, videos);     // Sektion 7  (#output-chart)
    // renderHistory(db, snaps);          // Sektion 9  (#history-body)
    // Hinweise: loadJSON("data/videos.json") wiederverwenden (catch -> null),
    // Helfer fmt/signed/deDateFull/deltaClass/SEP/setText stehen oben bereit.
    // ----------------------------------------------------------------------
  }

  function init() {
    initChartControls();
    startCountdown();
    loadData().then(render).catch(function () { render(SEED); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
