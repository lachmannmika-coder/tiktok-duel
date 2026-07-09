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

  // Tageszuwachs aus juengstem vs. vorletztem Schnappschuss (fuer beide Seiten).
  function dayGains(snaps) {
    const empty = { hasResult: false, deltaA: null, deltaB: null, date: null };
    if (!snaps || snaps.length < 2) return empty;
    const cur = snaps[snaps.length - 1];
    const prev = snaps[snaps.length - 2];
    return {
      hasResult: true,
      deltaA: delta(prev, cur, "a"),
      deltaB: delta(prev, cur, "b"),
      date: cur.date
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
    const empty = { hasResult: false, deltaA: null, deltaB: null, date: null };
    if (!snaps || snaps.length < 3) return empty;
    const cur = snaps[snaps.length - 2];
    const prev = snaps[snaps.length - 3];
    return {
      hasResult: true,
      deltaA: delta(prev, cur, "a"),
      deltaB: delta(prev, cur, "b"),
      date: cur.date
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
  // Snapshots, neueste zuerst. Jede Zeile enthaelt die Deltas beider Seiten + Tagessieger
  // (wer an dem Tag mehr Follower dazugewonnen hat; bei Gleichstand kein Sieger).
  function dailyRows(snaps) {
    const rows = [];
    if (!snaps || snaps.length < 2) return rows;
    for (let i = snaps.length - 1; i > 0; i--) {
      const cur = snaps[i], prev = snaps[i - 1];
      const dA = delta(prev, cur, "a");
      const dB = delta(prev, cur, "b");
      let winner = null;
      if (dA.followers > dB.followers) winner = "a";
      else if (dB.followers > dA.followers) winner = "b";
      rows.push({ date: cur.date, deltaA: dA, deltaB: dB, winner: winner });
    }
    return rows;
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
    videosPerDay, followerSeries, nextUpdate, followerShare, dailyRows, filterByRange
  };
});
