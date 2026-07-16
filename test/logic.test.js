// Unit-Tests fuer die reine Logik. Laeuft mit: node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const L = require("../src/logic.js");
const CONFIG = require("../src/config.js");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

// Score-Gewichte wie in src/config.js (Formel: Follower*3 + Likes*1 + Videos*2).
const W = { followers: 3, likes: 1, videos: 2 };

// Echte Daten nachgebildet: 18-Tage-Luecke zwischen 2026-06-21 und 2026-07-09,
// danach taegliche Snapshots (wie data/history.json).
function gapSnaps() {
  return [
    { date: "2026-06-21", a: { followers: 129, following: 453, likes: 23057, videos: 30 }, b: { followers: 24, following: 19, likes: 858, videos: 7 } },
    { date: "2026-07-09", a: { followers: 171, following: 460, likes: 55776, videos: 37 }, b: { followers: 25, following: 33, likes: 1022, videos: 12 } },
    { date: "2026-07-10", a: { followers: 171, following: 460, likes: 55793, videos: 37 }, b: { followers: 25, following: 33, likes: 1025, videos: 12 } },
    { date: "2026-07-11", a: { followers: 173, following: 460, likes: 55822, videos: 37 }, b: { followers: 26, following: 33, likes: 1029, videos: 12 } },
    { date: "2026-07-12", a: { followers: 173, following: 460, likes: 55870, videos: 38 }, b: { followers: 26, following: 33, likes: 1030, videos: 12 } }
  ];
}

test("01 single snapshot -> kein Tageszuwachs, aber Fuehrender aus dem einen Stand", () => {
  const db = load("01_single.json");
  const g = L.dayGains(db.snapshots);
  assert.equal(g.hasResult, false);
  const cur = db.snapshots[db.snapshots.length - 1];
  const lead = L.leader(cur);
  assert.equal(lead.side, "a"); // 129 vs 24 Follower
  assert.equal(lead.gap, 105);
});

test("02 sieben Tage, Tageszuwachs aus letztem Uebergang", () => {
  const db = load("02_seven_days.json");
  const g = L.dayGains(db.snapshots);
  assert.equal(g.hasResult, true);
  // Letzter Uebergang: a +1 Follower/+10 Likes, b +5 Follower/+50 Likes
  assert.equal(g.deltaA.followers, 1);
  assert.equal(g.deltaA.likes, 10);
  assert.equal(g.deltaB.followers, 5);
  assert.equal(g.deltaB.likes, 50);
});

test("03 Fuehrender ergibt sich rein aus Follower-Anzahl", () => {
  const db = load("03_streak.json");
  const cur = db.snapshots[db.snapshots.length - 1];
  const lead = L.leader(cur);
  assert.equal(lead.side, cur.a.followers > cur.b.followers ? "a" : "b");
  assert.equal(lead.gap, Math.abs(cur.a.followers - cur.b.followers));
});

test("04 Gleichstand bei Followern -> kein Fuehrender", () => {
  const db = load("04_tie.json");
  const cur = db.snapshots[db.snapshots.length - 1];
  cur.a.followers = cur.b.followers; // Gleichstand erzwingen fuer den Test
  const lead = L.leader(cur);
  assert.equal(lead.side, null);
  assert.equal(lead.gap, 0);
});

test("05 negativer Zuwachs (Follower verloren) wird korrekt verrechnet", () => {
  const db = load("05_negative.json");
  const g = L.dayGains(db.snapshots);
  assert.equal(g.deltaA.followers, -5);
  assert.equal(g.deltaB.followers, 5);
});

test("delta rechnet alle Felder", () => {
  const prev = { a: { followers: 10, following: 5, likes: 100, videos: 2 } };
  const cur = { a: { followers: 15, following: 4, likes: 130, videos: 3 } };
  assert.deepEqual(L.delta(prev, cur, "a"), { followers: 5, likes: 30, videos: 1, following: -1 });
});

test("videosPerDay nie negativ", () => {
  const db = load("03_streak.json");
  const v = L.videosPerDay(db.snapshots);
  assert.equal(v.labels.length, 4);
  assert.ok(v.a.every(n => n >= 0));
  assert.ok(v.b.every(n => n >= 0));
});

test("followerSeries liefert parallele Reihen", () => {
  const db = load("02_seven_days.json");
  const f = L.followerSeries(db.snapshots);
  assert.equal(f.labels.length, 7);
  assert.equal(f.a.length, 7);
  assert.equal(f.b[6], 118);
});

test("avgLikesPerVideo teilt nicht durch null", () => {
  assert.equal(L.avgLikesPerVideo({ a: { likes: 100, videos: 0 } }, "a"), 100);
  assert.equal(L.avgLikesPerVideo({ a: { likes: 100, videos: 4 } }, "a"), 25);
});

test("totalGrowth misst Follower-Zuwachs seit erstem Schnappschuss", () => {
  const db = load("02_seven_days.json");
  const first = db.snapshots[0].a.followers;
  const last = db.snapshots[db.snapshots.length - 1].a.followers;
  assert.equal(L.totalGrowth(db.snapshots, "a"), last - first);
});

test("videosSinceStart misst Video-Zuwachs seit erstem Schnappschuss", () => {
  const db = load("03_streak.json");
  const first = db.snapshots[0].b.videos;
  const last = db.snapshots[db.snapshots.length - 1].b.videos;
  assert.equal(L.videosSinceStart(db.snapshots, "b"), last - first);
});

test("nextUpdate liefert kommenden 06:00-UTC-Lauf", () => {
  // 05:00 UTC -> selber Tag 06:00
  const a = L.nextUpdate(Date.UTC(2026, 5, 21, 5, 0, 0), 6);
  assert.equal(a.getUTCHours(), 6);
  assert.equal(a.getUTCDate(), 21);
  // 07:00 UTC -> naechster Tag 06:00
  const b = L.nextUpdate(Date.UTC(2026, 5, 21, 7, 0, 0), 6);
  assert.equal(b.getUTCDate(), 22);
  assert.equal(b.getUTCHours(), 6);
});

test("CONFIG enthaelt Farben fuer beide Creator, keine Fraktionen/Score-Gewichte", () => {
  assert.ok(CONFIG.colors.a);
  assert.ok(CONFIG.colors.b);
  assert.equal(CONFIG.score, undefined);
  assert.equal(CONFIG.roles, undefined);
  assert.equal(CONFIG.escalation, undefined);
});

test("yesterdayGains: weniger als 3 Snapshots -> kein Ergebnis (sinnvoll degradiert)", () => {
  const db = load("01_single.json");
  const y = L.yesterdayGains(db.snapshots);
  assert.equal(y.hasResult, false);
});

test("yesterdayGains: bei genau 2 Snapshots ebenfalls kein 'gestern' vorhanden", () => {
  // Nur ein Uebergang existiert -> der ist "heute", es gibt kein "gestern" davor.
  const snaps = [
    { date: "2026-06-21", a: { followers: 129, following: 453, likes: 23057, videos: 30 }, b: { followers: 24, following: 19, likes: 858, videos: 7 } },
    { date: "2026-07-09", a: { followers: 171, following: 460, likes: 55776, videos: 37 }, b: { followers: 25, following: 33, likes: 1022, videos: 12 } }
  ];
  const y = L.yesterdayGains(snaps);
  assert.equal(y.hasResult, false);
});

test("yesterdayGains: ab 3 Snapshots liefert den vorletzten Uebergang", () => {
  const db = load("02_seven_days.json");
  const y = L.yesterdayGains(db.snapshots);
  assert.equal(y.hasResult, true);
  // vorletzter Uebergang (Index 4->5): a 112->117 (+5), b 112->113 (+1)
  assert.equal(y.deltaA.followers, 5);
  assert.equal(y.deltaB.followers, 1);
});

test("followerShare: Anteil Mikas an Gesamt-Followern in Prozent", () => {
  const snaps = [
    { date: "2026-06-21", a: { followers: 129 }, b: { followers: 24 } },
    { date: "2026-07-09", a: { followers: 171 }, b: { followers: 25 } }
  ];
  const s = L.followerShare(snaps, "a");
  // 171 / (171+25) = 87.24%
  assert.ok(Math.abs(s.pct - (171 / 196 * 100)) < 1e-9);
  const prevPct = 129 / 153 * 100;
  assert.ok(Math.abs(s.deltaPct - (s.pct - prevPct)) < 1e-9);
});

test("followerShare: einzelner Snapshot -> deltaPct 0", () => {
  const db = load("01_single.json");
  const s = L.followerShare(db.snapshots, "a");
  assert.equal(s.deltaPct, 0);
  assert.ok(s.pct > 50);
});

test("dailyRows: eine Zeile pro Uebergang, neueste zuerst, mit punktebasiertem Tagessieger", () => {
  const db = load("02_seven_days.json");
  const rows = L.dailyRows(db.snapshots, W);
  assert.equal(rows.length, 6);
  // Neueste zuerst: letzter Uebergang ist 06-20 -> 06-21
  assert.equal(rows[0].date, "2026-06-21");
  assert.equal(rows[rows.length - 1].date, "2026-06-16");
  // Uebergang 06-20->06-21: a +1F/+10L/+1V = 15 Punkte, b +5F/+50L/+1V = 67 Punkte -> Tino gewinnt
  assert.equal(rows[0].deltaA.followers, 1);
  assert.equal(rows[0].deltaB.followers, 5);
  assert.equal(rows[0].winner, "b");
});

test("dailyRows: weniger als 2 Snapshots -> leere Liste", () => {
  const db = load("01_single.json");
  assert.deepEqual(L.dailyRows(db.snapshots, W), []);
});

test("dailyRows: Gleichstand nach Punkten -> kein Sieger", () => {
  const snaps = [
    { date: "2026-06-20", a: { followers: 100, following: 1, likes: 1, videos: 1 }, b: { followers: 100, following: 1, likes: 1, videos: 1 } },
    { date: "2026-06-21", a: { followers: 105, following: 1, likes: 1, videos: 1 }, b: { followers: 105, following: 1, likes: 1, videos: 1 } }
  ];
  const rows = L.dailyRows(snaps, W);
  assert.equal(rows[0].winner, null);
});

test("filterByRange: '7d' behaelt nur die letzten 7 Kalendertage ab juengstem Snapshot", () => {
  const db = load("02_seven_days.json");
  const f = L.filterByRange(db.snapshots, "7d");
  assert.equal(f.length, 7); // alle 7 liegen exakt in den letzten 7 Tagen
});

test("filterByRange: 'all' liefert alle Snapshots unveraendert", () => {
  const db = load("02_seven_days.json");
  const f = L.filterByRange(db.snapshots, "all");
  assert.equal(f.length, db.snapshots.length);
});

test("filterByRange: Zeitraum groesser als Datenspanne -> keine Kuerzung", () => {
  const db = load("01_single.json");
  const f = L.filterByRange(db.snapshots, "30d");
  assert.equal(f.length, db.snapshots.length);
});

test("filterByRange: haelt mindestens 2 Snapshots, wenn vorhanden, auch bei enger Range", () => {
  // Zwei Snapshots weit auseinander (wie unser echtes history.json: 21.06. und 09.07.)
  const snaps = [
    { date: "2026-06-21", a: { followers: 129, following: 1, likes: 1, videos: 1 }, b: { followers: 24, following: 1, likes: 1, videos: 1 } },
    { date: "2026-07-09", a: { followers: 171, following: 1, likes: 1, videos: 1 }, b: { followers: 25, following: 1, likes: 1, videos: 1 } }
  ];
  const f = L.filterByRange(snaps, "7d");
  assert.equal(f.length, 2);
});

// ---------------------------------------------------------------------------
// Datums-Helfer
// ---------------------------------------------------------------------------

test("daysBetween: ganze Tage zwischen zwei YYYY-MM-DD (vorzeichenbehaftet, UTC-sicher)", () => {
  assert.equal(L.daysBetween("2026-06-21", "2026-07-09"), 18); // die echte Luecke
  assert.equal(L.daysBetween("2026-07-11", "2026-07-12"), 1);
  assert.equal(L.daysBetween("2026-07-12", "2026-07-12"), 0);
  assert.equal(L.daysBetween("2026-07-09", "2026-06-21"), -18); // rueckwaerts negativ
  assert.equal(L.daysBetween("2026-12-31", "2027-01-01"), 1); // Jahreswechsel
});

// ---------------------------------------------------------------------------
// dayGains / yesterdayGains mit spanDays
// ---------------------------------------------------------------------------

test("dayGains: liefert spanDays des juengsten Uebergangs", () => {
  const db = load("02_seven_days.json");
  const g = L.dayGains(db.snapshots);
  assert.equal(g.spanDays, 1);
  // 18-Tage-Luecke als juengster Uebergang
  const g2 = L.dayGains(gapSnaps().slice(0, 2));
  assert.equal(g2.hasResult, true);
  assert.equal(g2.spanDays, 18);
});

test("dayGains: leere/degenerierte Eingabe -> spanDays null", () => {
  assert.equal(L.dayGains([]).spanDays, null);
  assert.equal(L.dayGains(null).spanDays, null);
  assert.equal(L.dayGains(gapSnaps().slice(0, 1)).spanDays, null);
});

test("yesterdayGains: liefert spanDays des vorletzten Uebergangs", () => {
  // Vorletzter Uebergang in gapSnaps: 07-10 -> 07-11 (1 Tag)
  const y = L.yesterdayGains(gapSnaps());
  assert.equal(y.hasResult, true);
  assert.equal(y.date, "2026-07-11");
  assert.equal(y.spanDays, 1);
  // Bei genau 3 Snapshots mit Luecke vorn: vorletzter Uebergang ist die Luecke
  const y2 = L.yesterdayGains(gapSnaps().slice(0, 3));
  assert.equal(y2.spanDays, 18);
  // Degeneriert
  assert.equal(L.yesterdayGains([]).spanDays, null);
});

// ---------------------------------------------------------------------------
// score
// ---------------------------------------------------------------------------

test("score: Follower*3 + Likes*1 + Videos*2 mit Breakdown", () => {
  const s = L.score({ followers: 2, likes: 5, videos: 1 }, W);
  assert.equal(s.total, 13); // 6 + 5 + 2
  assert.deepEqual(s.parts.followers, { value: 2, weighted: 6 });
  assert.deepEqual(s.parts.likes, { value: 5, weighted: 5 });
  assert.deepEqual(s.parts.videos, { value: 1, weighted: 2 });
});

test("score: negative Zuwaechse zaehlen ehrlich negativ", () => {
  const s = L.score({ followers: -2, likes: 3, videos: 0 }, W);
  assert.equal(s.total, -3); // -6 + 3 + 0
  assert.equal(s.parts.followers.weighted, -6);
});

test("CONFIG.scoring enthaelt die zentralen Score-Gewichte", () => {
  assert.deepEqual(CONFIG.scoring, { followers: 3, likes: 1, videos: 2 });
});

// ---------------------------------------------------------------------------
// dayWinner
// ---------------------------------------------------------------------------

test("dayWinner: Sieger des juengsten Uebergangs nach Punkten", () => {
  const w = L.dayWinner(gapSnaps(), W);
  // Juengster Uebergang 07-11 -> 07-12: a +0F/+48L/+1V = 50, b +0F/+1L/+0V = 1
  assert.equal(w.hasResult, true);
  assert.equal(w.isGap, false);
  assert.equal(w.spanDays, 1);
  assert.equal(w.date, "2026-07-12");
  assert.equal(w.winner, "a");
  assert.equal(w.scoreA.total, 50);
  assert.equal(w.scoreB.total, 1);
});

test("dayWinner: 18-Tage-Luecke -> isGap true, Scores trotzdem berechnet", () => {
  const w = L.dayWinner(gapSnaps().slice(0, 2), W);
  assert.equal(w.hasResult, true);
  assert.equal(w.isGap, true);
  assert.equal(w.spanDays, 18);
  // a: +42F/+32719L/+7V = 126+32719+14 = 32859; b: +1F/+164L/+5V = 3+164+10 = 177
  assert.equal(w.scoreA.total, 32859);
  assert.equal(w.scoreB.total, 177);
  assert.equal(w.winner, "a");
});

test("dayWinner: Gleichstand nach Punkten -> winner null", () => {
  const snaps = [
    { date: "2026-07-11", a: { followers: 10, following: 1, likes: 5, videos: 1 }, b: { followers: 20, following: 1, likes: 5, videos: 1 } },
    { date: "2026-07-12", a: { followers: 12, following: 1, likes: 6, videos: 1 }, b: { followers: 22, following: 1, likes: 6, videos: 1 } }
  ];
  const w = L.dayWinner(snaps, W);
  assert.equal(w.winner, null);
  assert.equal(w.scoreA.total, w.scoreB.total);
});

test("dayWinner: 0 oder 1 Snapshot -> hasResult false", () => {
  assert.equal(L.dayWinner([], W).hasResult, false);
  assert.equal(L.dayWinner(null, W).hasResult, false);
  assert.equal(L.dayWinner(gapSnaps().slice(0, 1), W).hasResult, false);
});

// ---------------------------------------------------------------------------
// dailyRows: spanDays, isGap, Scores
// ---------------------------------------------------------------------------

test("dailyRows: Zeilen enthalten spanDays, isGap und Score-Objekte", () => {
  const rows = L.dailyRows(gapSnaps(), W);
  assert.equal(rows.length, 4);
  // Neueste Zeile: 07-12, echter Tagesabstand
  assert.equal(rows[0].date, "2026-07-12");
  assert.equal(rows[0].spanDays, 1);
  assert.equal(rows[0].isGap, false);
  assert.equal(rows[0].scoreA.total, 50);
  assert.equal(rows[0].scoreB.total, 1);
  assert.equal(rows[0].winner, "a");
  // Aelteste Zeile ist die 18-Tage-Luecke: markiert, aber winner bleibt berechnet
  const gapRow = rows[rows.length - 1];
  assert.equal(gapRow.date, "2026-07-09");
  assert.equal(gapRow.spanDays, 18);
  assert.equal(gapRow.isGap, true);
  assert.equal(gapRow.winner, "a");
  assert.equal(gapRow.scoreA.total, 32859);
});

// ---------------------------------------------------------------------------
// streak: aktuelle Siegesserie
// ---------------------------------------------------------------------------

// Verhalten (bindend): vom juengsten Uebergang rueckwaerts zaehlen NUR echte
// Tagessiege (spanDays === 1). Luecken-Uebergaenge (isGap) werden UEBERSPRUNGEN
// (weder Sieg noch Unterbrechung). Gleichstand oder Sieg der Gegenseite beendet die Serie.

test("streak: zaehlt Serie des juengsten Siegers, Luecke wird uebersprungen", () => {
  // gapSnaps: 3 echte Tagessiege fuer a (07-10, 07-11, 07-12), davor die 18-Tage-Luecke.
  // Die Luecke zaehlt NICHT als 4. Sieg, unterbricht aber auch nicht.
  const s = L.streak(gapSnaps(), W);
  assert.equal(s.side, "a");
  assert.equal(s.count, 3);
});

test("streak: Sieg der Gegenseite beendet die Serie", () => {
  // Uebergaenge (alt -> neu): b gewinnt, dann a gewinnt 2x -> Serie a mit 2
  const snaps = [
    { date: "2026-07-09", a: { followers: 100, following: 1, likes: 100, videos: 1 }, b: { followers: 100, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-10", a: { followers: 100, following: 1, likes: 100, videos: 1 }, b: { followers: 105, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-11", a: { followers: 103, following: 1, likes: 100, videos: 1 }, b: { followers: 105, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-12", a: { followers: 106, following: 1, likes: 100, videos: 1 }, b: { followers: 105, following: 1, likes: 100, videos: 1 } }
  ];
  const s = L.streak(snaps, W);
  assert.equal(s.side, "a");
  assert.equal(s.count, 2);
});

test("streak: Gleichstand im juengsten Uebergang -> keine Serie", () => {
  const snaps = [
    { date: "2026-07-10", a: { followers: 100, following: 1, likes: 100, videos: 1 }, b: { followers: 90, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-11", a: { followers: 105, following: 1, likes: 100, videos: 1 }, b: { followers: 90, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-12", a: { followers: 106, following: 1, likes: 101, videos: 1 }, b: { followers: 91, following: 1, likes: 101, videos: 1 } }
  ];
  // Juengster Uebergang: beide +1F/+1L -> Gleichstand beendet die Serie sofort.
  const s = L.streak(snaps, W);
  assert.equal(s.side, null);
  assert.equal(s.count, 0);
});

test("streak: akzeptiert auch fertige dailyRows als Eingabe", () => {
  const rows = L.dailyRows(gapSnaps(), W);
  const s = L.streak(rows, W);
  assert.deepEqual(s, { side: "a", count: 3 });
});

test("streak: leere/degenerierte Eingabe -> keine Serie", () => {
  assert.deepEqual(L.streak([], W), { side: null, count: 0 });
  assert.deepEqual(L.streak(null, W), { side: null, count: 0 });
  assert.deepEqual(L.streak(gapSnaps().slice(0, 1), W), { side: null, count: 0 });
});

// ---------------------------------------------------------------------------
// winLoss7d: W:L der letzten 7 Kalendertage
// ---------------------------------------------------------------------------

test("winLoss7d: zaehlt nur echte 1-Tages-Uebergaenge der letzten 7 Kalendertage", () => {
  // gapSnaps: Luecken-Uebergang endet am 07-09 (liegt im Fenster, zaehlt aber NICHT,
  // weil spanDays 18). Echte Tagessiege: 07-10, 07-11, 07-12 -> alle fuer a.
  const wl = L.winLoss7d(gapSnaps(), W);
  assert.deepEqual(wl.a, { wins: 3, losses: 0, ties: 0 });
  assert.deepEqual(wl.b, { wins: 0, losses: 3, ties: 0 });
});

test("winLoss7d: Gleichstand zaehlt fuer beide als tie", () => {
  const snaps = [
    { date: "2026-07-10", a: { followers: 100, following: 1, likes: 100, videos: 1 }, b: { followers: 90, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-11", a: { followers: 105, following: 1, likes: 100, videos: 1 }, b: { followers: 90, following: 1, likes: 100, videos: 1 } },
    { date: "2026-07-12", a: { followers: 106, following: 1, likes: 100, videos: 1 }, b: { followers: 91, following: 1, likes: 100, videos: 1 } }
  ];
  const wl = L.winLoss7d(snaps, W);
  assert.deepEqual(wl.a, { wins: 1, losses: 0, ties: 1 });
  assert.deepEqual(wl.b, { wins: 0, losses: 1, ties: 1 });
});

test("winLoss7d: explizites today verschiebt das Fenster", () => {
  // Fenster 07-14..07-20 -> keine Uebergaenge mehr drin
  const wl = L.winLoss7d(gapSnaps(), W, "2026-07-20");
  assert.deepEqual(wl.a, { wins: 0, losses: 0, ties: 0 });
  assert.deepEqual(wl.b, { wins: 0, losses: 0, ties: 0 });
});

test("winLoss7d: leere Eingabe -> Nullen", () => {
  const wl = L.winLoss7d([], W);
  assert.deepEqual(wl.a, { wins: 0, losses: 0, ties: 0 });
  assert.deepEqual(wl.b, { wins: 0, losses: 0, ties: 0 });
});

// ---------------------------------------------------------------------------
// velocity7d: Follower-Zuwachs pro Tag ueber die letzten <= 7 Kalendertage
// ---------------------------------------------------------------------------

test("velocity7d: mittelt ueber echte Tagesabstaende im 7-Tage-Fenster", () => {
  // Fenster ab juengstem Snapshot (07-12): 07-06..07-12 -> Snapshots 07-09..07-12.
  // a: 171 -> 173 ueber 3 Tage = 2/3; b: 25 -> 26 ueber 3 Tage = 1/3.
  assert.ok(Math.abs(L.velocity7d(gapSnaps(), "a") - 2 / 3) < 1e-9);
  assert.ok(Math.abs(L.velocity7d(gapSnaps(), "b") - 1 / 3) < 1e-9);
});

test("velocity7d: weniger als 2 Snapshots im Fenster -> 0", () => {
  assert.equal(L.velocity7d([], "a"), 0);
  assert.equal(L.velocity7d(null, "a"), 0);
  assert.equal(L.velocity7d(gapSnaps().slice(0, 1), "a"), 0);
  // Nur der juengste Snapshot liegt im 7-Tage-Fenster, der andere 18 Tage davor -> 0
  const s = [gapSnaps()[0], gapSnaps()[1]];
  assert.equal(L.velocity7d(s, "a"), 0);
});

// ---------------------------------------------------------------------------
// milestoneProjection: naechstes rundes Ziel + ETA
// ---------------------------------------------------------------------------

test("milestoneProjection: naechstes rundes Ziel mit ETA aus velocity7d", () => {
  // a: Stand 173 -> Ziel 200; velocity 2/3 -> ceil(27 / (2/3)) = 41 Tage ab 2026-07-12
  const p = L.milestoneProjection(gapSnaps(), "a", "2026-07-12");
  assert.equal(p.target, 200);
  assert.equal(p.days, 41);
  assert.equal(p.etaDate, "2026-08-22");
  assert.ok(Math.abs(p.velocity - 2 / 3) < 1e-9);
  // b: Stand 26 -> Ziel 50; velocity 1/3 -> 72 Tage
  const q = L.milestoneProjection(gapSnaps(), "b", "2026-07-12");
  assert.equal(q.target, 50);
  assert.equal(q.days, 72);
  assert.equal(q.etaDate, "2026-09-22");
});

test("milestoneProjection: Ziel-Reihe 50/100/150/200/250/300/400/500/750/1000/1500/2000/...", () => {
  function withFollowers(n) {
    return [
      { date: "2026-07-11", a: { followers: n - 1, following: 1, likes: 1, videos: 1 }, b: { followers: 1, following: 1, likes: 1, videos: 1 } },
      { date: "2026-07-12", a: { followers: n, following: 1, likes: 1, videos: 1 }, b: { followers: 1, following: 1, likes: 1, videos: 1 } }
    ];
  }
  assert.equal(L.milestoneProjection(withFollowers(10), "a", "2026-07-12").target, 50);
  assert.equal(L.milestoneProjection(withFollowers(260), "a", "2026-07-12").target, 300);
  assert.equal(L.milestoneProjection(withFollowers(505), "a", "2026-07-12").target, 750);
  assert.equal(L.milestoneProjection(withFollowers(999), "a", "2026-07-12").target, 1000);
  // Ziel muss immer GROESSER als der aktuelle Stand sein
  assert.equal(L.milestoneProjection(withFollowers(1000), "a", "2026-07-12").target, 1500);
  assert.equal(L.milestoneProjection(withFollowers(2000), "a", "2026-07-12").target, 3000);
  // Reihe sinnvoll fortgesetzt ueber 2000 hinaus
  assert.equal(L.milestoneProjection(withFollowers(12000), "a", "2026-07-12").target, 15000);
});

test("milestoneProjection: Stillstand oder Verlust -> etaDate/days null", () => {
  const flach = [
    { date: "2026-07-11", a: { followers: 173, following: 1, likes: 1, videos: 1 }, b: { followers: 26, following: 1, likes: 1, videos: 1 } },
    { date: "2026-07-12", a: { followers: 173, following: 1, likes: 1, videos: 1 }, b: { followers: 26, following: 1, likes: 1, videos: 1 } }
  ];
  const p = L.milestoneProjection(flach, "a", "2026-07-12");
  assert.equal(p.target, 200);
  assert.equal(p.etaDate, null);
  assert.equal(p.days, null);
  assert.equal(p.velocity, 0);
});

test("milestoneProjection: leere Eingabe -> alles null, velocity 0", () => {
  const p = L.milestoneProjection([], "a", "2026-07-12");
  assert.deepEqual(p, { target: null, etaDate: null, days: null, velocity: 0 });
});

test("milestoneProjection: now optional (Fallback: Datum des juengsten Snapshots)", () => {
  const p = L.milestoneProjection(gapSnaps(), "a");
  assert.equal(p.etaDate, "2026-08-22");
});

// ---------------------------------------------------------------------------
// viewsGain: Views-Zuwachs aus viewsTotal (nie fehlend-als-0)
// ---------------------------------------------------------------------------

function viewsSnaps() {
  return [
    { date: "2026-07-11", a: { followers: 173, following: 460, likes: 55822, videos: 37, viewsTotal: 100000 }, b: { followers: 26, following: 33, likes: 1029, videos: 12, viewsTotal: 5000 } },
    { date: "2026-07-12", a: { followers: 173, following: 460, likes: 55870, videos: 38, viewsTotal: 101500 }, b: { followers: 26, following: 33, likes: 1030, videos: 12, viewsTotal: 5200 } }
  ];
}

test("viewsGain: juengster Views-Zuwachs beider Seiten inkl. perDay", () => {
  const v = L.viewsGain(viewsSnaps());
  assert.equal(v.hasResult, true);
  assert.equal(v.a, 1500);
  assert.equal(v.b, 200);
  assert.equal(v.spanDays, 1);
  assert.equal(v.perDayA, 1500);
  assert.equal(v.perDayB, 200);
});

test("viewsGain: Luecke -> perDay auf echten Tagesabstand normiert", () => {
  const snaps = viewsSnaps();
  snaps[0].date = "2026-07-10"; // Abstand 2 Tage
  const v = L.viewsGain(snaps);
  assert.equal(v.spanDays, 2);
  assert.equal(v.perDayA, 750);
  assert.equal(v.perDayB, 100);
});

test("viewsGain: fehlendes viewsTotal einer Seite -> diese Seite null, andere berechnet", () => {
  const snaps = viewsSnaps();
  delete snaps[0].a.viewsTotal; // alter Snapshot ohne viewsTotal fuer a
  const v = L.viewsGain(snaps);
  assert.equal(v.hasResult, true); // b ist weiterhin auswertbar
  assert.equal(v.a, null);
  assert.equal(v.perDayA, null);
  assert.equal(v.b, 200);
});

test("viewsGain: viewsTotal fehlt beidseitig (alte Snapshots) -> hasResult false", () => {
  const snaps = viewsSnaps();
  delete snaps[0].a.viewsTotal;
  delete snaps[1].a.viewsTotal;
  delete snaps[0].b.viewsTotal;
  delete snaps[1].b.viewsTotal;
  const v = L.viewsGain(snaps);
  assert.equal(v.hasResult, false);
  assert.equal(v.a, null);
  assert.equal(v.b, null);
});

test("viewsGain: viewsTotal 0 ist ein echter Wert, kein 'fehlt'", () => {
  const snaps = viewsSnaps();
  snaps[0].b.viewsTotal = 0;
  const v = L.viewsGain(snaps);
  assert.equal(v.b, 5200);
});

test("viewsGain: weniger als 2 Snapshots -> hasResult false", () => {
  assert.equal(L.viewsGain([]).hasResult, false);
  assert.equal(L.viewsGain(null).hasResult, false);
  assert.equal(L.viewsGain(viewsSnaps().slice(0, 1)).hasResult, false);
});

test("dailyRows: winner ist punktebasiert, nicht follower-basiert", () => {
  // a gewinnt Follower (+3F = 9 Punkte), b gewinnt nach Punkten (+2F/+2L/+2V = 12 Punkte)
  const snaps = [
    { date: "2026-07-11", a: { followers: 100, following: 1, likes: 10, videos: 5 }, b: { followers: 100, following: 1, likes: 10, videos: 5 } },
    { date: "2026-07-12", a: { followers: 103, following: 1, likes: 10, videos: 5 }, b: { followers: 102, following: 1, likes: 12, videos: 7 } }
  ];
  const rows = L.dailyRows(snaps, W);
  assert.equal(rows[0].deltaA.followers, 3);
  assert.equal(rows[0].winner, "b");
});

// ---------------------------------------------------------------------------
// Video-Funktionen (data/videos.json)
// ---------------------------------------------------------------------------

// Unix-Sekunden fuer ein UTC-Datum (12:00 mittags, damit keine Tagesgrenze wackelt).
function unix(y, m, d, h) {
  return Date.UTC(y, m - 1, d, h === undefined ? 12 : h, 0, 0) / 1000;
}

function video(createTime, views, extra) {
  return Object.assign({
    id: "v" + createTime, title: "Test", createTime: createTime, duration: 30,
    views: views, likes: 10, comments: 1, shares: 0, cover: "", isTop: false
  }, extra || {});
}

test("engagementRate: likes/views als Zahl 0..1", () => {
  assert.equal(L.engagementRate({ likes: 50, views: 1000 }), 0.05);
  assert.equal(L.engagementRate({ likes: 50, views: 0 }), 0);
  assert.equal(L.engagementRate({ likes: 50 }), 0); // views fehlt
  assert.equal(L.engagementRate(null), 0);
});

test("heatmapData: flaches chronologisches Array, Wochenstart Montag", () => {
  // 2026-07-12 ist ein Sonntag -> Montag der Woche ist 07-06; weeks=2 -> Start 06-29.
  const vids = {
    fetched: "2026-07-12",
    a: [video(unix(2026, 7, 10), 100), video(unix(2026, 7, 10), 200), video(unix(2026, 6, 30), 50), video(unix(2026, 6, 20), 999)],
    b: [video(unix(2026, 7, 12), 300)]
  };
  const days = L.heatmapData(vids, 2, "2026-07-12");
  assert.equal(days.length, 14);
  assert.equal(days[0].date, "2026-06-29");
  assert.equal(days[days.length - 1].date, "2026-07-12");
  const byDate = {};
  days.forEach(d => { byDate[d.date] = d; });
  assert.deepEqual(byDate["2026-07-10"], { date: "2026-07-10", a: 2, b: 0 });
  assert.deepEqual(byDate["2026-07-12"], { date: "2026-07-12", a: 0, b: 1 });
  assert.deepEqual(byDate["2026-06-30"], { date: "2026-06-30", a: 1, b: 0 });
  // Video vom 06-20 liegt vor dem Fenster -> taucht nirgends auf
  assert.equal(days.every(d => d.date !== "2026-06-20"), true);
});

test("heatmapData: endet mitten in der Woche bei today", () => {
  // 2026-07-08 ist ein Mittwoch -> weeks=1 ergibt Mo 07-06 bis Mi 07-08 (3 Tage)
  const days = L.heatmapData({ a: [], b: [] }, 1, "2026-07-08");
  assert.equal(days.length, 3);
  assert.equal(days[0].date, "2026-07-06");
  assert.equal(days[2].date, "2026-07-08");
});

test("heatmapData: fehlende/leere videos.json -> alle Tage mit 0", () => {
  const days = L.heatmapData(null, 2, "2026-07-12");
  assert.equal(days.length, 14);
  assert.ok(days.every(d => d.a === 0 && d.b === 0));
  const days2 = L.heatmapData({ a: [], b: [] }, 2, "2026-07-12");
  assert.ok(days2.every(d => d.a === 0 && d.b === 0));
});

test("topVideoOfWeek: meiste Views unter den in den letzten 7 Tagen geposteten Videos", () => {
  const vids = {
    fetched: "2026-07-12",
    a: [video(unix(2026, 7, 7), 900), video(unix(2026, 7, 10), 500), video(unix(2026, 6, 30), 99999)],
    b: [video(unix(2026, 7, 12), 700)]
  };
  const top = L.topVideoOfWeek(vids, "2026-07-12");
  assert.equal(top.side, "a");
  assert.equal(top.video.views, 900); // das alte 99999er-Video zaehlt nicht
});

test("topVideoOfWeek: Fenstergrenze — genau 6 Tage alt zaehlt noch, 7 nicht mehr", () => {
  const vids = { a: [video(unix(2026, 7, 6), 100)], b: [video(unix(2026, 7, 5), 500)] };
  const top = L.topVideoOfWeek(vids, "2026-07-12");
  assert.equal(top.side, "a"); // 07-05 ist 7 Tage her -> raus
});

test("topVideoOfWeek: nichts im Fenster oder keine Daten -> side/video null", () => {
  assert.deepEqual(L.topVideoOfWeek(null, "2026-07-12"), { side: null, video: null });
  assert.deepEqual(L.topVideoOfWeek({ a: [], b: [] }, "2026-07-12"), { side: null, video: null });
  const alt = { a: [video(unix(2026, 6, 1), 1000)], b: [] };
  assert.deepEqual(L.topVideoOfWeek(alt, "2026-07-12"), { side: null, video: null });
});

test("headToHead: neuestes Video je Seite nach createTime, isTop zaehlt nicht", () => {
  const gepinnt = video(unix(2026, 6, 1), 5000, { isTop: true });
  const neu = video(unix(2026, 7, 11), 120);
  const h = L.headToHead({ a: [gepinnt, neu], b: [video(unix(2026, 7, 9), 80)] });
  assert.equal(h.a.createTime, neu.createTime); // nicht das gepinnte
  assert.equal(h.b.views, 80);
});

test("headToHead: fehlende/leere videos.json -> null je Seite", () => {
  assert.deepEqual(L.headToHead(null), { a: null, b: null });
  assert.deepEqual(L.headToHead({ a: [], b: [] }), { a: null, b: null });
  const nurA = { a: [video(unix(2026, 7, 11), 10)], b: [] };
  const h = L.headToHead(nurA);
  assert.ok(h.a);
  assert.equal(h.b, null);
});

// ---------------------------------------------------------------------------
// spruchDesTages: deterministischer Tages-Roast
// ---------------------------------------------------------------------------

function plusDays(dateStr, n) {
  const t = Date.parse(dateStr + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const KONTEXT = { sieger: "Mika", verlierer: "Tino", punkte: "14:9" };

test("spruchDesTages: deterministisch — gleicher Tag, gleicher Spruch", () => {
  const s1 = L.spruchDesTages("2026-07-12", KONTEXT);
  const s2 = L.spruchDesTages("2026-07-12", KONTEXT);
  assert.equal(s1, s2);
  assert.ok(typeof s1 === "string" && s1.length > 0);
});

test("spruchDesTages: verschiedene Tage treffen verschiedene Templates", () => {
  const outputs = new Set();
  for (let i = 0; i < 120; i++) outputs.add(L.spruchDesTages(plusDays("2026-01-01", i), KONTEXT));
  assert.ok(outputs.size >= 8, "erwartet Vielfalt, bekam " + outputs.size);
});

test("spruchDesTages: alle Platzhalter ersetzt, Namen tauchen auf", () => {
  for (let i = 0; i < 120; i++) {
    const s = L.spruchDesTages(plusDays("2026-01-01", i), KONTEXT);
    assert.ok(!s.includes("{") && !s.includes("}"), "unersetzter Platzhalter in: " + s);
    assert.ok(s.includes("Mika") || s.includes("Tino"), "kein Name in: " + s);
  }
});

test("spruchDesTages: Pool exportiert, >= 30 Templates, nur bekannte Platzhalter", () => {
  assert.ok(Array.isArray(L.spruchPool.normal) && L.spruchPool.normal.length >= 30);
  assert.ok(Array.isArray(L.spruchPool.unentschieden) && L.spruchPool.unentschieden.length >= 3);
  const alle = L.spruchPool.normal.concat(L.spruchPool.unentschieden);
  for (const t of alle) {
    const rest = t.split("{sieger}").join("").split("{verlierer}").join("").split("{punkte}").join("");
    assert.ok(!rest.includes("{") && !rest.includes("}"), "unbekannter Platzhalter in: " + t);
  }
  // Jedes normale Template zieht den Sieger oder Verlierer auf
  for (const t of L.spruchPool.normal) {
    assert.ok(t.includes("{sieger}") || t.includes("{verlierer}"), "Template ohne Namen: " + t);
  }
});

test("spruchDesTages: Unentschieden nutzt eigene Template-Menge", () => {
  const kontext = { sieger: null, verlierer: null, punkte: "12:12", unentschieden: true };
  const s = L.spruchDesTages("2026-07-12", kontext);
  // Unentschieden-Templates verwenden nur {punkte} -> Ergebnis muss einem gerenderten
  // Tie-Template entsprechen und deterministisch sein.
  const gerendert = L.spruchPool.unentschieden.map(t => t.split("{punkte}").join("12:12"));
  assert.ok(gerendert.includes(s), "kein Tie-Template: " + s);
  assert.equal(s, L.spruchDesTages("2026-07-12", kontext));
  assert.ok(!s.includes("{"));
});

// ---------------------------------------------------------------------------
// outputFromSnapshots — Tagesoutput aus der videos-Zaehlung der Snapshots.
// Ersatzquelle fuer den Block-Chart, solange tikwm /api/user/posts blockt.
// ---------------------------------------------------------------------------

test("outputFromSnapshots: lueckenlose Tage -> Differenz je Seite", () => {
  const out = L.outputFromSnapshots(gapSnaps());
  // 11.07. -> 12.07.: A 37->38 = +1, B unveraendert
  assert.deepEqual(out["2026-07-12"], { a: 1, b: 0 });
  assert.deepEqual(out["2026-07-10"], { a: 0, b: 0 });
});

test("outputFromSnapshots: Luecke > 1 Tag ist keinem Tag zuordenbar -> kein Eintrag", () => {
  const out = L.outputFromSnapshots(gapSnaps());
  // 21.06. -> 09.07. sind 18 Tage: die +7 Videos lassen sich nicht attribuieren.
  assert.equal(out["2026-07-09"], undefined);
});

test("outputFromSnapshots: erster Snapshot hat keinen Vorgaenger -> kein Eintrag", () => {
  const out = L.outputFromSnapshots(gapSnaps());
  assert.equal(out["2026-06-21"], undefined);
});

test("outputFromSnapshots: geloeschte Videos ergeben keinen negativen Output", () => {
  const snaps = [
    { date: "2026-07-11", a: { followers: 1, following: 1, likes: 1, videos: 38 }, b: { followers: 1, following: 1, likes: 1, videos: 12 } },
    { date: "2026-07-12", a: { followers: 1, following: 1, likes: 1, videos: 35 }, b: { followers: 1, following: 1, likes: 1, videos: 12 } }
  ];
  // videos ist ein Bestand, keine Kumulation: -3 heisst geloescht, nicht "negativer Output".
  assert.deepEqual(L.outputFromSnapshots(snaps)["2026-07-12"], { a: 0, b: 0 });
});

test("outputFromSnapshots: leere oder einelementige Liste -> leeres Ergebnis", () => {
  assert.deepEqual(L.outputFromSnapshots([]), {});
  assert.deepEqual(L.outputFromSnapshots(null), {});
  assert.deepEqual(L.outputFromSnapshots([gapSnaps()[0]]), {});
});
