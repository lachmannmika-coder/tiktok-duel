// Zieht einmal pro Lauf die aktuellen TikTok-Zahlen beider Creator von tikwm
// und hängt einen Schnappschuss an data/history.json an.
// Laeuft auf GitHub Actions (Node 20+, eingebautes fetch). Keine Anmeldung noetig.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data", "history.json");

const API = (handle) =>
  `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(handle)}`;

async function pull(handle) {
  const res = await fetch(API(handle), {
    headers: { "User-Agent": "Mozilla/5.0 (duell-tracker)" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fuer ${handle}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data?.stats) {
    throw new Error(`Unerwartete Antwort fuer ${handle}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  const s = json.data.stats;
  return {
    followers: s.followerCount,
    following: s.followingCount,
    likes: s.heartCount,
    videos: s.videoCount
  };
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function main() {
  const db = JSON.parse(await readFile(DATA, "utf8"));
  const date = today();

  if (db.snapshots.some((s) => s.date === date)) {
    console.log(`Schnappschuss fuer ${date} existiert schon - nichts zu tun.`);
    return;
  }

  const [a, b] = await Promise.all([
    pull(db.creators.a.handle),
    pull(db.creators.b.handle)
  ]);

  db.snapshots.push({ date, a, b });
  db.snapshots.sort((x, y) => x.date.localeCompare(y.date));

  await writeFile(DATA, JSON.stringify(db, null, 2) + "\n");
  console.log(`Schnappschuss ${date} gespeichert: A ${a.followers} Follower, B ${b.followers} Follower.`);
}

main().catch((err) => {
  console.error("Fehler:", err.message);
  process.exit(1);
});
