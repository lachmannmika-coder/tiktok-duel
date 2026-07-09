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

test("dailyRows: eine Zeile pro Uebergang, neueste zuerst, mit Tagessieger", () => {
  const db = load("02_seven_days.json");
  const rows = L.dailyRows(db.snapshots);
  assert.equal(rows.length, 6);
  // Neueste zuerst: letzter Uebergang ist 06-20 -> 06-21
  assert.equal(rows[0].date, "2026-06-21");
  assert.equal(rows[rows.length - 1].date, "2026-06-16");
  // Uebergang 06-20->06-21: a +1, b +5 -> Tino gewinnt
  assert.equal(rows[0].deltaA.followers, 1);
  assert.equal(rows[0].deltaB.followers, 5);
  assert.equal(rows[0].winner, "b");
});

test("dailyRows: weniger als 2 Snapshots -> leere Liste", () => {
  const db = load("01_single.json");
  assert.deepEqual(L.dailyRows(db.snapshots), []);
});

test("dailyRows: Gleichstand im Tageszuwachs -> kein Sieger", () => {
  const snaps = [
    { date: "2026-06-20", a: { followers: 100, following: 1, likes: 1, videos: 1 }, b: { followers: 100, following: 1, likes: 1, videos: 1 } },
    { date: "2026-06-21", a: { followers: 105, following: 1, likes: 1, videos: 1 }, b: { followers: 105, following: 1, likes: 1, videos: 1 } }
  ];
  const rows = L.dailyRows(snaps);
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
