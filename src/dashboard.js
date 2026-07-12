// Dashboard-Rendering: DOM, Charts. Klassisches Script.
// Nutzt window.DUELL (logic.js) + window.DUELL_CONFIG (config.js).
(function () {
  "use strict";
  var L = window.DUELL, CFG = window.DUELL_CONFIG;

  // ---- Fallback-Daten, damit auch file:// ohne fetch etwas zeigt ----
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
        b: { followers: 25, following: 33, likes: 1022, videos: 12 } }
    ]
  };

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.round(n).toLocaleString("de-CH"); };
  var signed = function (n) { return (n >= 0 ? "+" : "") + fmt(n); };
  var deDate = function (iso) { var p = iso.split("-"); return p[2] + "." + p[1]; };
  var deDateFull = function (iso) {
    var p = iso.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  };
  var trendClass = function (n) { return n > 0 ? "up" : n < 0 ? "down" : "flat"; };
  var cellClass = function (n) { return n > 0 ? "pos" : n < 0 ? "neg" : "zero"; };
  var arrow = function (n) { return n > 0 ? "↑" : n < 0 ? "↓" : "→"; };

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

  function loadData() {
    // ?data=test/fixtures/03_streak.json laedt gezielt eine Fixture (zum Testen).
    var override = qparam("data");
    var url = override || "data/history.json";
    return loadJSON(url).then(function (j) {
      if (j && j.snapshots && j.snapshots.length) return j;
      return SEED;
    }).catch(function () { return SEED; });
  }

  // ---- Count-up Animation ----
  var anim = {};
  function countUp(id, target) {
    var el = $(id); if (!el) return;
    cancelAnimationFrame(anim[id]);
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
      el.textContent = fmt(target); return;
    }
    var t0 = performance.now(), dur = 700;
    function step(t) {
      var p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e);
      if (p < 1) anim[id] = requestAnimationFrame(step);
    }
    anim[id] = requestAnimationFrame(step);
  }

  // ---- Sidebar toggle (mobile) ----
  function initSidebar() {
    var btn = $("menu-btn"), sidebar = $("sidebar"), scrim = $("scrim");
    if (!btn || !sidebar) return;
    function setOpen(open) {
      sidebar.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (scrim) scrim.classList.toggle("show", open);
    }
    btn.addEventListener("click", function () {
      setOpen(!sidebar.classList.contains("open"));
    });
    if (scrim) {
      scrim.addEventListener("click", function () { setOpen(false); });
    }
    sidebar.querySelectorAll(".nav-item").forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
  }

  // ---- State ----
  var state = { db: null, range: "all" };
  var charts = {};

  function setKpiDelta(el, value, suffix) {
    el.className = "kpi-delta " + trendClass(value);
    el.innerHTML = '<span class="arrow">' + arrow(value) + '</span> ' + signed(value) + ' <span class="from">' + suffix + '</span>';
  }

  function renderKpis(db, snaps) {
    var A = db.creators.a, B = db.creators.b;
    var cur = snaps[snaps.length - 1];
    var gains = L.dayGains(snaps);
    var lead = L.leader(cur);

    countUp("kpi-foll-a", cur.a.followers);
    countUp("kpi-foll-b", cur.b.followers);
    $("kpi-videos").textContent = fmt(cur.a.videos) + " : " + fmt(cur.b.videos);

    // Duell-Stand
    var leadName = lead.side ? (lead.side === "a" ? A.nickname : B.nickname) : "Gleichstand";
    $("kpi-lead-name").textContent = lead.side ? leadName + " führt" : "Gleichstand";
    var leadDeltaEl = $("kpi-lead-delta");
    if (gains.hasResult) {
      var gapPrevSnaps = snaps.slice(0, -1);
      var prevLead = gapPrevSnaps.length ? L.leader(gapPrevSnaps[gapPrevSnaps.length - 1]) : { side: null, gap: 0 };
      var prevGapSigned = prevLead.side === "a" ? prevLead.gap : prevLead.side === "b" ? -prevLead.gap : 0;
      var curGapSigned = lead.side === "a" ? lead.gap : lead.side === "b" ? -lead.gap : 0;
      var gapChange = curGapSigned - prevGapSigned;
      var favorsLeader = lead.side ? (lead.side === "a" ? gapChange >= 0 : gapChange <= 0) : gapChange === 0;
      leadDeltaEl.className = "kpi-delta " + (gapChange === 0 ? "flat" : (favorsLeader ? "up" : "down"));
      leadDeltaEl.innerHTML = '<span class="arrow">' + arrow(favorsLeader ? 1 : (gapChange === 0 ? 0 : -1)) + '</span> ' +
        signed(Math.abs(gapChange) === 0 ? 0 : (favorsLeader ? Math.abs(gapChange) : -Math.abs(gapChange))) +
        ' Vorsprung <span class="from">seit letztem Snapshot</span>';
    } else {
      leadDeltaEl.className = "kpi-delta flat";
      leadDeltaEl.textContent = "Vorsprung: " + fmt(lead.gap) + " Follower";
    }

    if (gains.hasResult) {
      setKpiDelta($("kpi-delta-a"), gains.deltaA.followers, "heute");
      setKpiDelta($("kpi-delta-b"), gains.deltaB.followers, "heute");
      var videoDelta = gains.deltaA.videos + gains.deltaB.videos;
      $("kpi-delta-videos").className = "kpi-delta " + trendClass(videoDelta);
      $("kpi-delta-videos").innerHTML = '<span class="arrow">' + arrow(videoDelta) + '</span> ' + signed(videoDelta) + ' <span class="from">neue Videos heute</span>';
    } else {
      $("kpi-delta-a").className = "kpi-delta flat";
      $("kpi-delta-a").textContent = "Verlauf startet";
      $("kpi-delta-b").className = "kpi-delta flat";
      $("kpi-delta-b").textContent = "Verlauf startet";
      $("kpi-delta-videos").className = "kpi-delta flat";
      $("kpi-delta-videos").textContent = "Verlauf startet";
    }

    // Versus-Balken (additiv, mit Existenz-Guards)
    var share = L.followerShare(snaps, "a");
    var vsA = $("vs-a"), vsB = $("vs-b");
    if (vsA && vsB) {
      vsA.style.width = share.pct + "%";
      vsB.style.width = (100 - share.pct) + "%";
    }
    var vsPctA = $("vs-pct-a"), vsPctB = $("vs-pct-b");
    if (vsPctA) vsPctA.textContent = A.nickname + " " + Math.round(share.pct) + "%";
    if (vsPctB) vsPctB.textContent = Math.round(100 - share.pct) + "% " + B.nickname;
  }

  function todayCell(id, value) {
    var el = $(id);
    if (el == null) return;
    if (value == null) { el.textContent = "—"; el.className = "zero"; return; }
    el.textContent = signed(value);
    el.className = cellClass(value);
  }

  function renderTodayVsYesterday(snaps) {
    var gains = L.dayGains(snaps);
    var yGains = L.yesterdayGains(snaps);

    if (gains.hasResult) {
      todayCell("today-foll-a", gains.deltaA.followers);
      todayCell("today-foll-b", gains.deltaB.followers);
      todayCell("today-likes-a", gains.deltaA.likes);
      todayCell("today-likes-b", gains.deltaB.likes);
      todayCell("today-videos-a", gains.deltaA.videos);
      todayCell("today-videos-b", gains.deltaB.videos);
    } else {
      ["today-foll-a","today-foll-b","today-likes-a","today-likes-b","today-videos-a","today-videos-b"].forEach(function (id) { todayCell(id, null); });
    }

    var ydayBlock = document.querySelector('.today-block[data-when="yesterday"]');
    if (yGains.hasResult) {
      if (ydayBlock) ydayBlock.style.display = "";
      todayCell("yday-foll-a", yGains.deltaA.followers);
      todayCell("yday-foll-b", yGains.deltaB.followers);
      todayCell("yday-likes-a", yGains.deltaA.likes);
      todayCell("yday-likes-b", yGains.deltaB.likes);
      todayCell("yday-videos-a", yGains.deltaA.videos);
      todayCell("yday-videos-b", yGains.deltaB.videos);
    } else {
      // Sinnvoll degradieren: nur 2 Snapshots vorhanden -> kein echtes "gestern".
      ["yday-foll-a","yday-foll-b","yday-likes-a","yday-likes-b","yday-videos-a","yday-videos-b"].forEach(function (id) {
        var el = $(id);
        if (el) { el.textContent = "n/v"; el.className = "zero"; }
      });
    }
  }

  function renderDonut(db, snaps) {
    var share = L.followerShare(snaps, "a");
    var A = db.creators.a;
    var circumference = 2 * Math.PI * 50;
    var offset = circumference * (1 - share.pct / 100);
    var fillEl = $("donut-fill");
    fillEl.style.strokeDasharray = circumference.toFixed(2);
    fillEl.style.strokeDashoffset = offset.toFixed(2);
    $("donut-pct").textContent = Math.round(share.pct) + "%";
    document.querySelector(".donut-caption").textContent = A.nickname;

    var deltaEl = $("donut-delta");
    var rounded = Math.round(share.deltaPct * 10) / 10;
    if (rounded === 0) {
      deltaEl.className = "donut-delta flat";
      deltaEl.textContent = "Unverändert seit letztem Snapshot";
    } else {
      deltaEl.className = "donut-delta " + (rounded > 0 ? "up" : "down");
      deltaEl.textContent = (rounded > 0 ? "+" : "") + rounded.toFixed(1) + " Pp seit letztem Snapshot";
    }
  }

  function renderWinnerCard(db, snaps) {
    var gains = L.dayGains(snaps);
    var A = db.creators.a, B = db.creators.b;
    var nameEl = $("winner-name"), deltaEl = $("winner-delta");
    if (!gains.hasResult) {
      nameEl.textContent = "—";
      deltaEl.textContent = "Verlauf startet";
      return;
    }
    var winner = gains.deltaA.followers > gains.deltaB.followers ? "a"
      : gains.deltaB.followers > gains.deltaA.followers ? "b" : null;
    if (winner === null) {
      nameEl.textContent = "Unentschieden";
      deltaEl.textContent = "Beide gleich viele Follower dazu";
      return;
    }
    var name = winner === "a" ? A.nickname : B.nickname;
    var d = winner === "a" ? gains.deltaA.followers : gains.deltaB.followers;
    nameEl.textContent = name;
    deltaEl.innerHTML = '<span class="up">+' + fmt(d) + ' Follower</span> heute';
  }

  function renderTable(db, allSnaps) {
    var A = db.creators.a, B = db.creators.b;
    var rows = L.dailyRows(allSnaps);
    var tbody = $("history-body");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Noch keine Tages-Historie — ab dem zweiten Snapshot erscheinen Zeilen.</td></tr>';
      $("note-table").textContent = "";
      return;
    }
    var html = rows.map(function (r) {
      var badge;
      if (r.winner === "a") badge = '<span class="status-pill pill-a"><span class="dot"></span>' + A.nickname + '</span>';
      else if (r.winner === "b") badge = '<span class="status-pill pill-b"><span class="dot"></span>' + B.nickname + '</span>';
      else badge = '<span class="status-pill pill-tie"><span class="dot"></span>Unentschieden</span>';
      return "<tr>" +
        '<td class="date-cell">' + deDateFull(r.date) + "</td>" +
        '<td class="' + cellClass(r.deltaA.followers) + '">' + signed(r.deltaA.followers) + "</td>" +
        '<td class="' + cellClass(r.deltaA.likes) + '">' + signed(r.deltaA.likes) + "</td>" +
        '<td class="' + cellClass(r.deltaB.followers) + '">' + signed(r.deltaB.followers) + "</td>" +
        '<td class="' + cellClass(r.deltaB.likes) + '">' + signed(r.deltaB.likes) + "</td>" +
        "<td>" + badge + "</td>" +
        "</tr>";
    }).join("");
    tbody.innerHTML = html;
    $("note-table").textContent = "Neueste zuerst · Deltas zwischen aufeinanderfolgenden Snapshots.";
  }

  function renderStaleNotes(cur, db) {
    var staleList = cur.stale || [];
    var A = db.creators.a, B = db.creators.b;
    // Stale-Hinweis an den KPI-Karten anzeigen (nachtraeglich einfuegen, keine doppelten Tags).
    document.querySelectorAll(".stale-tag").forEach(function (el) { el.remove(); });
    if (staleList.indexOf("a") !== -1) {
      var elA = $("kpi-foll-a").parentElement.querySelector(".kpi-label");
      var tagA = document.createElement("span");
      tagA.className = "stale-tag"; tagA.textContent = "Daten vom Vortag";
      elA.appendChild(tagA);
    }
    if (staleList.indexOf("b") !== -1) {
      var elB = $("kpi-foll-b").parentElement.querySelector(".kpi-label");
      var tagB = document.createElement("span");
      tagB.className = "stale-tag"; tagB.textContent = "Daten vom Vortag";
      elB.appendChild(tagB);
    }
  }

  // ---- Hauptrender ----
  function render() {
    var db = state.db;
    var A = db.creators.a, B = db.creators.b, allSnaps = db.snapshots;
    var cur = allSnaps[allSnaps.length - 1];
    var visibleSnaps = L.filterByRange(allSnaps, state.range);

    // Kopf
    $("last-date").textContent = deDateFull(cur.date);

    renderKpis(db, allSnaps);
    renderTodayVsYesterday(allSnaps);
    renderDonut(db, allSnaps);
    renderWinnerCard(db, allSnaps);
    renderTable(db, allSnaps);
    renderStaleNotes(cur, db);

    drawCharts(db, visibleSnaps);
  }

  function drawCharts(db, snaps) {
    var cs = getComputedStyle(document.documentElement);
    var colA = cs.getPropertyValue("--a").trim();
    var colB = cs.getPropertyValue("--b").trim();
    var ink = cs.getPropertyValue("--ink").trim();
    var grid = "rgba(20,20,20,.06)", muted = cs.getPropertyValue("--muted").trim();
    var single = snaps.length < 2;

    // Follower-Verlauf (Linie mit sanftem Farb-Fill; Punkte sichtbar, solange es wenige Snapshots gibt)
    var fs = L.followerSeries(snaps);
    if (charts.followers) charts.followers.destroy();
    var canvas = $("chart-followers");
    var ctx2d = canvas.getContext("2d");
    var gradA = ctx2d.createLinearGradient(0, 0, 0, 260);
    gradA.addColorStop(0, colA + "24"); gradA.addColorStop(1, colA + "00");
    var gradB = ctx2d.createLinearGradient(0, 0, 0, 260);
    gradB.addColorStop(0, colB + "24"); gradB.addColorStop(1, colB + "00");
    charts.followers = new Chart(canvas, {
      type: "line",
      data: {
        labels: fs.labels.map(deDate),
        datasets: [
          { label: db.creators.a.nickname, data: fs.a, borderColor: colA, backgroundColor: gradA, fill: true,
            tension: .35, borderWidth: 2.5, pointRadius: 3.5, pointHoverRadius: 5,
            pointBackgroundColor: colA, pointBorderColor: "#fff", pointBorderWidth: 1.5 },
          { label: db.creators.b.nickname, data: fs.b, borderColor: colB, backgroundColor: gradB, fill: true,
            tension: .35, borderWidth: 2.5, pointRadius: 3.5, pointHoverRadius: 5,
            pointBackgroundColor: colB, pointBorderColor: "#fff", pointBorderWidth: 1.5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#17171a", borderColor: "rgba(255,255,255,.1)", borderWidth: 1,
            titleColor: "#f5f5f4", bodyColor: "#c9c9ce", padding: 10, boxPadding: 4, cornerRadius: 8
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 16, font: { size: 11 } } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 } }, beginAtZero: true }
        }
      }
    });
    $("note-followers").textContent = single
      ? "Ein Datenpunkt im gewählten Zeitraum. Die Kurve wächst ab dem nächsten täglichen Snapshot."
      : "";
  }

  function initRangePills() {
    var wrap = $("range-pills");
    if (!wrap) return;
    wrap.addEventListener("click", function (e) {
      var btn = e.target.closest(".pill");
      if (!btn) return;
      wrap.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      state.range = btn.getAttribute("data-range");
      if (state.db) drawCharts(state.db, L.filterByRange(state.db.snapshots, state.range));
    });
  }

  function initTableRefresh() {
    var btn = $("table-refresh");
    if (!btn) return;
    btn.addEventListener("click", function () {
      btn.classList.add("spin");
      loadData().then(function (db) {
        state.db = db;
        render();
        setTimeout(function () { btn.classList.remove("spin"); }, 400);
      });
    });
  }

  // ---- Start ----
  function init() {
    initSidebar();
    initRangePills();
    initTableRefresh();
    loadData().then(function (db) {
      state.db = db;
      render();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
