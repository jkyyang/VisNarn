# UI / UX plan — Shop Arrival Check (draft, 2026-11-16)

Status: **proposed**. Comes from a research + design workflow: 5 Opus researchers (transit trip planners, freight
visibility tools, rail-ops maps, route editing, ETA uncertainty & triage), 3 Opus designers (triage-first, map-first,
timeline-first) and 1 Opus judge. Base = **triage-first** (judge score 20/25; map-first 18, timeline-first 14),
with grafts from the other two. External sources are inspiration, not proof that a pattern fits shop prep.

## The idea in one paragraph
The daily job is a **morning list of cars**, so the list is the home screen. A suspect route or missing data is never
shown as a confident answer: it goes to **"Check first"** with a reason in plain words. While the speed is a
placeholder, every time is shown **rough** (day + part of day, grey italic, "Rough estimate" badge). The selected
car gets a **route strip read like a TTC line strip**, and the map shows **arrows** for direction of travel.
The output is a **copyable at-risk list per shop**.

## Principles
1. **The list is the product.** Within 5 seconds the analyst knows how many cars need action and which ones. *(UP portal "Action Required"; Sixfold quick filters)*
2. **A route check beats a timing verdict.** Route passes node A again, runs back along A→B, turns back, long detour, A–B not connected, or unreadable input → "Check first", never green. *(Carbon status pattern; OSRM explicit "uturn" step)*
3. **Precision matches what we know.** No minutes while speed is a placeholder. *(Realtime Trains grey-italic forecasts; Transit app)*
4. **Every status = word + shape + color**, never color alone (railroad colors already fill the map). *(Carbon)*
5. **Direction is written and drawn:** "UP toward Hearne (heading E)" in words, chevrons on the map. *(GTFS headsign; map arrow symbols)*
6. **One click from a warning to the evidence:** zoom to the place, real-track overlay on. *(Apple Maps step zoom; OpenTrainTimes)*
7. **Output is a short list per shop**, not a notice per car. *(RailSight reports; FourKites)*

## Main screen (desktop)
```
+- Shop Arrival Check --------------------------------------------------------------------------------------+
| [Morning list] [One car]   48 cars . [Rough estimate: placeholder 400 km/day]   [Paste CSV v] [Assumptions] |
+-------------------------------------------+----------------------------------------------------------------+
| [! Act now 4] [? Check first 3] [OK 41]   |  MAP                                          [Layers] [Undo]  |
| Shop [All shops v]   [Copy at-risk list]  | +- EXAMPLE 104233 ------------------------+                    |
|-------------------------------------------| | (!) ACT NOW  Prep may end too late       |   A - - -B         |
| v ACT NOW (4): car can come before prep   | | Rough estimate . placeholder speed       |          \ > >     |
|  (!) 104233  N Little Rock     -18 h      | | Prep ends     Tue Nov 17, afternoon      |           \ UP     |
|      Prep ends Tue 17 . car may come Tue 17| | Car arrives   about Tue 17 - Wed 18      |            o UP>BNSF|
|  (!) 663012  Calgary           -6 h       | | [400 km/day] [+24 h/interchange] [24 h]  |             \ >    |
| v CHECK FIRST (3): look before sending    | | [Copy note for shop]  [Fix route]        |              \ >   |
|  (?) 220871  North Platte    Check route  | |------------------------------------------|               [S]  |
|      Route turns back at Temple (yard)    | |  o  Taylor, TX         passed (A)        |                    |
|  (?) 318045  Chicago        Cannot check  | |  :  car is somewhere here . 58 km        |                    |
|      Node B code not found                | |  O  Temple, TX         next (B)          |                    |
| > OK (41): no action needed               | |  |  UP toward Fort Worth (heading N)     |                    |
|                                           | |  @  Change railroad UP -> BNSF . +24 h   |                    |
| [Download results CSV]                    | |  |  BNSF toward N Little Rock (NE)       |                    |
|                                           | |  #  North Little Rock, AR  shop          |                    |
+-------------------------------------------+----------------------------------------------------------------+
 Keys: Up/Down move . Enter open . F fix route . C copy note      (!) red octagon  (?) amber triangle
```
Phones: keep the current stacked layout; sticky chip row; two-line rows; detail as a full-width panel with "Back to list".

## Flows
**Morning batch → shops (analyst):** paste export → "Check all" → parse summary ("48 rows read · 2 need fixing: line 7 has no time zone") → read chips → arrow keys through *Act now* → open *Check first*, fix or mark "cannot check" → **Copy at-risk list** (plain text grouped by shop, with "rough estimate" wording and one assumptions line) → optional results CSV.

**Fix a suspect route:** select a *Check route* row → the strip shows a red row at the place ("Turns back at Temple (yard): check") with [Show on map] [Fix route] → *Show* zooms in and turns on OpenRailwayMap tracks, with in/out arrows and the turn angle → *Fix* opens One car with the row's values and starts via picking → the old route stays as a grey dashed ghost; a chip shows "−120 km · same interchanges · now: At risk (rough)" with [Keep] [Undo] → "Use for this batch row" (this run only; tagged "Route set by you").

**Shop planner:** reads the copied list; if they open the tool, the shop filter shows only their cars; the verdict is one sentence plus the "Rough estimate" badge and assumption chips.

**Coworker looking up a rail route (instead of Google Maps):** One car → read the strip top to bottom like a TTC line → hover a row to highlight that leg, click to zoom.

## Work list
> **Build order (user decision, 2026-11-16):** do **P0b (UI)** first; P0a (honesty fixes) is postponed.

### P0a — honesty fixes (≈2.5 days; these are the SCOPE.md "honesty fixes")
| Change | Touches |
|---|---|
| **Rough times:** `fmtDay` (day + part of day), `.est` grey italic style, "Rough estimate" badge; no minutes while the basis is a placeholder. Add `basis` to `ArrivalCheck` (`placeholder` now, `calibrated` after M2). | format.ts, arrival.ts, Verdict.tsx, BatchTable.tsx, styles.css |
| **Rename the bounds** to what they are: "If the car is at B now" / "If the car just passed A" (position, not a forecast range). Merge the table's Earliest/Latest into one "Rough ETA" column; keep exact ISO times in the CSV. | Verdict.tsx, BatchTable.tsx, csv.ts |
| **Route checks as a status** in a pure, tested module `lib/routeCheck.ts`: passes node A again, runs back along A→B, any turn-back (even on yard track), A–B not connected (straight-line fallback), detour ratio above a threshold. A flagged car never shows "On time"; headline "Check the route before using this result"; no time verdict shown. | new routeCheck.ts (+ tests), check.ts, Verdict.tsx |
| **"Cannot check"** for unreadable codes, shops off the network, and (once the zone rule is agreed) times with no zone. | check.ts, BatchTable.tsx |

### P0b — new triage UI (≈4 days; needs the team's OK because SCOPE froze UI polish)
| Change | Touches |
|---|---|
| **Grouped worklist:** chips "Act now / Check first / OK" with counts, sticky group headers, signed "Margin", one-line reason per row, shop filter, **Copy at-risk list**; "Morning list" becomes the first tab. | BatchResults.tsx, BatchTable.tsx, csv.ts (`atRiskText`), App.tsx |
| **Route strip** (replaces LegList): vertical "pearl chain" — A passed (grey) · "car is somewhere here · N km" (dotted) · B next · one colored bar per leg "UP toward X (heading NE) · km" · interchange bullet · turn-back row with the angle · shop terminus; warnings in place with [Show on map] [Fix route]. Split legs at turn-back points before computing heading. Add rows for time the estimate does **not** count (yard turn-back, shop placement) and a detour line ("1,180 km vs straight line 760 km, 1.6×"). | LegList.tsx → RouteStrip.tsx, ResultPanel.tsx, styles.css |
| **Map direction cues:** chevrons along each leg at the local bearing (precomputed at 2–3 zoom spacings in `buildScene`); A→B dashed grey with one arrow toward B; red U-turn ring at flagged places; where the route reuses track the other way, offset the second pass ~4 px so both arrow directions show. No animation. | layers.ts, scene.ts |
| **A/B swap button** in the form (an A/B mix-up is a likely cause of "passes A again"). | CarForm.tsx |

### P1 — after P0, if the team wants it
- Detail card docked on the map; two-way hover between strip rows and map legs; [Show on map] opens a **junction inspector** ("Arrives on X Sub heading S / leaves on X Sub heading N", track overlay forced on — needs `showTracks` lifted out of MapView).
- **Fix-route round trip** with ghost route, delta chip, Keep/Undo, Ctrl/Cmd+Z; "Use for this batch row".
- Parse summary with clickable line numbers; **position age** ("2 days old"), old positions → Check first.
- One-key triage marks (S sent, O OK with a reason, F fix, H hold) with a "Done" group.
- **Snap preview** while picking ("Snaps to TEMPLE, TX · BNSF · 1.8 km"), and a "Which line?" chooser where railroads meet.
- If a person confirms "this turn is real", that is written into the copied list and the CSV ("route checked by hand"); a green verdict is never restored silently.

### P2 — only after M2 (calibrated history)
- **ArrivalStrip:** time axis, prep-end line, hatched buffer, P10–P90 gradient band, P50 tick; red tint where arrival can come before prep end + buffer. *(Correll & Gleicher gradient plots)*
- "Why this risk?" **20-dot quantile dotplot** ("3 of 20 likely arrivals come before prep is ready") and "To be ready for 9 in 10 likely arrivals, finish prep by …". *(Kay et al. 2016; Fernandes et al. 2018)*
- Badge "Calibrated on N trips (lane/region/global)"; "Too uncertain to decide" when the band is wider than the agreed limit.
- Grey alternative routes with "+180 km, 1 more interchange" labels.

## Deliberately cut
Drag-the-line rerouting (unproven with our deck.gl overlay; via picking + snap preview covers it) · phone bottom sheet ·
any animation or pulsing "live" cue (implies real-time tracking) · string-line chart · "avoid this subdivision" ·
compare with yesterday's run · owner-vs-operator striped lines · keeping pasted CSVs in browser storage by default
(real car positions; decide under SCOPE Step 0 Q6 first).

## Open questions for the team
1. Which P0b items does the team accept as new UI work under the SCOPE freeze?
2. Should **every** turn-back send a car to "Check first", or only some (e.g. more than one, or within N km of B)? Current code labels every one "check".
3. Thresholds: detour ratio (1.4×? 1.6×?), position age (48 h?), margin below which Tight vs OK is noise (12 h?). Tune on real lanes after M1.
4. Exact words to send to shops for rough estimates — agree once with a shop planner.
5. Time zones: which zone does the export use? Until then no zone label is shown (no zone data exists yet).
6. If the database has a railroad/Railinc ETA (SCOPE Step 0 Q1), show it next to ours; it may replace most routing detail.
7. Does the batch CSV need an optional `via` column to paste fixed routes back next morning?

## Judge's doubts worth keeping in mind
- Thresholds above (1.6×, 48 h, 12 h, 120–150°) are guesses with no data behind them yet.
- Before M2 the "if at B / if just passed A" spread only reflects position (often a few hours), so drawing it as a band would look falsely precise — hence no band until M2.
- None of this has been seen in a real browser yet; drag interactions especially are unproven.

## Later: day and night map (user idea, 2026-11-17)
The map changes with the time of day, like the iPhone dynamic wallpaper: daylight colors by day, warm light around sunrise
and sunset, and a dark map with glowing city lights at night.
- Sun position computed in the app from the current time and the map centre (no new package; a standard solar formula).
- Day / dusk / night blend of the basemap (light style, a warm tint around sunrise and sunset, the dark style at night).
- Night lights from a free night-imagery layer (for example NASA Black Marble tiles) or glowing dots for towns, plus an
  optional day-night line (terminator) across the map.
- A switch in the map layers menu: Auto (follows the clock) / Day / Night. Rail lines and the route stay readable in every mode.
- Built after the main deliverable; it does not change routing or the arrival check.
