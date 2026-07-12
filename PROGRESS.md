# PROGRESS — Rebuild Duell-Dashboard

Orchestrierter Komplett-Rebuild (Arena-Design, Punkte-Score, Video-Battle, Pipeline v2).
Bei Session-Abbruch: hier weiterlesen, Phasen strikt in Reihenfolge, Gate von Phase N
selbst prüfen bevor N+1 startet. Referenz-Spezifikation: der Orchestrator-Prompt
(P0-1…P0-8, P1-1…P1-4, P2-1/P2-2, Design-Brief „Arena").

## Phasenstatus

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Setup, Tests grün, Skill-Inventur, package.json bereinigt | ✅ erledigt |
| 1 | Daten-Pipeline v2 (P0-8: posts, videos.json, viewsTotal, Avatare, --dry-run, Fixtures) | ⬜ offen |
| 2 | Logik TDD (score, dayWinner datums-bewusst, streak, winLoss7d, velocity, milestone, heatmap, topVideo, headToHead, spruch, dailyRows/dayGains neu) | ⬜ offen |
| 3 | Design-System & Gerüst (Token-CSS, index.html-Skelett, Skeletons, responsive) + Design-Review ≥8 | ⬜ offen |
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

## Notizen für Folge-Sessions

- `data/history.json` NIE von Hand editieren (gehört der Action). `fetch.mjs` lokal nur mit `--dry-run`.
- Handles: a = mika.nature.enjoyer (Mika, Gold), b = tego..11 (Tino, Platin).
- Am Ende NICHT pushen — Mika fragen.
