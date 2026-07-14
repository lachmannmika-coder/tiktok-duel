# PROGRESS — Rebuild Duell-Dashboard

Orchestrierter Komplett-Rebuild (Arena-Design, Punkte-Score, Video-Battle, Pipeline v2).
Bei Session-Abbruch: hier weiterlesen, Phasen strikt in Reihenfolge, Gate von Phase N
selbst prüfen bevor N+1 startet. Referenz-Spezifikation: der Orchestrator-Prompt
(P0-1…P0-8, P1-1…P1-4, P2-1/P2-2, Design-Brief „Arena").

## Phasenstatus

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Setup, Tests grün, Skill-Inventur, package.json bereinigt | ✅ erledigt |
| 1 | Daten-Pipeline v2 (P0-8: posts, videos.json, viewsTotal, Avatare, --dry-run, Fixtures) | ✅ erledigt |
| 2 | Logik TDD (score, dayWinner datums-bewusst, streak, winLoss7d, velocity, milestone, heatmap, topVideo, headToHead, spruch, dailyRows/dayGains neu) | ✅ erledigt |
| 3 | Design-System & Gerüst (Token-CSS, index.html-Skelett, Skeletons, responsive) + Design-Review ≥8 | ✅ erledigt |
| 4a | UI-Verkabelung: Hero, KPIs, Charts, Meilensteine | ⬜ offen |
| 4b | UI-Verkabelung: Video-Battle, Heatmap, Spruch, Historie | ⬜ offen |
| 5 | Motion & Polish, PWA/Meta | ⬜ offen |
| 6 | QA & Abschluss-Review (≥8/10, Fix-Loops max. 3) | ⬜ offen |
| Abschluss | PROGRESS final, lokale Commits, KEIN Push, Nachricht an Mika | ⬜ offen |

## Phase-0-Befunde

- `npm test`: 25/25 grün (Stand vor Rebuild).
- `package.json` description ersetzt (Star-Wars-Rest entfernt).
- Star-Wars-Grep über Code: nur Fehlalarme („startet", „align-items:start").
  Hinweis: `.claude/skills/…/tiktok-duell-sync/SKILL.md` erwähnt „Death-Star-Duell" als
  Trigger-Alias — bewusst belassen (Mikas Sync-Skill, Trigger-Wort, kein UI-Inhalt).
- Datenlage: 5 Snapshots (2026-06-21, 07-09, 07-10, 07-11, 07-12) → echte 18-Tage-Lücke.
- Workflow nutzt checkout@v4/setup-node@v4 → Upgrade auf v5 in Phase 1.

## Skill-Inventur → Phasen-Zuordnung

| Skill | Einsatz |
|---|---|
| superpowers:verification-before-completion | JEDES Gate: Beweis vor Erfolgsmeldung (Orchestrator) |
| tiktok-duell-sync (Repo-Skill) | Pull/Push-Disziplin: Pull zu Beginn ✅, Push nur nach Mikas OK |
| superpowers:test-driven-development | Phase 2 (bindend für Logic-Subagent) & Phase 1 (Fixture-Tests) |
| superpowers:systematic-debugging | ad hoc, sobald ein Bug auftaucht |
| superpowers:brainstorming | vor Phase 3 — Design-Brief ist bereits sehr konkret; nur Rest-Entscheidungen schärfen |
| frontend-design + dataviz + kpi-dashboard-design | Phase 3: Gestaltung, Chart-Design |
| design:design-critique | Phase 3 Gate + Phase 6 (ehrliches Review, Bewertung 1–10) |
| design:accessibility-review / web-design-guidelines | Phase 6 (A11y-Audit) |
| superpowers:requesting-code-review + Agent superpowers:code-reviewer | Phase 6 |
| superpowers:dispatching-parallel-agents | Phase 4 (4a ∥ 4b) |
| MASTERUI / ui-ux-pro-max | optional Phase 3, nur falls design-Skills nicht reichen |

Nicht vorhandene Skills: keine kritischen Lücken; TDD-Skill existiert.

## Phase-1-Befunde (Gate bestanden 13.07.2026)

- `scripts/fetch.mjs` v2: user/info + user/posts (paginiert, Cap 200, Pausen 1500ms),
  schreibt `data/videos.json` + `viewsTotal` im Snapshot (bei posts-Fehlschlag weggelassen,
  nie 0) + Avatare nach `assets/avatars/a.jpg|b.jpg`. `--dry-run` schreibt garantiert nichts.
  Pure Helfer exportiert (mapVideo, sumViews, fetchAllVideos mit injizierbarem fetch/sleep).
- `test/fetch.test.js` (15 Tests) + 7 tikwm-Fixtures in `test/fixtures/`. `npm test` → 40/40 grün.
- Echter dry-run 13.07.: Mika 173 Follower / 38 Videos / viewsTotal 338'669;
  Tino 27 Follower / 12 Videos / viewsTotal 11'795. history.json unverändert (git diff leer).
- Workflow auf checkout@v5/setup-node@v5, committet data/ + assets/avatars/ (mit Existenz-Guard).

## Phase-2-Befunde (Gate bestanden 13.07.2026)

- logic.js: daysBetween, score (Breakdown, negative Zuwächse zählen negativ), dayWinner
  (isGap bei spanDays>1), dailyRows/dayGains/yesterdayGains mit spanDays, streak (Lücken
  übersprungen, Gleichstand beendet), winLoss7d (nur 1-Tages-Übergänge), velocity7d,
  milestoneProjection (Velocity ≤0 → nie), engagementRate, heatmapData (flaches Array,
  Montag-Start), topVideoOfWeek, headToHead (createTime, nicht isTop), viewsGain (fehlendes
  viewsTotal nie 0), spruchDesTages (djb2-Hash, Pool 32+4 exportiert als spruchPool).
- config.js: `scoring: { followers: 3, likes: 1, videos: 2 }` (Farben unangetastet → Phase 3).
- Tests: 89/89 grün (74 logic + 15 fetch). Gate selbst geprüft: 18-Tage-Lücke, 0/1/2 Snapshots,
  viewsTotal-Mischfälle, Gleichstand, Platzhalter-Vollständigkeit alle abgedeckt.
- Plausibilität gegen echte Daten: Sieger 11.→12.07. Mika 50:1, Streak a×3, W:L 3:0.
- Risiko notiert: heatmapData nutzt UTC-Tag (Posts spät abends CH rutschen auf Folgetag).

## Phase-3-Befunde (Gate bestanden 14.07.2026)

- Der Phase-3-Subagent war doch gelaufen (Session-Limit vor Commit): styles.css/index.html/
  config.js/dashboard.js lagen fertig im Working Tree — geprüft und übernommen statt neu dispatcht.
- styles.css komplett neu: Token-System (#07070a-Bühne, Hairlines, Gold #d4af6e / Platin #aeb6c2,
  Metall-Gradients), Fraunces/Instrument Sans, tabular-nums, Skeletons, reduced-motion-Kill,
  Breakpoints mobile-first 390→768→1080→1440. Nur transform/opacity animiert.
- index.html: alle 10 Sektionen mit realistischen de-CH-Platzhaltern + ID-/data-Schema-Kommentar
  als Andockpunkte für Phase 4. dashboard.js = Stub („Phase 4 verkabelt das Dashboard.").
- Abweichung korrigiert: Agent hatte noch die ALTE Posting-Heatmap gebaut → ersetzt durch das
  spezifizierte Daily-Output-Block-Diagramm (#output-chart): 28 Tages-Spalten, ein Video = ein
  Block, Mika stapelt von der Achse nach oben (Gold), Tino nach unten (Platin), Wochen-Ticks,
  Hover via title zeigt Titel + Views. Kein Library-Zusatz, reines Flex/Grid.
- Design-Review (design:design-critique): erst 7,5/10 (Chart-Karte = totes Schwarz) → Fix:
  .skeleton auf .chart-frame (Phase 4 entfernt die Klasse beim Rendern) → 8,5/10, Gate bestanden.
- Gate-Beweis: Headless-CDP-Screenshots 390px (fullpage) + 1440px (5 Scroll-Abschnitte),
  DOM-Check (28 Spalten, 37/8 Blöcke, keine .hm-Reste), Konsole fehlerfrei, npm test grün.
- Notiert für Phase 6: --t-dim (#67655f) auf #07070a ≈ 3,5:1 — Mikrolabels unter WCAG-AA.
- Screenshot-Tooling: Browser-Pane-Screenshot timeoutet weiterhin; shot.mjs-Muster verbessert
  (Zufallsport + eigenes user-data-dir + taskkill /T /F, fullpage bei grossen Höhen vermeiden —
  feTurbulence-Noise macht Riesen-Viewports zäh, stattdessen scroll=<y>-Abschnitte).

## Notizen für Folge-Sessions

- `data/history.json` NIE von Hand editieren (gehört der Action). `fetch.mjs` lokal nur mit `--dry-run`.
- Handles: a = mika.nature.enjoyer (Mika, Gold), b = tego..11 (Tino, Platin).
- Am Ende NICHT pushen — Mika fragen.
