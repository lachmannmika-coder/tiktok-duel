// Reine Berechnungslogik fuer das Follower-Duell-Dashboard - KEIN DOM.
// Laeuft als klassisches Browser-Script (window.DUELL) UND als CommonJS-Modul (Tests).
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DUELL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Tageszuwachs (heute - gestern) fuer eine Seite.
  function delta(prev, cur, side) {
    const p = prev[side], c = cur[side];
    return {
      followers: c.followers - p.followers,
      likes: c.likes - p.likes,
      videos: c.videos - p.videos,
      following: c.following - p.following
    };
  }

  // Ganze Tage zwischen zwei "YYYY-MM-DD" (vorzeichenbehaftet: d2 - d1, UTC-sicher).
  function daysBetween(d1, d2) {
    const t1 = Date.parse(d1 + "T00:00:00Z");
    const t2 = Date.parse(d2 + "T00:00:00Z");
    return Math.round((t2 - t1) / 86400000);
  }

  // Tageszuwachs aus juengstem vs. vorletztem Schnappschuss (fuer beide Seiten).
  // spanDays = echter Kalendertag-Abstand des Uebergangs (bei Luecken > 1).
  function dayGains(snaps) {
    const empty = { hasResult: false, deltaA: null, deltaB: null, date: null, spanDays: null };
    if (!snaps || snaps.length < 2) return empty;
    const cur = snaps[snaps.length - 1];
    const prev = snaps[snaps.length - 2];
    return {
      hasResult: true,
      deltaA: delta(prev, cur, "a"),
      deltaB: delta(prev, cur, "b"),
      date: cur.date,
      spanDays: daysBetween(prev.date, cur.date)
    };
  }

  // Punkte fuer einen Tageszuwachs. Gewichte kommen aus config.scoring (kein Hardcoding hier).
  // Negative Zuwaechse zaehlen ehrlich negativ.
  function score(d, weights) {
    const parts = {
      followers: { value: d.followers, weighted: d.followers * weights.followers },
      likes: { value: d.likes, weighted: d.likes * weights.likes },
      videos: { value: d.videos, weighted: d.videos * weights.videos }
    };
    return {
      total: parts.followers.weighted + parts.likes.weighted + parts.videos.weighted,
      parts: parts
    };
  }

  // Sieger des JUENGSTEN Uebergangs nach Punkten. Bei spanDays > 1 (Daten-Luecke)
  // werden die Scores trotzdem geliefert, aber isGap markiert: zaehlt nicht als Tagessieg.
  function dayWinner(snaps, weights) {
    const empty = { hasResult: false, isGap: false, spanDays: null, date: null, winner: null, scoreA: null, scoreB: null };
    if (!snaps || snaps.length < 2) return empty;
    const cur = snaps[snaps.length - 1];
    const prev = snaps[snaps.length - 2];
    const scoreA = score(delta(prev, cur, "a"), weights);
    const scoreB = score(delta(prev, cur, "b"), weights);
    const spanDays = daysBetween(prev.date, cur.date);
    let winner = null;
    if (scoreA.total > scoreB.total) winner = "a";
    else if (scoreB.total > scoreA.total) winner = "b";
    return {
      hasResult: true,
      isGap: spanDays > 1,
      spanDays: spanDays,
      date: cur.date,
      winner: winner,
      scoreA: scoreA,
      scoreB: scoreB
    };
  }

  // Fuehrender: schlicht wer mehr Follower hat (kein Score/Gewichtung).
  function leader(snapshot) {
    const a = snapshot.a.followers, b = snapshot.b.followers;
    if (a === b) return { side: null, gap: 0 };
    return { side: a > b ? "a" : "b", gap: Math.abs(a - b) };
  }

  function avgLikesPerVideo(snapshot, side) {
    const c = snapshot[side];
    return c.likes / Math.max(c.videos, 1);
  }

  // Follower-Zuwachs gesamt seit erstem Schnappschuss.
  function totalGrowth(snaps, side) {
    if (!snaps || snaps.length < 1) return 0;
    return snaps[snaps.length - 1][side].followers - snaps[0][side].followers;
  }

  // Videos seit Start (erster Schnappschuss).
  function videosSinceStart(snaps, side) {
    if (!snaps || snaps.length < 1) return 0;
    return snaps[snaps.length - 1][side].videos - snaps[0][side].videos;
  }

  // Videos pro Tag (Differenz aufeinanderfolgender Schnappschuesse), nie negativ.
  function videosPerDay(snaps) {
    const labels = [], a = [], b = [];
    for (let i = 1; i < snaps.length; i++) {
      labels.push(snaps[i].date);
      a.push(Math.max(0, snaps[i].a.videos - snaps[i - 1].a.videos));
      b.push(Math.max(0, snaps[i].b.videos - snaps[i - 1].b.videos));
    }
    return { labels, a, b };
  }

  function followerSeries(snaps) {
    return {
      labels: snaps.map(s => s.date),
      a: snaps.map(s => s.a.followers),
      b: snaps.map(s => s.b.followers)
    };
  }

  // Naechster taeglicher Daten-Lauf (utcHour:00 UTC).
  function nextUpdate(now, utcHour) {
    const d = new Date(now);
    const next = new Date(Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), utcHour, 0, 0
    ));
    if (next.getTime() <= d.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  // Tageszuwachs des VORLETZTEN Uebergangs ("gestern"). Degradiert sinnvoll:
  // bei < 3 Snapshots gibt es keinen echten "gestern"-Uebergang -> hasResult:false.
  function yesterdayGains(snaps) {
    const empty = { hasResult: false, deltaA: null, deltaB: null, date: null, spanDays: null };
    if (!snaps || snaps.length < 3) return empty;
    const cur = snaps[snaps.length - 2];
    const prev = snaps[snaps.length - 3];
    return {
      hasResult: true,
      deltaA: delta(prev, cur, "a"),
      deltaB: delta(prev, cur, "b"),
      date: cur.date,
      spanDays: daysBetween(prev.date, cur.date)
    };
  }

  // Mikas (Seite "a") Anteil an den Gesamt-Followern beider Creator, als Prozent (0-100).
  // Liefert zusaetzlich das Delta in Prozentpunkten zum vorherigen Snapshot (0 wenn keiner).
  function followerShare(snaps, side) {
    side = side || "a";
    if (!snaps || snaps.length < 1) return { pct: 50, deltaPct: 0 };
    const cur = snaps[snaps.length - 1];
    const other = side === "a" ? "b" : "a";
    const totalCur = Math.max(cur[side].followers + cur[other].followers, 1);
    const pct = (cur[side].followers / totalCur) * 100;
    if (snaps.length < 2) return { pct: pct, deltaPct: 0 };
    const prev = snaps[snaps.length - 2];
    const totalPrev = Math.max(prev[side].followers + prev[other].followers, 1);
    const pctPrev = (prev[side].followers / totalPrev) * 100;
    return { pct: pct, deltaPct: pct - pctPrev };
  }

  // Tages-Historie fuer die Tabelle: eine Zeile pro Uebergang zwischen aufeinanderfolgenden
  // Snapshots, neueste zuerst. Jede Zeile enthaelt Deltas + Scores beider Seiten, den
  // punktebasierten Tagessieger (Gleichstand -> null), den echten Tagesabstand spanDays
  // und isGap (spanDays > 1: Zeile ist als Daten-Luecke markiert, winner bleibt berechnet).
  function dailyRows(snaps, weights) {
    const rows = [];
    if (!snaps || snaps.length < 2) return rows;
    for (let i = snaps.length - 1; i > 0; i--) {
      const cur = snaps[i], prev = snaps[i - 1];
      const dA = delta(prev, cur, "a");
      const dB = delta(prev, cur, "b");
      const scoreA = score(dA, weights);
      const scoreB = score(dB, weights);
      const spanDays = daysBetween(prev.date, cur.date);
      let winner = null;
      if (scoreA.total > scoreB.total) winner = "a";
      else if (scoreB.total > scoreA.total) winner = "b";
      rows.push({
        date: cur.date,
        deltaA: dA,
        deltaB: dB,
        scoreA: scoreA,
        scoreB: scoreB,
        spanDays: spanDays,
        isGap: spanDays > 1,
        winner: winner
      });
    }
    return rows;
  }

  // Aktuelle Siegesserie nach Punkten. Akzeptiert Snapshots ODER fertige dailyRows
  // (neueste zuerst). Regeln: vom juengsten Uebergang rueckwaerts zaehlen nur echte
  // Tagessiege; Luecken-Uebergaenge (isGap) werden uebersprungen (weder Sieg noch
  // Unterbrechung); Gleichstand oder Sieg der Gegenseite beendet die Serie.
  function streak(input, weights) {
    const none = { side: null, count: 0 };
    if (!input || !input.length) return none;
    const rows = ("winner" in input[0]) ? input : dailyRows(input, weights);
    let side = null, count = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.isGap) continue;
      if (r.winner === null) break;
      if (side === null) side = r.winner;
      if (r.winner !== side) break;
      count++;
    }
    return count === 0 ? none : { side: side, count: count };
  }

  // W:L:T der letzten 7 Kalendertage (Fenster endet bei today, Default: juengster
  // Snapshot). Zaehlt NUR echte 1-Tages-Uebergaenge; Luecken bleiben aussen vor.
  function winLoss7d(snaps, weights, today) {
    const res = { a: { wins: 0, losses: 0, ties: 0 }, b: { wins: 0, losses: 0, ties: 0 } };
    if (!snaps || snaps.length < 2) return res;
    const ref = today || snaps[snaps.length - 1].date;
    const rows = dailyRows(snaps, weights);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.spanDays !== 1) continue;
      const dist = daysBetween(r.date, ref);
      if (dist < 0 || dist > 6) continue;
      if (r.winner === "a") { res.a.wins++; res.b.losses++; }
      else if (r.winner === "b") { res.b.wins++; res.a.losses++; }
      else { res.a.ties++; res.b.ties++; }
    }
    return res;
  }

  // Durchschnittlicher Follower-Zuwachs pro Tag ueber die letzten <= 7 Kalendertage
  // (Fenster ab juengstem Snapshot, echte Tagesabstaende als Divisor).
  // Weniger als 2 Snapshots im Fenster -> 0.
  function velocity7d(snaps, side) {
    if (!snaps || snaps.length < 2) return 0;
    const last = snaps[snaps.length - 1];
    const win = snaps.filter(s => {
      const d = daysBetween(s.date, last.date);
      return d >= 0 && d <= 6;
    });
    if (win.length < 2) return 0;
    const span = daysBetween(win[0].date, last.date);
    if (span <= 0) return 0;
    return (last[side].followers - win[0][side].followers) / span;
  }

  // Naechstes rundes Follower-Ziel: 50/100/150/200/250/300/400/500/750/1000,
  // danach 1500/2000/3000/4000/5000/7500/10000 und dieselbe Reihe je Zehnerpotenz weiter.
  function nextMilestone(current) {
    const base = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
    for (let i = 0; i < base.length; i++) if (base[i] > current) return base[i];
    const pattern = [1.5, 2, 3, 4, 5, 7.5, 10];
    let scale = 1000;
    for (;;) {
      for (let i = 0; i < pattern.length; i++) {
        const m = pattern[i] * scale;
        if (m > current) return m;
      }
      scale *= 10;
    }
  }

  // "YYYY-MM-DD" plus n Tage (UTC-sicher).
  function addDays(dateStr, n) {
    const t = Date.parse(dateStr + "T00:00:00Z") + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  // Prognose bis zum naechsten runden Follower-Ziel, Tempo aus velocity7d.
  // now: "YYYY-MM-DD", Date oder Timestamp; Default ist das Datum des juengsten Snapshots.
  // Velocity <= 0 -> etaDate/days null (UI zeigt "bei dem Tempo: nie").
  function milestoneProjection(snaps, side, now) {
    if (!snaps || !snaps.length) return { target: null, etaDate: null, days: null, velocity: 0 };
    const current = snaps[snaps.length - 1][side].followers;
    const target = nextMilestone(current);
    const velocity = velocity7d(snaps, side);
    if (velocity <= 0) return { target: target, etaDate: null, days: null, velocity: velocity };
    const ref = (now === undefined || now === null)
      ? snaps[snaps.length - 1].date
      : (typeof now === "string" ? now : new Date(now).toISOString().slice(0, 10));
    const days = Math.ceil((target - current) / velocity);
    return { target: target, etaDate: addDays(ref, days), days: days, velocity: velocity };
  }

  // Juengster Views-Zuwachs pro Seite aus viewsTotal. Eine Seite ist nur auswertbar,
  // wenn BEIDE beteiligten Snapshots dort ein numerisches viewsTotal haben --
  // fehlendes viewsTotal wird NIE als 0 behandelt (0 selbst ist ein echter Wert).
  // hasResult ist true, sobald mindestens eine Seite auswertbar ist.
  function viewsGain(snaps) {
    const empty = { hasResult: false, a: null, b: null, spanDays: null, perDayA: null, perDayB: null };
    if (!snaps || snaps.length < 2) return empty;
    const cur = snaps[snaps.length - 1];
    const prev = snaps[snaps.length - 2];
    function gain(side) {
      const p = prev[side].viewsTotal, c = cur[side].viewsTotal;
      if (typeof p !== "number" || typeof c !== "number") return null;
      return c - p;
    }
    const a = gain("a"), b = gain("b");
    if (a === null && b === null) return empty;
    const spanDays = daysBetween(prev.date, cur.date);
    function perDay(g) {
      return (g === null || spanDays <= 0) ? null : g / spanDays;
    }
    return { hasResult: true, a: a, b: b, spanDays: spanDays, perDayA: perDay(a), perDayB: perDay(b) };
  }

  // ---------------------------------------------------------------------
  // Video-Funktionen (arbeiten auf data/videos.json, das fehlen/leer sein kann)
  // ---------------------------------------------------------------------

  // Unix-Sekunden (createTime) -> "YYYY-MM-DD" (UTC).
  function createTimeToDate(createTime) {
    return new Date(createTime * 1000).toISOString().slice(0, 10);
  }

  // Engagement eines Videos: Likes geteilt durch Views (0 wenn Views fehlen/0).
  function engagementRate(video) {
    if (!video || typeof video.views !== "number" || video.views <= 0) return 0;
    return (video.likes || 0) / video.views;
  }

  // Kalender-Heatmap (GitHub-Stil) der letzten `weeks` Wochen. Wochenstart Montag (de-CH).
  // Rueckgabe: FLACHES, chronologisches Array von Tagen { date, a, b } -- beginnt am
  // Montag der Woche (weeks-1) Wochen vor der Woche von `today` und endet bei `today`.
  // a/b = Anzahl der an dem Tag geposteten Videos je Seite (aus createTime, UTC).
  function heatmapData(videosJson, weeks, today) {
    const DAY = 86400000;
    const todayT = Date.parse(today + "T00:00:00Z");
    const dow = (new Date(todayT).getUTCDay() + 6) % 7; // 0 = Montag
    const startT = todayT - dow * DAY - (weeks - 1) * 7 * DAY;
    const counts = { a: {}, b: {} };
    ["a", "b"].forEach(side => {
      const vids = (videosJson && videosJson[side]) || [];
      vids.forEach(v => {
        const d = createTimeToDate(v.createTime);
        counts[side][d] = (counts[side][d] || 0) + 1;
      });
    });
    const days = [];
    for (let t = startT; t <= todayT; t += DAY) {
      const date = new Date(t).toISOString().slice(0, 10);
      days.push({ date: date, a: counts.a[date] || 0, b: counts.b[date] || 0 });
    }
    return days;
  }

  // Video mit den meisten Views unter allen in den letzten 7 Kalendertagen
  // (today-6 .. today) geposteten Videos beider Seiten.
  function topVideoOfWeek(videosJson, today) {
    let best = { side: null, video: null };
    if (!videosJson) return best;
    ["a", "b"].forEach(side => {
      (videosJson[side] || []).forEach(v => {
        const dist = daysBetween(createTimeToDate(v.createTime), today);
        if (dist < 0 || dist > 6) return;
        if (!best.video || (v.views || 0) > (best.video.views || 0)) {
          best = { side: side, video: v };
        }
      });
    });
    return best;
  }

  // Neuestes Video je Seite -- streng nach createTime, gepinnte (isTop) zaehlen nicht extra.
  function headToHead(videosJson) {
    function newest(list) {
      if (!list || !list.length) return null;
      let best = list[0];
      for (let i = 1; i < list.length; i++) {
        if (list[i].createTime > best.createTime) best = list[i];
      }
      return best;
    }
    return {
      a: newest(videosJson && videosJson.a),
      b: newest(videosJson && videosJson.b)
    };
  }

  // ---------------------------------------------------------------------
  // Spruch des Tages: deterministischer Roast unter Freunden
  // ---------------------------------------------------------------------

  // Platzhalter: {sieger}, {verlierer}, {punkte}. Dark Humor unter Freunden --
  // der Verlierer wird aufgezogen, nichts wirklich Verletzendes.
  const spruchPool = {
    normal: [
      "{sieger} gewinnt mit {punkte}. {verlierer} nennt das 'Aufbauphase' -- seit Wochen.",
      "{punkte} fuer {sieger}. {verlierer}, dein Content ist wie dein Follower-Zuwachs: kaum messbar.",
      "{sieger} holt den Tag. {verlierer} holt sich derweil Ausreden im Doppelpack.",
      "Tagessieg fuer {sieger} ({punkte}). {verlierer} filmt vermutlich gerade wieder den Boden.",
      "{verlierer} verliert mit {punkte}. Der Algorithmus hat dich gesehen -- und ist weitergescrollt.",
      "{sieger} zieht davon. {verlierer}, selbst deine Mutter hat heute nicht geliked.",
      "{punkte}. {sieger} macht Content, {verlierer} macht Inventur.",
      "{verlierer}, das war so knapp wie ein Marathon gegen ein Auto. {sieger} gewinnt {punkte}.",
      "{sieger} gewinnt. {verlierer} bleibt immerhin ungeschlagen im Verlieren.",
      "Wieder {sieger}. {verlierer}, dein Highlight des Tages war das Aufwachen.",
      "{punkte} fuer {sieger}. {verlierer} sammelt Punkte wie ein Stein Sonnenbraeune.",
      "{sieger} dominiert. {verlierer}, TikTok hat Support angeboten -- emotionalen.",
      "{verlierer} kassiert eine {punkte}-Klatsche. Immerhin konstant.",
      "{sieger} siegt souveraen. {verlierer} probt weiter fuer die Teilnahme.",
      "Der Tag gehoert {sieger}. {verlierer} gehoert getroestet.",
      "{punkte}! {sieger} laeuft, {verlierer} laedt noch.",
      "{sieger} gewinnt das Duell. {verlierer} gewinnt Erfahrung. Schon wieder.",
      "{verlierer}, dein Konto waechst langsamer als dein Selbstbewusstsein schrumpft. {sieger}: {punkte}.",
      "{sieger} nimmt den Sieg mit. {verlierer} nimmt es persoenlich -- zu Recht.",
      "{punkte} fuer {sieger}. {verlierer}, poste doch mal was. Irgendwas.",
      "{sieger} vorne, {verlierer} hinten. Die Natur ordnet sich.",
      "{verlierer} verliert {punkte}. Experten raten zu: besserem Content.",
      "{sieger} gewinnt. {verlierer}s Fans (beide) sind enttaeuscht.",
      "Heute {sieger}, morgen {sieger}, uebermorgen... {verlierer}, du darfst raten.",
      "{punkte}. {verlierer}, das ist kein Rueckstand mehr, das ist Folklore.",
      "{sieger} liefert ab. {verlierer} liefert Begruendungen.",
      "{verlierer}, dein bester Move heute war, nicht nachzuschauen. {sieger}: {punkte}.",
      "{sieger} holt sich den Tag wie ein Profi. {verlierer} schaut zu wie ein Fan.",
      "{punkte} -- {sieger} feiert, {verlierer} formuliert schon das Comeback-Posting.",
      "{sieger} gewinnt haushoch. {verlierer}, Duell heisst: BEIDE machen mit.",
      "{verlierer} bleibt dran! An {sieger}s Ruecklichtern. {punkte}.",
      "{sieger} macht Punkte, {verlierer} macht Pause. Stand: {punkte}."
    ],
    unentschieden: [
      "Unentschieden ({punkte}). Zwei Verlierer, keine Zeugen.",
      "{punkte} -- Gleichstand. Ihr habt euch das Mittelmass redlich verdient.",
      "Patt bei {punkte}. Der Algorithmus konnte sich nicht entscheiden, wen er ignoriert.",
      "Gleichstand {punkte}. Morgen bitte wieder mit Ehrgeiz."
    ]
  };

  // Simpler, stabiler String-Hash (djb2-Variante) fuer die deterministische Auswahl.
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Deterministischer Tages-Roast: gleicher Tag = gleicher Spruch.
  // kontext = { sieger, verlierer, punkte, unentschieden? } -- punkte z. B. "14:9".
  function spruchDesTages(dateStr, kontext) {
    const pool = kontext && kontext.unentschieden ? spruchPool.unentschieden : spruchPool.normal;
    const template = pool[hashStr(dateStr) % pool.length];
    return template
      .split("{sieger}").join(kontext.sieger)
      .split("{verlierer}").join(kontext.verlierer)
      .split("{punkte}").join(kontext.punkte);
  }

  // Schneidet die Snapshot-Liste auf einen Zeitraum zu ("7d", "30d", "all").
  // Bezugspunkt ist immer der juengste Snapshot; unbekannte Range -> alles.
  function filterByRange(snaps, range) {
    if (!snaps || !snaps.length) return [];
    if (!range || range === "all") return snaps.slice();
    const days = range === "7d" ? 7 : range === "30d" ? 30 : null;
    if (days === null) return snaps.slice();
    const lastDate = new Date(snaps[snaps.length - 1].date + "T00:00:00Z").getTime();
    const cutoff = lastDate - (days - 1) * 86400000;
    const filtered = snaps.filter(s => new Date(s.date + "T00:00:00Z").getTime() >= cutoff);
    // Immer mindestens die letzten 2 Snapshots behalten, damit Deltas/Charts sinnvoll bleiben.
    if (filtered.length < 2 && snaps.length >= 2) return snaps.slice(-2);
    return filtered;
  }

  return {
    delta, dayGains, yesterdayGains, leader, avgLikesPerVideo, totalGrowth, videosSinceStart,
    videosPerDay, followerSeries, nextUpdate, followerShare, dailyRows, filterByRange,
    daysBetween, score, dayWinner, streak, winLoss7d, velocity7d, milestoneProjection, viewsGain,
    engagementRate, heatmapData, topVideoOfWeek, headToHead, spruchDesTages, spruchPool
  };
});
