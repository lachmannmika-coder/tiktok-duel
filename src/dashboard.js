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

  var state = { db: null, videos: null, mode: "daily", range: "all" };

  // data/videos.json entsteht erst mit dem ersten scharfen Action-Lauf.
  // Fehlt sie (http 404) oder ist fetch unmoeglich (file://), liefert das null —
  // die Video-Sektionen zeigen dann einen ehrlichen Leerzustand statt Platzhaltern.
  // ?videos=<url> laedt gezielt eine Test-Datei (analog zu ?data=).
  function loadVideos() {
    if (typeof fetch === "undefined") return Promise.resolve(null);
    var url = qparam("videos") || "data/videos.json";
    return loadJSON(url).then(function (j) {
      return (j && (Array.isArray(j.a) || Array.isArray(j.b))) ? j : null;
    }).catch(function () { return null; });
  }

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
  // Sektion 6: Chart "Das Rennen" (Chart.js 4, Kategorie-Achse mit echten Daten)
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
  // Phase 4b — gemeinsame Video-Helfer
  // =========================================================================

  // Unix-Sekunden (createTime) -> "YYYY-MM-DD" (UTC-Tag, konsistent mit heatmapData).
  function ctToDate(ct) { return new Date(ct * 1000).toISOString().slice(0, 10); }

  function isoAddDays(iso, n) {
    return new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  }

  // Bezugsdatum fuer "vor N Tagen" und das 28-Tage-Fenster: juengstes Snapshot-Datum
  // (Fallback: fetched-Datum der videos.json, sonst heute).
  function refDate(snaps) {
    if (snaps && snaps.length) return snaps[snaps.length - 1].date;
    if (state.videos && state.videos.fetched) return state.videos.fetched;
    return new Date().toISOString().slice(0, 10);
  }

  function ageText(video, ref) {
    var d = L.daysBetween(ctToDate(video.createTime), ref);
    if (d <= 0) return "heute";
    return d === 1 ? "vor 1 Tag" : "vor " + d + " Tagen";
  }

  // Engagement-Rate de-CH mit Komma: 0.086 -> "8,6 %"
  function erText(video) {
    return (L.engagementRate(video) * 100).toFixed(1).replace(".", ",") + " %";
  }

  function videoTitle(v) { return (v.title || "").trim() || "Ohne Titel"; }

  // true, sobald videos.json geladen ist UND mindestens eine Seite Videos hat.
  function hasVideoData(videos) {
    return !!(videos && ((videos.a && videos.a.length) || (videos.b && videos.b.length)));
  }

  // Cover-Bild in eine .cover-Box setzen; onerror faellt aufs Monogramm zurueck.
  // (.cover ist position:relative + overflow:hidden — das Bild fuellt die Box.)
  function setCover(box, video, side, initial) {
    if (!box) return;
    box.classList.remove("cover--a", "cover--b");
    box.classList.add("cover--" + side);
    var mono = box.querySelector(".cover-mono");
    if (mono) mono.textContent = initial;
    var old = box.querySelector("img");
    if (old) old.remove();
    if (!video || !video.cover) return;
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.style.position = "absolute";
    img.style.inset = "0";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.addEventListener("error", function () { img.remove(); });
    img.src = video.cover;
    box.appendChild(img);
  }

  // [data-field]-Felder einer Videokarte fuellen (h2h-Seite, Top-Video, 6er-Slot).
  function fillVideoCard(root, video, side, db, ref) {
    if (!root) return;
    function f(name) { return root.querySelector('[data-field="' + name + '"]'); }
    function set(name, txt) { var el = f(name); if (el) el.textContent = txt; }
    setCover(f("cover"), video, side, nick(db, side).charAt(0).toUpperCase());
    if (!video) {
      set("title", "Noch kein Video");
      set("age", "—");
      set("views", "—"); set("likes", "—"); set("comments", "—"); set("er", "—");
      return;
    }
    set("title", videoTitle(video));
    set("age", ageText(video, ref));
    set("views", fmt(video.views || 0));
    set("likes", fmt(video.likes || 0));
    set("comments", fmt(video.comments || 0));
    set("er", erText(video));
  }

  // =========================================================================
  // Sektion 3: Spruch des Tages (deterministisch pro Tag, djb2 in logic.js)
  // =========================================================================

  function renderSpruch(db, snaps) {
    var el = $("spruch-text");
    if (!el) return;
    var dw = L.dayWinner(snaps, CFG.scoring);
    var text;
    if (!dw.hasResult) {
      text = "Das Duell startet — der erste Spruch kommt mit der ersten Tageswertung.";
    } else if (dw.isGap) {
      text = "Über " + dw.spanDays + " Tage keine Tageswertung — der Spruch des Tages pausiert bis zu frischen Zahlen.";
    } else if (!dw.winner) {
      text = L.spruchDesTages(dw.date, {
        sieger: null,
        verlierer: null,
        punkte: fmt(dw.scoreA.total) + ":" + fmt(dw.scoreB.total),
        unentschieden: true
      });
    } else {
      var loser = dw.winner === "a" ? "b" : "a";
      var ws = dw.winner === "a" ? dw.scoreA : dw.scoreB;
      var ls = dw.winner === "a" ? dw.scoreB : dw.scoreA;
      text = L.spruchDesTages(dw.date, {
        sieger: nick(db, dw.winner),
        verlierer: nick(db, loser),
        punkte: fmt(ws.total) + ":" + fmt(ls.total)
      });
    }
    // Pool-Templates nutzen ASCII " -- " als Gedankenstrich -> typografisch anheben.
    el.textContent = "„" + text.split(" -- ").join(" — ") + "“";
  }

  // =========================================================================
  // Sektion 7: Video-Battle (Head-to-Head, Duell-Balken, Top-Video, 6er-Reihen)
  // =========================================================================

  function renderBattleBars(h) {
    var wrap = $("battle-bars");
    if (!wrap) return;
    var metrics = {
      views: { get: function (v) { return v.views || 0; }, txt: function (v) { return fmt(v.views || 0); } },
      likes: { get: function (v) { return v.likes || 0; }, txt: function (v) { return fmt(v.likes || 0); } },
      comments: { get: function (v) { return v.comments || 0; }, txt: function (v) { return fmt(v.comments || 0); } },
      engagement: { get: function (v) { return L.engagementRate(v); }, txt: erText }
    };
    Object.keys(metrics).forEach(function (key) {
      var bar = wrap.querySelector('.duel-bar[data-metric="' + key + '"]');
      if (!bar) return;
      var m = metrics[key];
      var va = h.a ? m.get(h.a) : 0;
      var vb = h.b ? m.get(h.b) : 0;
      var total = va + vb;
      var pctA = total > 0 ? (va / total) * 100 : 50; // 0:0 -> 50/50
      var fillA = bar.querySelector(".db-a"), fillB = bar.querySelector(".db-b");
      if (fillA) fillA.style.width = pctA.toFixed(1) + "%";
      if (fillB) fillB.style.width = (100 - pctA).toFixed(1) + "%";
      var valA = bar.querySelector(".db-val-a"), valB = bar.querySelector(".db-val-b");
      if (valA) valA.textContent = h.a ? m.txt(h.a) : "—";
      if (valB) valB.textContent = h.b ? m.txt(h.b) : "—";
    });
  }

  function renderTopVideo(db, videos, ref) {
    var card = $("top-video");
    if (!card) return;
    var top = L.topVideoOfWeek(videos, ref);
    // Nichts im 7-Tage-Fenster -> Karte weglassen statt altes Zeug zeigen.
    card.style.display = top.video ? "" : "none";
    if (!top.video) return;
    fillVideoCard(card, top.video, top.side, db, ref);
    var owner = card.querySelector('[data-field="owner"]');
    if (owner) owner.textContent = nick(db, top.side);
  }

  function renderVideoRow(rowId, list, side, db, ref) {
    var row = $(rowId);
    if (!row) return;
    var sorted = (list || []).slice()
      .sort(function (x, y) { return y.createTime - x.createTime; })
      .slice(0, 6);
    var strip = row.closest(".video-strip");
    if (strip) strip.style.display = sorted.length ? "" : "none";
    var slots = row.querySelectorAll("[data-slot]");
    for (var i = 0; i < slots.length; i++) {
      if (i < sorted.length) {
        slots[i].hidden = false;
        fillVideoCard(slots[i], sorted[i], side, db, ref);
      } else {
        slots[i].hidden = true;
      }
    }
  }

  function renderVideoBattle(db, videos, snaps) {
    var section = $("battle");
    if (!section) return;
    var ok = hasVideoData(videos);
    var empty = $("battle-empty");
    if (empty) empty.hidden = ok;
    // Ohne Daten die Platzhalter-Karten NICHT stehen lassen (waeren erfundene Zahlen):
    // alle Datenbloecke ausblenden, nur der Hinweis bleibt.
    var blocks = section.querySelectorAll(".card--h2h, #top-video, .video-strip");
    for (var i = 0; i < blocks.length; i++) blocks[i].style.display = ok ? "" : "none";
    if (!ok) return;

    var ref = refDate(snaps);
    var h = L.headToHead(videos);
    fillVideoCard($("battle-video-a"), h.a, "a", db, ref);
    fillVideoCard($("battle-video-b"), h.b, "b", db, ref);
    renderBattleBars(h);
    renderTopVideo(db, videos, ref);
    renderVideoRow("video-row-a", videos.a, "a", db, ref);
    renderVideoRow("video-row-b", videos.b, "b", db, ref);
  }

  // =========================================================================
  // Sektion 5: Tages-Output (Block-Diagramm, letzte 28 Tage bis juengster Snapshot)
  // =========================================================================

  function appendBlocks(stack, list) {
    (list || []).forEach(function (v) {
      var b = document.createElement("i");
      b.className = "blk";
      b.title = videoTitle(v) + " · " + fmt(v.views || 0) + " Views";
      stack.appendChild(b);
    });
  }

  function renderOutputChart(db, videos, snaps) {
    var chartEl = $("output-chart");
    if (!chartEl) return;
    var section = chartEl.closest(".card--output");
    var scroll = section ? section.querySelector(".output-scroll") : null;
    var legend = section ? section.querySelector(".output-legend") : null;
    var ok = hasVideoData(videos);
    setToggle("output-empty", !ok);
    setToggle("output-sub", ok);
    if (scroll) scroll.style.display = ok ? "" : "none";
    if (legend) legend.style.display = ok ? "" : "none";
    chartEl.innerHTML = ""; // statische Platzhalter-Spalten immer ersetzen
    if (!ok) return;

    // Videos je UTC-Tag gruppieren (gleiche Tageslogik wie heatmapData; die
    // title-Hover brauchen aber Titel + Views, daher direkt aus videos.json).
    var byDate = { a: {}, b: {} };
    ["a", "b"].forEach(function (side) {
      (videos[side] || []).forEach(function (v) {
        var d = ctToDate(v.createTime);
        (byDate[side][d] = byDate[side][d] || []).push(v);
      });
    });

    var DAYS = 28;
    var end = refDate(snaps);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < DAYS; i++) {
      var date = isoAddDays(end, i - (DAYS - 1));
      var col = document.createElement("div");
      col.className = "out-col";
      col.setAttribute("data-date", date);

      var stackA = document.createElement("div");
      stackA.className = "out-stack out-stack--a";
      appendBlocks(stackA, byDate.a[date]);

      var tick = document.createElement("span");
      tick.className = "out-tick";
      if (i % 7 === 0 || i === DAYS - 1) tick.textContent = deDateShort(date);

      var stackB = document.createElement("div");
      stackB.className = "out-stack out-stack--b";
      appendBlocks(stackB, byDate.b[date]);

      col.appendChild(stackA);
      col.appendChild(tick);
      col.appendChild(stackB);
      frag.appendChild(col);
    }
    chartEl.appendChild(frag);
  }

  function setToggle(id, show) {
    var el = $(id);
    if (el) el.hidden = !show;
  }

  // =========================================================================
  // Sektion 9: Historie (Tabelle aus dailyRows, neueste zuerst)
  // =========================================================================

  function td(cls, txt) {
    var el = document.createElement("td");
    if (cls) el.className = cls;
    el.textContent = txt;
    return el;
  }

  // Delta-Zelle: Vorzeichen + Farbe, die 0 bleibt neutral ("0", keine Klasse).
  function deltaTd(n) {
    var cls = "num" + (n > 0 ? " delta--pos" : n < 0 ? " delta--neg" : "");
    return td(cls, n === 0 ? "0" : signed(n));
  }

  function ptsText(total) { return total < 0 ? "−" + fmt(-total) : fmt(total); }

  function gapRow(r) {
    var from = isoAddDays(r.date, -r.spanDays);
    var tr = document.createElement("tr");
    tr.className = "row-gap";
    tr.appendChild(td(null, deDateShort(from) + " – " + deDateFull(r.date)));
    var msg = "über " + r.spanDays + " Tage — keine Tageswertung";
    var a = td("num", msg); a.colSpan = 4; tr.appendChild(a);
    tr.appendChild(td("td-center", "—"));
    var b = td("num", msg); b.colSpan = 4; tr.appendChild(b);
    return tr;
  }

  function historyRow(db, r) {
    var tr = document.createElement("tr");
    tr.appendChild(td(null, deDateFull(r.date)));
    tr.appendChild(deltaTd(r.deltaA.followers));
    tr.appendChild(deltaTd(r.deltaA.likes));
    tr.appendChild(deltaTd(r.deltaA.videos));
    tr.appendChild(td("num pts pts--a", ptsText(r.scoreA.total)));
    var mid = document.createElement("td");
    mid.className = "td-center";
    var badge = document.createElement("span");
    badge.className = "win-badge" + (r.winner ? " win-badge--" + r.winner : "");
    badge.textContent = r.winner ? nick(db, r.winner) : "Remis";
    mid.appendChild(badge);
    tr.appendChild(mid);
    tr.appendChild(td("num pts pts--b", ptsText(r.scoreB.total)));
    tr.appendChild(deltaTd(r.deltaB.followers));
    tr.appendChild(deltaTd(r.deltaB.likes));
    tr.appendChild(deltaTd(r.deltaB.videos));
    return tr;
  }

  function renderHistory(db, snaps) {
    var body = $("history-body");
    if (!body) return;
    var rows = L.dailyRows(snaps, CFG.scoring);
    body.innerHTML = ""; // Platzhalter-Zeilen raus, alles dynamisch
    if (!rows.length) {
      var tr = document.createElement("tr");
      tr.className = "row-gap";
      var cell = td(null, "Noch keine Tageswertungen — die Historie füllt sich mit dem zweiten Schnappschuss.");
      cell.colSpan = 10;
      tr.appendChild(cell);
      body.appendChild(tr);
      return;
    }
    rows.forEach(function (r) {
      body.appendChild(r.isGap ? gapRow(r) : historyRow(db, r));
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

    // ---- Phase 4b ----------------------------------------------------------
    renderSpruch(db, snaps);                       // Sektion 3  (#spruch-text)
    renderVideoBattle(db, state.videos, snaps);    // Sektion 7  (#battle)
    renderOutputChart(db, state.videos, snaps);    // Sektion 5  (#output-chart)
    renderHistory(db, snaps);                      // Sektion 9  (#history-body)
  }

  // Scroll-Reveals (Phase 5): Sektionen gleiten dezent ein (nur opacity/transform).
  // Bei reduced motion oder fehlendem IntersectionObserver passiert schlicht nichts.
  function initReveals() {
    if (reducedMotion() || typeof IntersectionObserver === "undefined") return;
    var els = document.querySelectorAll(".page > section, .page > footer");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("reveal--in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    els.forEach(function (el) {
      el.classList.add("reveal");
      io.observe(el);
    });
  }

  function init() {
    initChartControls();
    startCountdown();
    initReveals();
    Promise.all([loadData(), loadVideos()]).then(function (res) {
      state.videos = res[1];
      render(res[0]);
    }).catch(function () { render(SEED); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Oeffentliche Mini-Schnittstelle fuer src/refresh.js (manueller Refresh):
  // frische, bereits geparste JSONs direkt einspielen und neu rendern.
  window.DUELL_DASHBOARD = {
    applyData: function (db, videos) {
      if (videos !== undefined) state.videos = videos;
      render(db && db.snapshots ? db : SEED);
    }
  };

})();
