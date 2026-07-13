// Fixture-basierte Tests fuer die Daten-Pipeline (scripts/fetch.mjs).
// Kein einziger echter Netzwerk-Request: fetchImpl/sleepImpl werden injiziert.
// Laeuft mit `node --test` (ESM, da fetch.mjs ein ES-Modul ist).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  mapVideo,
  sumViews,
  fetchAllVideos,
  fetchProfile,
  withRetry,
  isRateLimit,
  isPermanentInvalid,
  PermanentError,
  MAX_VIDEOS_PER_CREATOR
} from "../scripts/fetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
}

// Baut ein fetch-Double, das Antworten der Reihe nach liefert.
// Jede Antwort ist entweder ein Fixture-JSON (ok:200) oder { httpStatus } fuer Fehler.
function fakeFetch(responses) {
  let call = 0;
  const urls = [];
  const impl = async (url) => {
    urls.push(url);
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    if (r.httpStatus) {
      return { ok: false, status: r.httpStatus, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => r };
  };
  impl.urls = urls;
  impl.calls = () => call;
  return impl;
}

const noSleep = async () => {};

// ---- Antwort-Erkennung ----

test("isRateLimit erkennt die tikwm-Rate-Limit-Antwort", () => {
  assert.equal(isRateLimit(fixture("tikwm_rate_limit.json")), true);
  assert.equal(isRateLimit(fixture("tikwm_posts_leer.json")), false);
});

test("isPermanentInvalid erkennt einen ungueltigen Handle", () => {
  assert.equal(isPermanentInvalid(fixture("tikwm_invalid_handle.json")), true);
  assert.equal(isPermanentInvalid(fixture("tikwm_rate_limit.json")), false);
});

// ---- Video-Mapping ----

test("mapVideo bildet alle tikwm-Felder auf das videos.json-Schema ab", () => {
  const raw = fixture("tikwm_posts_seite1.json").data.videos[0];
  const v = mapVideo(raw);
  assert.deepEqual(v, {
    id: raw.video_id,
    title: raw.title,
    createTime: raw.create_time,
    duration: raw.duration,
    views: raw.play_count,
    likes: raw.digg_count,
    comments: raw.comment_count,
    shares: raw.share_count,
    cover: raw.cover,
    isTop: Boolean(raw.is_top)
  });
  assert.equal(typeof v.createTime, "number", "createTime bleibt Unix-Sekunden-Zahl");
});

test("sumViews summiert die Views; nicht-numerische Werte zaehlen 0", () => {
  assert.equal(sumViews([{ views: 100 }, { views: 250 }, { views: null }]), 350);
  assert.equal(sumViews([]), 0);
});

// ---- Profil ----

test("fetchProfile mappt stats und liefert die Avatar-URL mit", async () => {
  const fx = fixture("tikwm_user_info_a.json");
  const p = await fetchProfile("mika.nature.enjoyer", { fetchImpl: fakeFetch([fx]) });
  assert.equal(p.followers, fx.data.stats.followerCount);
  assert.equal(p.following, fx.data.stats.followingCount);
  assert.equal(p.likes, fx.data.stats.heartCount);
  assert.equal(p.videos, fx.data.stats.videoCount);
  assert.equal(p.avatarUrl, fx.data.user.avatarThumb);
});

test("fetchProfile wirft PermanentError bei ungueltigem Handle", async () => {
  const impl = fakeFetch([fixture("tikwm_invalid_handle.json")]);
  await assert.rejects(
    () => fetchProfile("gibtsnicht", { fetchImpl: impl }),
    PermanentError
  );
});

// ---- Pagination ----

test("fetchAllVideos laedt alle Seiten bis hasMore=false und mappt die Videos", async () => {
  const impl = fakeFetch([
    fixture("tikwm_posts_seite1.json"),
    fixture("tikwm_posts_seite2.json")
  ]);
  const videos = await fetchAllVideos("mika.nature.enjoyer", {
    fetchImpl: impl, sleepImpl: noSleep
  });
  assert.equal(videos.length, 5, "3 Videos von Seite 1 + 2 von Seite 2");
  assert.equal(impl.calls(), 2, "genau zwei Requests");
  // Zweiter Request muss den Cursor der ersten Seite tragen.
  const cursor1 = fixture("tikwm_posts_seite1.json").data.cursor;
  assert.ok(impl.urls[1].includes(`cursor=${cursor1}`), "Cursor der Seite 1 wird weitergereicht");
  // Alle Eintraege sind gemappt (id statt video_id).
  for (const v of videos) {
    assert.ok(v.id && !("video_id" in v));
  }
});

test("fetchAllVideos respektiert den Cap und fragt danach keine weitere Seite an", async () => {
  const impl = fakeFetch([
    fixture("tikwm_posts_seite1.json"), // 3 Videos, hasMore:true
    fixture("tikwm_posts_seite2.json")
  ]);
  const videos = await fetchAllVideos("mika.nature.enjoyer", {
    fetchImpl: impl, sleepImpl: noSleep, cap: 2
  });
  assert.equal(videos.length, 2);
  assert.equal(impl.calls(), 1, "nach Erreichen des Caps keine zweite Seite");
});

test("fetchAllVideos: leere Videoliste -> leeres Array, ein Request", async () => {
  const impl = fakeFetch([fixture("tikwm_posts_leer.json")]);
  const videos = await fetchAllVideos("tego..11", { fetchImpl: impl, sleepImpl: noSleep });
  assert.deepEqual(videos, []);
  assert.equal(impl.calls(), 1);
});

test("fetchAllVideos: Rate-Limit wird wiederholt und gelingt beim zweiten Versuch", async () => {
  const impl = fakeFetch([
    fixture("tikwm_rate_limit.json"),
    fixture("tikwm_posts_leer.json")
  ]);
  const videos = await fetchAllVideos("tego..11", {
    fetchImpl: impl, sleepImpl: noSleep, retryDelays: [1]
  });
  assert.deepEqual(videos, []);
  assert.equal(impl.calls(), 2, "erster Versuch Rate-Limit, zweiter Erfolg");
});

test("fetchAllVideos: dauerhafte HTTP-Fehler erschoepfen die Versuche und werfen", async () => {
  const impl = fakeFetch([{ httpStatus: 500 }]);
  await assert.rejects(
    () => fetchAllVideos("tego..11", {
      fetchImpl: impl, sleepImpl: noSleep, retryDelays: [1, 1]
    }),
    /HTTP 500/
  );
  assert.equal(impl.calls(), 3, "3 Versuche (1 + 2 Retries)");
});

test("fetchAllVideos: ungueltiger Handle bricht sofort ab (kein Retry)", async () => {
  const impl = fakeFetch([fixture("tikwm_invalid_handle.json")]);
  await assert.rejects(
    () => fetchAllVideos("gibtsnicht", { fetchImpl: impl, sleepImpl: noSleep }),
    PermanentError
  );
  assert.equal(impl.calls(), 1);
});

// ---- Retry-Helfer ----

test("withRetry gibt beim ersten Erfolg sofort zurueck", async () => {
  let n = 0;
  const out = await withRetry(async () => { n++; return 42; }, "x", { sleepImpl: noSleep });
  assert.equal(out, 42);
  assert.equal(n, 1);
});

test("withRetry wirft nach Erschoepfung aller Versuche den letzten Fehler", async () => {
  let n = 0;
  await assert.rejects(
    () => withRetry(async () => { n++; throw new Error("kaputt"); }, "x", {
      sleepImpl: noSleep, retryDelays: [1, 1]
    }),
    /kaputt/
  );
  assert.equal(n, 3);
});

// ---- Konstanten-Vertrag ----

test("Cap fuer Videos pro Creator ist 200", () => {
  assert.equal(MAX_VIDEOS_PER_CREATOR, 200);
});
