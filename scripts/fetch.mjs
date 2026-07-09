// Zieht einmal pro Lauf die aktuellen TikTok-Zahlen beider Creator von tikwm
// und haengt einen Schnappschuss an data/history.json an.
// Laeuft auf GitHub Actions (Node 20+, eingebautes fetch). Keine Anmeldung noetig.
//
// Die tikwm Free-API erlaubt nur 1 Request/Sekunde. Deshalb werden die beiden
// Creator NACHEINANDER abgefragt (mit Pause dazwischen), nicht parallel.
// Jeder Request hat ausserdem ein Timeout und wird bei vorübergehenden Fehlern
// (Rate-Limit, HTTP-Fehler, Netzwerkfehler) mehrfach wiederholt. Schlaegt ein
// Creator dauerhaft fehl (z. B. ungueltiger Handle), wird "fail-soft" reagiert:
// der letzte bekannte Snapshot-Wert wird uebernommen und als "stale" markiert,
// damit der taegliche Lauf nicht komplett scheitert.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data", "history.json");

const REQUEST_TIMEOUT_MS = 30_000;
const PAUSE_BETWEEN_CREATORS_MS = 1500;
const RETRY_DELAYS_MS = [2000, 5000]; // Pause vor Versuch 2 bzw. 3 (max. 3 Versuche)

const API = (handle) =>
  `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(handle)}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(json) {
  return json?.code === -1 && typeof json?.msg === "string" && json.msg.includes("Limit");
}

function isPermanentInvalid(json) {
  return (
    json?.code === -1 &&
    typeof json?.msg === "string" &&
    json.msg.toLowerCase().includes("unique_id is invalid")
  );
}

// Wirft PermanentError bei dauerhaften Fehlern (z. B. ungueltiger Handle),
// die NICHT erneut versucht werden sollen.
class PermanentError extends Error {}

async function fetchOnce(handle) {
  const res = await fetch(API(handle), {
    headers: { "User-Agent": "Mozilla/5.0 (duell-tracker)" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fuer ${handle}`);
  }

  const json = await res.json();

  if (isPermanentInvalid(json)) {
    throw new PermanentError(`Handle "${handle}" ist ungueltig (tikwm: "${json.msg}")`);
  }

  if (json.code !== 0 || !json.data?.stats) {
    const msg = `Unerwartete Antwort fuer ${handle}: ${JSON.stringify(json).slice(0, 200)}`;
    if (isRateLimit(json)) {
      throw new Error(`Rate-Limit fuer ${handle}: ${json.msg}`);
    }
    throw new Error(msg);
  }

  const s = json.data.stats;
  return {
    followers: s.followerCount,
    following: s.followingCount,
    likes: s.heartCount,
    videos: s.videoCount
  };
}

// Bis zu 3 Versuche mit Backoff. Bei permanenten Fehlern (ungueltiger Handle)
// wird sofort abgebrochen, ohne erneut zu versuchen.
async function pullWithRetry(handle) {
  const maxAttempts = 1 + RETRY_DELAYS_MS.length;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchOnce(handle);
    } catch (err) {
      if (err instanceof PermanentError) {
        throw err;
      }

      const isLastAttempt = attempt === maxAttempts;
      console.warn(
        `Warnung: Versuch ${attempt}/${maxAttempts} fuer "${handle}" fehlgeschlagen: ${err.message}`
      );

      if (isLastAttempt) {
        throw err;
      }

      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.log(`Warte ${delay}ms vor erneutem Versuch fuer "${handle}"...`);
      await sleep(delay);
    }
  }

  // Sollte nie erreicht werden.
  throw new Error(`Alle Versuche fuer "${handle}" fehlgeschlagen.`);
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function lastSnapshotValue(db, key) {
  const sorted = [...db.snapshots].sort((x, y) => x.date.localeCompare(y.date));
  const last = sorted[sorted.length - 1];
  return last ? last[key] : undefined;
}

async function main() {
  const db = JSON.parse(await readFile(DATA, "utf8"));
  const date = today();

  if (db.snapshots.some((s) => s.date === date)) {
    console.log(`Schnappschuss fuer heute (${date}) existiert schon - nichts zu tun.`);
    return;
  }

  const handleA = db.creators.a.handle;
  const handleB = db.creators.b.handle;

  console.log(`Ziehe Zahlen fuer Creator A ("${handleA}")...`);
  let resultA;
  let errorA;
  try {
    resultA = await pullWithRetry(handleA);
    console.log(`Creator A ("${handleA}") erfolgreich abgerufen: ${resultA.followers} Follower.`);
  } catch (err) {
    errorA = err;
    console.error(`FEHLER bei Creator A ("${handleA}"): ${err.message}`);
  }

  console.log(`Warte ${PAUSE_BETWEEN_CREATORS_MS}ms, um das Rate-Limit der tikwm-API einzuhalten...`);
  await sleep(PAUSE_BETWEEN_CREATORS_MS);

  console.log(`Ziehe Zahlen fuer Creator B ("${handleB}")...`);
  let resultB;
  let errorB;
  try {
    resultB = await pullWithRetry(handleB);
    console.log(`Creator B ("${handleB}") erfolgreich abgerufen: ${resultB.followers} Follower.`);
  } catch (err) {
    errorB = err;
    console.error(`FEHLER bei Creator B ("${handleB}"): ${err.message}`);
  }

  const stale = [];

  if (errorA) {
    const fallback = lastSnapshotValue(db, "a");
    if (!fallback) {
      console.error(
        `Abbruch: Creator A ("${handleA}") konnte nicht abgerufen werden und es gibt keinen frueheren Schnappschuss als Ersatz.`
      );
      process.exit(1);
    }
    console.warn(
      `WARNUNG: Verwende fuer Creator A ("${handleA}") die Werte des letzten Schnappschusses, da der aktuelle Abruf fehlgeschlagen ist (${errorA.message}).`
    );
    resultA = fallback;
    stale.push("a");
  }

  if (errorB) {
    const fallback = lastSnapshotValue(db, "b");
    if (!fallback) {
      console.error(
        `Abbruch: Creator B ("${handleB}") konnte nicht abgerufen werden und es gibt keinen frueheren Schnappschuss als Ersatz.`
      );
      process.exit(1);
    }
    console.warn(
      `WARNUNG: Verwende fuer Creator B ("${handleB}") die Werte des letzten Schnappschusses, da der aktuelle Abruf fehlgeschlagen ist (${errorB.message}).`
    );
    resultB = fallback;
    stale.push("b");
  }

  if (errorA && errorB) {
    console.error("Abbruch: Beide Creator konnten nicht abgerufen werden.");
    process.exit(1);
  }

  const snapshot = { date, a: resultA, b: resultB };
  if (stale.length > 0) {
    snapshot.stale = stale;
  }

  db.snapshots.push(snapshot);
  db.snapshots.sort((x, y) => x.date.localeCompare(y.date));

  await writeFile(DATA, JSON.stringify(db, null, 2) + "\n");

  if (stale.length > 0) {
    console.log(
      `Schnappschuss ${date} gespeichert (mit veralteten Werten fuer: ${stale.join(", ")}): A ${resultA.followers} Follower, B ${resultB.followers} Follower.`
    );
  } else {
    console.log(`Schnappschuss ${date} gespeichert: A ${resultA.followers} Follower, B ${resultB.followers} Follower.`);
  }
}

main().catch((err) => {
  console.error("Unerwarteter Fehler:", err.message);
  process.exit(1);
});
