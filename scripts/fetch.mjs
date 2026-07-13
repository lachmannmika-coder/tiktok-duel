// Zieht einmal pro Lauf die aktuellen TikTok-Zahlen beider Creator von tikwm
// und haengt einen Schnappschuss an data/history.json an. Zusaetzlich wird die
// Videoliste beider Creator (paginiert, max. 200 pro Creator) nach
// data/videos.json geschrieben und die Avatare landen in assets/avatars/.
// Laeuft auf GitHub Actions (Node 20+, eingebautes fetch). Keine Anmeldung noetig.
//
// Die tikwm Free-API erlaubt nur 1 Request/Sekunde. Deshalb laufen ALLE
// Requests (Profile, Video-Seiten, beide Creator) NACHEINANDER mit Pause
// dazwischen, nie parallel. Jeder Request hat ausserdem ein Timeout und wird
// bei voruebergehenden Fehlern (Rate-Limit, HTTP-Fehler, Netzwerkfehler)
// mehrfach wiederholt. Schlaegt ein Creator dauerhaft fehl (z. B. ungueltiger
// Handle), wird "fail-soft" reagiert: der letzte bekannte Snapshot-Wert wird
// uebernommen und als "stale" markiert, damit der taegliche Lauf nicht
// komplett scheitert. Gleiches Prinzip fuer die Videoliste: schlaegt sie fehl,
// bleibt die letzte bekannte Liste erhalten und viewsTotal wird weggelassen.
//
// Aufruf:
//   node scripts/fetch.mjs            -> normaler Lauf (schreibt Dateien)
//   node scripts/fetch.mjs --dry-run  -> echte API-Abfragen, aber es wird
//                                        garantiert NICHTS geschrieben

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DATA = join(__dirname, "..", "data", "history.json");
const VIDEOS_DATA = join(__dirname, "..", "data", "videos.json");
const AVATAR_DIR = join(__dirname, "..", "assets", "avatars");

export const REQUEST_TIMEOUT_MS = 30_000;
export const PAUSE_BETWEEN_REQUESTS_MS = 1500; // tikwm Free-Limit: ~1 Request/Sekunde
export const RETRY_DELAYS_MS = [2000, 5000]; // Pause vor Versuch 2 bzw. 3 (max. 3 Versuche)
export const MAX_VIDEOS_PER_CREATOR = 200;
const POSTS_PAGE_SIZE = 35;

const UA_HEADERS = { "User-Agent": "Mozilla/5.0 (duell-tracker)" };

const API_USER_INFO = (handle) =>
  `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(handle)}`;

const API_USER_POSTS = (handle, cursor) =>
  `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=${POSTS_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimit(json) {
  return json?.code === -1 && typeof json?.msg === "string" && json.msg.includes("Limit");
}

export function isPermanentInvalid(json) {
  return (
    json?.code === -1 &&
    typeof json?.msg === "string" &&
    json.msg.toLowerCase().includes("unique_id is invalid")
  );
}

// Wirft PermanentError bei dauerhaften Fehlern (z. B. ungueltiger Handle),
// die NICHT erneut versucht werden sollen.
export class PermanentError extends Error {}

// Einzelner tikwm-Request inkl. Timeout und Auswertung der Antwort-Huelle
// ({ code, msg, data }). Gibt bei Erfolg json.data zurueck.
async function requestJson(url, label, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: UA_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fuer ${label}`);
  }

  const json = await res.json();

  if (isPermanentInvalid(json)) {
    throw new PermanentError(`Handle bei "${label}" ist ungueltig (tikwm: "${json.msg}")`);
  }

  if (json.code !== 0 || !json.data) {
    if (isRateLimit(json)) {
      throw new Error(`Rate-Limit fuer ${label}: ${json.msg}`);
    }
    throw new Error(`Unerwartete Antwort fuer ${label}: ${JSON.stringify(json).slice(0, 200)}`);
  }

  return json.data;
}

// Bis zu 3 Versuche mit Backoff. Bei permanenten Fehlern (ungueltiger Handle)
// wird sofort abgebrochen, ohne erneut zu versuchen.
export async function withRetry(fn, label, { sleepImpl = sleep, retryDelays = RETRY_DELAYS_MS } = {}) {
  const maxAttempts = 1 + retryDelays.length;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PermanentError) {
        throw err;
      }

      const isLastAttempt = attempt === maxAttempts;
      console.warn(
        `Warnung: Versuch ${attempt}/${maxAttempts} fuer "${label}" fehlgeschlagen: ${err.message}`
      );

      if (isLastAttempt) {
        throw err;
      }

      const delay = retryDelays[attempt - 1];
      console.log(`Warte ${delay}ms vor erneutem Versuch fuer "${label}"...`);
      await sleepImpl(delay);
    }
  }

  // Sollte nie erreicht werden.
  throw new Error(`Alle Versuche fuer "${label}" fehlgeschlagen.`);
}

// Profil eines Creators abrufen (user/info). Liefert die Snapshot-Felder
// plus die Avatar-URL (die URL laeuft nach ~1 Tag ab, daher laden wir das
// Bild bei jedem Lauf frisch herunter).
export async function fetchProfile(handle, { fetchImpl = fetch } = {}) {
  const data = await requestJson(API_USER_INFO(handle), handle, fetchImpl);

  if (!data.stats) {
    throw new Error(`Unerwartete Antwort fuer ${handle}: stats fehlen`);
  }

  const s = data.stats;
  return {
    followers: s.followerCount,
    following: s.followingCount,
    likes: s.heartCount,
    videos: s.videoCount,
    avatarUrl: data.user?.avatarThumb || null
  };
}

// Mapping eines rohen tikwm-Videos auf unser videos.json-Schema.
export function mapVideo(v) {
  return {
    id: v.video_id,
    title: v.title,
    createTime: v.create_time, // Unix-Sekunden, bewusst als Zahl belassen
    duration: v.duration,
    views: v.play_count,
    likes: v.digg_count,
    comments: v.comment_count,
    shares: v.share_count,
    cover: v.cover,
    isTop: Boolean(v.is_top)
  };
}

// Summe der Views ueber alle geholten Videos (Basis fuer viewsTotal).
export function sumViews(videos) {
  return videos.reduce((sum, v) => sum + (typeof v.views === "number" ? v.views : 0), 0);
}

// Komplette Videoliste eines Creators holen (user/posts, paginiert bis
// hasMore=false, gedeckelt auf `cap` Videos). Jede Seite laeuft mit Retry;
// zwischen den Seiten wird pausiert (tikwm-Rate-Limit). fetchImpl/sleepImpl
// sind injizierbar, damit die Pagination-Logik ohne Netz testbar ist.
// Schlaegt eine Seite trotz Retries fehl, wirft die Funktion - der Aufrufer
// behandelt das fail-soft (letzte bekannte Liste, viewsTotal weglassen).
export async function fetchAllVideos(handle, {
  fetchImpl = fetch,
  sleepImpl = sleep,
  cap = MAX_VIDEOS_PER_CREATOR,
  pauseMs = PAUSE_BETWEEN_REQUESTS_MS,
  retryDelays = RETRY_DELAYS_MS
} = {}) {
  const videos = [];
  let cursor = 0;
  let page = 1;

  for (;;) {
    const label = `${handle} (Videos, Seite ${page})`;
    const data = await withRetry(
      () => requestJson(API_USER_POSTS(handle, cursor), label, fetchImpl),
      label,
      { sleepImpl, retryDelays }
    );

    const rawVideos = Array.isArray(data.videos) ? data.videos : [];
    for (const v of rawVideos) {
      if (videos.length >= cap) break;
      videos.push(mapVideo(v));
    }

    if (!data.hasMore || videos.length >= cap || rawVideos.length === 0) {
      break;
    }

    cursor = data.cursor;
    page += 1;
    await sleepImpl(pauseMs); // Pause auch zwischen Pagination-Seiten
  }

  return videos;
}

// Avatar-Bild herunterladen und speichern. Legt den Zielordner bei Bedarf an.
async function downloadAvatar(url, targetPath, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    headers: UA_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} beim Avatar-Download`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new Error("Avatar-Antwort ist leer");
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buf);
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
  const dryRun = process.argv.includes("--dry-run");

  const db = JSON.parse(await readFile(HISTORY_DATA, "utf8"));
  const date = today();

  if (dryRun) {
    console.log("DRY-RUN: Echte API-Abfragen, aber es wird garantiert NICHTS geschrieben.");
  } else if (db.snapshots.some((s) => s.date === date)) {
    console.log(`Schnappschuss fuer heute (${date}) existiert schon - nichts zu tun.`);
    return;
  }

  // Letzte bekannte Videoliste als fail-soft-Ersatz laden (falls vorhanden).
  let previousVideos = null;
  try {
    previousVideos = JSON.parse(await readFile(VIDEOS_DATA, "utf8"));
  } catch {
    previousVideos = null; // noch keine videos.json vorhanden - ok
  }

  const sides = ["a", "b"];
  const profiles = {};
  const profileErrors = {};
  const videoLists = {};
  const videoErrors = {};

  for (let i = 0; i < sides.length; i++) {
    const key = sides[i];
    const handle = db.creators[key].handle;
    const label = `Creator ${key.toUpperCase()} ("${handle}")`;

    console.log(`Ziehe Profil fuer ${label}...`);
    try {
      profiles[key] = await withRetry(() => fetchProfile(handle), handle);
      console.log(`${label} erfolgreich abgerufen: ${profiles[key].followers} Follower.`);
    } catch (err) {
      profileErrors[key] = err;
      console.error(`FEHLER bei ${label}: ${err.message}`);
    }

    console.log(`Warte ${PAUSE_BETWEEN_REQUESTS_MS}ms (tikwm-Rate-Limit)...`);
    await sleep(PAUSE_BETWEEN_REQUESTS_MS);

    if (profileErrors[key] instanceof PermanentError) {
      // Ungueltiger Handle: Videoliste gar nicht erst versuchen.
      videoErrors[key] = new Error("Videoliste uebersprungen, da der Handle ungueltig ist");
      console.warn(`WARNUNG: ${videoErrors[key].message} (${label}).`);
    } else {
      console.log(`Ziehe Videoliste fuer ${label} (max. ${MAX_VIDEOS_PER_CREATOR} Videos)...`);
      try {
        videoLists[key] = await fetchAllVideos(handle);
        console.log(`${label}: ${videoLists[key].length} Videos geholt.`);
      } catch (err) {
        videoErrors[key] = err;
        console.warn(`WARNUNG: Videoliste fuer ${label} konnte nicht geladen werden: ${err.message}`);
      }
    }

    if (i < sides.length - 1) {
      console.log(`Warte ${PAUSE_BETWEEN_REQUESTS_MS}ms (tikwm-Rate-Limit)...`);
      await sleep(PAUSE_BETWEEN_REQUESTS_MS);
    }
  }

  if (dryRun) {
    console.log("");
    console.log("--- DRY-RUN Zusammenfassung ---");
    for (const key of sides) {
      const handle = db.creators[key].handle;
      console.log(`Creator ${key.toUpperCase()} ("${handle}"):`);
      const p = profiles[key];
      if (p) {
        console.log(`  Follower: ${p.followers} | Likes: ${p.likes} | Videos (Profil): ${p.videos}`);
        console.log(`  Avatar-URL vorhanden: ${p.avatarUrl ? "ja" : "nein"}`);
      } else {
        console.log(`  Profil FEHLGESCHLAGEN: ${profileErrors[key].message}`);
      }
      const v = videoLists[key];
      if (v) {
        console.log(`  Geholte Videos: ${v.length} | viewsTotal: ${sumViews(v)}`);
      } else {
        console.log(`  Videoliste FEHLGESCHLAGEN: ${videoErrors[key].message}`);
      }
    }
    console.log("DRY-RUN beendet - es wurde nichts geschrieben.");
    return;
  }

  if (profileErrors.a && profileErrors.b) {
    console.error("Abbruch: Beide Creator konnten nicht abgerufen werden.");
    process.exit(1);
  }

  // Profil fail-soft: bei Fehler den letzten Snapshot-Wert uebernehmen und
  // als "stale" markieren. viewsTotal wird nur bei ERFOLGREICHEM posts-Abruf
  // frisch gesetzt - bei Fehlschlag wird das Feld bewusst weggelassen
  // (niemals 0 schreiben).
  const stale = [];
  const snapshotValues = {};

  for (const key of sides) {
    const handle = db.creators[key].handle;
    if (profileErrors[key]) {
      const fallback = lastSnapshotValue(db, key);
      if (!fallback) {
        console.error(
          `Abbruch: Creator ${key.toUpperCase()} ("${handle}") konnte nicht abgerufen werden und es gibt keinen frueheren Schnappschuss als Ersatz.`
        );
        process.exit(1);
      }
      console.warn(
        `WARNUNG: Verwende fuer Creator ${key.toUpperCase()} ("${handle}") die Werte des letzten Schnappschusses, da der aktuelle Abruf fehlgeschlagen ist (${profileErrors[key].message}).`
      );
      snapshotValues[key] = { ...fallback };
      stale.push(key);
    } else {
      const p = profiles[key];
      snapshotValues[key] = {
        followers: p.followers,
        following: p.following,
        likes: p.likes,
        videos: p.videos
      };
      if (videoLists[key]) {
        snapshotValues[key].viewsTotal = sumViews(videoLists[key]);
      }
    }
  }

  const snapshot = { date, a: snapshotValues.a, b: snapshotValues.b };
  if (stale.length > 0) {
    snapshot.stale = stale;
  }

  db.snapshots.push(snapshot);
  db.snapshots.sort((x, y) => x.date.localeCompare(y.date));

  await writeFile(HISTORY_DATA, JSON.stringify(db, null, 2) + "\n");

  if (stale.length > 0) {
    console.log(
      `Schnappschuss ${date} gespeichert (mit veralteten Werten fuer: ${stale.join(", ")}): A ${snapshotValues.a.followers} Follower, B ${snapshotValues.b.followers} Follower.`
    );
  } else {
    console.log(
      `Schnappschuss ${date} gespeichert: A ${snapshotValues.a.followers} Follower, B ${snapshotValues.b.followers} Follower.`
    );
  }

  // videos.json schreiben - fail-soft: bei Fehlschlag die letzte bekannte
  // Liste behalten (falls vorhanden), sonst leeres Array.
  const videosOut = { fetched: date };
  for (const key of sides) {
    if (videoLists[key]) {
      videosOut[key] = videoLists[key];
    } else {
      const fallbackList =
        previousVideos && Array.isArray(previousVideos[key]) ? previousVideos[key] : [];
      console.warn(
        `WARNUNG: Fuer Creator ${key.toUpperCase()} wird ${fallbackList.length > 0 ? "die letzte bekannte Videoliste" : "eine leere Videoliste"} nach videos.json geschrieben.`
      );
      videosOut[key] = fallbackList;
    }
  }

  await writeFile(VIDEOS_DATA, JSON.stringify(videosOut, null, 2) + "\n");
  console.log(
    `videos.json gespeichert: A ${videosOut.a.length} Videos, B ${videosOut.b.length} Videos.`
  );

  // Avatare herunterladen - Fehlschlag ist nur eine Warnung, die alte Datei
  // bleibt dann erhalten.
  for (const key of sides) {
    const avatarUrl = profiles[key]?.avatarUrl;
    if (!avatarUrl) {
      console.warn(
        `WARNUNG: Keine Avatar-URL fuer Creator ${key.toUpperCase()} - alte Datei bleibt erhalten.`
      );
      continue;
    }
    const target = join(AVATAR_DIR, `${key}.jpg`);
    try {
      await withRetry(() => downloadAvatar(avatarUrl, target), `Avatar ${key.toUpperCase()}`);
      console.log(`Avatar fuer Creator ${key.toUpperCase()} gespeichert (assets/avatars/${key}.jpg).`);
    } catch (err) {
      console.warn(
        `WARNUNG: Avatar fuer Creator ${key.toUpperCase()} konnte nicht geladen werden: ${err.message} - alte Datei bleibt erhalten.`
      );
    }
  }
}

// main() nur ausfuehren, wenn das Skript direkt gestartet wird - beim Import
// (z. B. aus den Tests) laufen keine Abfragen und es wird nichts geschrieben.
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error("Unerwarteter Fehler:", err.message);
    process.exit(1);
  });
}
