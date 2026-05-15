# Testing Plan — Sucrose Final Spec (7 Items)

## How to run tests

Open `index.html` in a browser. All tests are manual. Supabase connection required for save tests; use offline mode for unit-level tests by mocking `sbSaveGame`.

---

## Item 1 — Scanner → logDraft connection (`duration_seconds`, `team_total_kills`)

### Setup
Start a log session. Scan a screenshot during the draft/result step.

### Tests

| # | Action | Expected |
|---|--------|----------|
| 1.1 | Scan a screenshot with a visible clock (e.g. `18:42`) and apply it | `LS.matchInfo.duration_seconds === 1122` (18×60+42) |
| 1.2 | After apply, open the player step for a Carry | KDA stats from scan are pre-filled in raw stats panel; `LS.matchInfo.team_total_kills` equals sum of all our-team kills |
| 1.3 | Save the game; inspect the saved object in Supabase | Game row has `duration_seconds: 1122`, `team_total_kills: <n>` |
| 1.4 | Scan a screenshot with no clock visible | `duration_seconds` is not set (undefined/null) — no crash |
| 1.5 | Console: `console.log(LS.matchInfo)` after apply | Verify both fields present |

---

## Item 2 — Enemy role confirmation screen

### Setup
Scan a screenshot that includes enemy heroes. Apply it.

### Tests

| # | Action | Expected |
|---|--------|----------|
| 2.1 | Apply a scan with ≥1 detected enemy hero | 300 ms after modal closes, `#enemy-role-modal.open` appears |
| 2.2 | Enemy modal shows hero names from scan | Each row shows hero name + gold value (if scanned) |
| 2.3 | Change a role dropdown and click Confirm | `LS.enemyRoles` array has `{hero, role, gold}` with updated role |
| 2.4 | Click Skip (×) | `LS._pendingOppTeam` is cleared; toast "Enemy roles skipped — gold comparison unavailable" |
| 2.5 | Confirm roles, then open player step for a Support | `getEnemySameRoleGold` returns enemy Carry's gold for Protection pillar calc |
| 2.6 | Scan with no enemy heroes detected | Enemy modal does NOT open; no crash |
| 2.7 | Save game after confirming roles | `enemy_roles` array is present in saved game object |

---

## Item 3 — Role-based 4-pillar system in log/edit forms

### Setup
Start a log, reach the player scoring step.

### Tests

| # | Action | Expected |
|---|--------|----------|
| 3.1 | Log a Carry player | 4 sliders: "Lane Influence" (MANUAL/purple), "Scaling" (AUTO/blue), "Survival" (AUTO), "Teamfight" (AUTO) |
| 3.2 | Log a Jungler | Pillars: "Map Influence" (manual), "Gank" (hybrid), "Objective" (manual), "Scaling" (hybrid) |
| 3.3 | Log a Support | Pillars: "Map Influence" (manual), "Teamfight" (hybrid), "Tank" (hybrid), "Protection" (hybrid) |
| 3.4 | Hybrid slider with auto score present | Badge shows suggested score text (e.g. "7.3 · strong"); slider pre-set to rounded auto value |
| 3.5 | Drag hybrid slider away from auto | Delta line appears: "Suggested 7.3 → You: 5 (-2.3)" |
| 3.6 | Drag hybrid slider back to within 0.15 of auto | Delta line disappears |
| 3.7 | Manual slider | No AUTO badge, no delta, no suggestion line |
| 3.8 | Old game data (no `pillar_scores`) in edit modal | Falls back to legacy GAME_SENSE_CRITERIA / ROLE_CRITERIA sliders (backward compat) |
| 3.9 | Log all 5 players in a session | Each player shows their own role's 4 pillars independently |

---

## Item 4 — Benchmark Settings panel in Settings

### Setup
Open Settings page.

### Tests

| # | Action | Expected |
|---|--------|----------|
| 4.1 | Settings page has "Pillar Benchmarks" section | Button "⚙ Benchmark Settings" is visible |
| 4.2 | Click the button | `#benchmark-modal` opens with role tabs (Carry / Midlane / Offlane / Jungler / Support) |
| 4.3 | Switch role tab | Panel switches, inputs show that role's current benchmark values |
| 4.4 | Change Carry `gold_per_min` from 700 to 800, click Save | `localStorage['sucrose_benchmarks']` updated; toast confirms |
| 4.5 | Reload page; open benchmark modal | Carry `gold_per_min` still shows 800 |
| 4.6 | Click "Reset Defaults" | All values revert to `BENCHMARK_DEFAULTS`; localStorage updated |
| 4.7 | Save current values as preset named "Ranked" | Preset appears in preset list |
| 4.8 | Change a value then load "Ranked" preset | Values revert to saved preset |
| 4.9 | Delete "Ranked" preset | It no longer appears in the list |
| 4.10 | No benchmarks set (clear localStorage `sucrose_benchmarks`) | Hybrid sliders show "Benchmark not set — grade manually" |

---

## Item 5 — Pillar pre-fill calculations (normalisation against benchmarks)

### Setup
Log a game after scanning KDA/gold/dmg stats. Benchmarks set to defaults.

### Tests

| # | Action | Expected |
|---|--------|----------|
| 5.1 | Carry with 8/2/5, 12,000 gold in a 17-min game | `gold_per_min = 706` → near benchmark 700 → `normAgainstBenchmark(706, 700) ≈ 5.1` |
| 5.2 | Player at exactly benchmark value | Normalised score = 5.5 (midpoint) |
| 5.3 | Player at 1.5× benchmark (top) | Normalised score = 10 (clamped) |
| 5.4 | Player at 0.5× benchmark (bottom) | Normalised score = 1 (clamped) |
| 5.5 | Player below 0.5× benchmark | Normalised score = 1 (clamped, no negative) |
| 5.6 | Duration not set (no scan) | `gold_per_min` cannot be calculated; hybrid pillar shows "Benchmark not set — grade manually" |
| 5.7 | KDA pillar: 0 deaths | `kda` calculated using `(K+A)/1` fallback; no division by zero |
| 5.8 | Support Protection pillar: enemy Carry gold confirmed | `getEnemySameRoleGold('Support', LS.enemyRoles)` returns enemy Carry gold; protection score is inversely normalised |
| 5.9 | Edit raw stats panel: change deaths from 2 to 5 | `refreshPillarSuggestions` fires; hybrid sliders update with new suggested scores |

---

## Item 6 — Raw stats collapsible section

### Setup
Be on the player scoring step (either log flow or edit modal).

### Tests

| # | Action | Expected |
|---|--------|----------|
| 6.1 | Player step loads | Raw stats section is collapsed by default; arrow shows ▸ |
| 6.2 | Click "RAW STATS (EDITABLE)" | Panel expands; arrow shows ▾ |
| 6.3 | Click again | Panel collapses back |
| 6.4 | Scanned stats pre-populated | Inputs for K/D/A, Gold, Rating, Dmg %, Taken % all show scanned values |
| 6.5 | No scanned stats | All inputs show empty (placeholder "—") |
| 6.6 | Edit Gold value | `LS.scores[pid].gold` updates; hybrid sliders that use gold recalculate |
| 6.7 | Edit kills/deaths/assists | KDA-based pillar suggestions update |
| 6.8 | Navigate to next player and back | Raw stats persist in `LS.scores` (inputs restored on re-render) |
| 6.9 | Non-numeric input | `onRawStatChange` ignores it; no crash |

---

## Item 7 — Save both `pillar_auto_scores[]` and `pillar_scores[]`

### Setup
Complete a full log session for a player with hybrid pillars.

### Tests

| # | Action | Expected |
|---|--------|----------|
| 7.1 | Accept all auto suggestions (don't adjust sliders) | `pillar_scores` == rounded `pillar_auto_scores` values |
| 7.2 | Override one hybrid slider manually | `pillar_scores[key]` = coach value; `pillar_auto_scores[key]` = original auto value (not overwritten) |
| 7.3 | Manual pillar (e.g. Lane Influence) | `pillar_scores['lane_influence']` = slider value; `pillar_auto_scores['lane_influence']` absent (manual has no auto) |
| 7.4 | Save game; inspect `playerScores[pid]` | Object has both `pillar_scores: {…}` and `pillar_auto_scores: {…}` |
| 7.5 | Skipped player | `LS.scores[pid] = {skipped: true}` — no `pillar_scores` |
| 7.6 | Old game edit (no pillar_scores) | Edit modal still works with legacy sliders; save preserves old structure |
| 7.7 | `calcGameScore` on new game | Averages `pillar_scores` values + mentality; returns 1–10 |
| 7.8 | `calcGameScore` on old game | Legacy path: averages GAME_SENSE + ROLE criteria values; no crash |
| 7.9 | `getRadarValues` on player with new games | Returns 5-key radar using pillar keys (all 4 pillars + mentality equivalent) |
| 7.10 | `getRadarValues` on player with only old games | Returns legacy 5-key radar (Mentality/Micro/Game Sense/Tactical/Role Phase) |

---

## Regression tests

These verify pre-existing features weren't broken.

| # | Area | Test |
|---|------|------|
| R1 | Screenshot scan UPLOAD→SCANNING→REVIEW | Full modal flow still works end-to-end |
| R2 | Edit scan (multi-file) | Edit modal scan button accepts multiple files |
| R3 | Edit scan review defaults | Already-filled fields default OFF in review; empty fields default ON |
| R4 | `applyEditScannedData` | Stats apply to `_cache.games[gameIdx].playerScores[pid]` correctly |
| R5 | Match result field | Scan result auto-fills result dropdown |
| R6 | Draft heroes | Scan populates `LS.draft.ourPicks` and `LS.draft.oppPicks` correctly |
| R7 | MVP assignment | Scanning MVP IGN matches player and sets `mvp: true` |
| R8 | `saveEdit` | Scanned stats (kills, gold, etc.) are preserved when editing name/comment |

---

## Unit-level function tests (browser console)

Paste these in the browser console to verify calculation correctness:

```javascript
// normAgainstBenchmark
normAgainstBenchmark(700, 700)   // → 5.5
normAgainstBenchmark(1050, 700)  // → 10 (clamped)
normAgainstBenchmark(350, 700)   // → 1  (clamped)
normAgainstBenchmark(875, 700)   // → 7.75

// normAgainstBenchmarkInverse (lower is better, e.g. deaths)
normAgainstBenchmarkInverse(3, 6)   // → 10 (half the benchmark deaths)
normAgainstBenchmarkInverse(6, 6)   // → 5.5
normAgainstBenchmarkInverse(9, 6)   // → 1 (1.5× benchmark deaths)

// calcPillarAuto — Carry scaling (gold/min based)
// Simulate: 12000 gold, 1020 seconds (17 min) duration, benchmark 700 gpm
LS.matchInfo.duration_seconds = 1020;
LS.scores['player-id'] = {gold: 12000, kills: 8, deaths: 2, assists: 5};
calcPillarAuto('scaling', 'Carry', buildStatsForPillar('player-id'), getBenchmarks().Carry);
// → should be ~5.1 (706 gpm / benchmark 700)

// suggLabel
suggLabel(9.2)  // → {text: '9.2 · excellent', color: '#44ff88'}
suggLabel(5.5)  // → {text: '5.5 · average', color: '#888'}
suggLabel(null) // → null
```

---

## Known limitations / won't-test

- Enemy gold comparison for Support Protection only works when enemy Carry role is confirmed in the enemy role modal
- Jungler objective tip only shows when both `duration_seconds` and `result` are set
- Benchmark presets are stored in `localStorage['sucrose_benchmark_presets']` — they are lost on `localStorage.clear()`
