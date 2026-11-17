# Review results (2026-11-17)

What happened to each confirmed review finding. Every finding was checked first, by reading the code
and by a probe (a script, a private server on a spare port, or a browser screenshot), and then fixed.
All 28 high and medium findings are fixed. The 21 low findings are listed at the end: 20 as open items, 1 closed by a medium fix.

Gates after the fixes (run from the repo root):

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | no errors |
| `npm run typecheck` | no errors |
| `npx vitest run --no-cache` | 32 files, 308 tests passed (was 292) |
| `npm run build` | built |
| `node server/main.ts --selftest` | `selftest ok: … 1046 km on BNSF` |
| `npx playwright test` | 10 passed (was 8); `docs/screenshots/*.png` refreshed |

## Security and logic (engine, server, API)

| # | Sev | Finding | Result |
|---|---|---|---|
| 1 | high | `npm run dev`: any web page could read the car database through Vite (`/@fs/…?import&raw??`, `Access-Control-Allow-Origin: *`) | **Fixed.** Reproduced first (200 with the SQLite bytes). `server/http/serve.ts` now refuses, for every path and not only `/api`, a request with a foreign `Origin`, or one the browser marks `Sec-Fetch-Site: cross-site`/`same-site` that is not a page navigation. Vite runs with `cors: false`. Vite raised from 5.4.11 to 5.4.21 (closes the `fs.deny` bypasses; a dev dependency only). New test in `serve.test.ts`. Probe after the fix: 403 for the database, `/etc/passwd` and `package.json` from another origin; the app's own page still 200. |
| 2 | high | A report time after the "as of" time pushed the arrival later and could turn an Act-now car into OK | **Fixed.** A report more than 1 h after "as of" is now **Cannot check**, field "Reported at": "The report time is about 1 year after the "as of" time, so it cannot be right. Check the year, the date and the time zone." (`server/cars/checks.ts`, for typed cars and batch rows alike). Test: the same car is Act now with the right year and never gets a verdict with the wrong one. |
| 3 | medium | A and B the same node: direction-aware routing turned off with no flag | **Fixed.** New route flag `direction-unknown` ("A and B are the same place, so the direction the car is moving is not known…"), set whenever the A → B move has no length. Such a car goes to Check first and is never OK. A straight-line approach of zero length no longer invents a heading of north. Tests in `engine/verdict.test.ts`. |
| 4 | medium | Route alternatives were not distinct (same track, different railroad labels; made-up interchanges in "shortest") | **Fixed.** `engine/trip.ts` now merges two paths when their points are the same, or when they share at least 95 % of their points with the same interchanges and turn-backs and a length within 1 %. "Shortest" pays 1 km per interchange, so a tie on shared track no longer adds an interchange. Temple > Taylor > North Little Rock now shows 1 card (was 3); Savannah > Jacksonville > Birmingham 2 (was 3). Visible side effect on the EXAMPLE car: its "Shortest" card is now 758 km with 1 interchange (the second one was a 32 km run of BNSF on shared track), so its arrival is 24 h earlier and its one pill reads **Tight** instead of Check route. It still turns back and is still never "On time". |
| 5 | medium | A bare number got an FRA-node suggestion, and Enter took the highlighted suggestion | **Fixed.** Suggestions offer a node only for the explicit "FRA 358070" form. In every place field, Enter now checks the text as typed; a suggestion is taken on Enter only after the person moved to it with the arrow keys; a list that belongs to older text is not shown. The "cannot resolve" answer still names the node as a labelled candidate (no screen shows that list today). |

## Map and canvas fidelity

| # | Sev | Finding | Result |
|---|---|---|---|
| 6 | high | Dashed lines drew solid (old route in Fix route, A to B) | **Fixed.** The cause was as suspected: deck.gl draws a round cap at both ends of every dash, which filled the gaps. Dashed layers now have square ends and the canvas sizes (old route 9/7 px at 4 px wide, A to B 4/4 px at 2.5 px). Checked in a 2× browser screenshot. |
| 7 | high | "Turns back here: check" was plain text, hard to read, cut off on a phone | **Fixed.** A white pill with an orange edge (the panel colour and the warning colour, so it also works in dark mode) beside the ring, joined by a short line. It goes left of the ring and moves to the right when the left side would leave the screen; it sits a little low so it clears B's label. On a phone it reads "Turns back: check", sits above the ring and never past either edge. deck.gl 9.0 cannot round the pill's corners, so they are square. |
| 8 | high | The Cars map lacked the car pills and the selected car's pins and lines | **Fixed.** Every car is a white pill with its status shape and number in the status colour. The selected car shows A, B and shop pins with labels, the dashed A to B line with its arrow, and a thin dashed straight line from B to the shop labelled "straight line 663 km". |
| 9 | medium | The Cars camera put markers under the selected-car card | **Fixed.** On a wide map the fit keeps 392 px free on the left when enough room remains; on a phone it keeps the top free for the folded card. |
| 10 | medium | Phone: nothing said which car, EXAMPLE, or "not live" | **Fixed** (together with #24). Chip on the phone map: "EXAMPLE 104233 · not live". |
| 11 | medium | Phone: attribution, legend and shop label crowded and overlapping | **Fixed.** The attribution starts folded on a phone (the (i) button opens it), the legend lists only the railroads of the routes in view, the shop's label is "Shop", and pin labels flip side instead of running off the map or under the round buttons. |
| 12 | medium | Phone Cars: the card covered the map | **Fixed** by folding it on the map (the second option in the finding): car id, pills, margin and "Open route" in one block about 64 px tall at the top of the map. The list below carries the rest. |
| 13 | medium | Fix route: "Click the map to add a stop" slid under the junction inspector | **Fixed.** The prompt is at the bottom right, as on the canvas; "Which line?" stacks above it. On a phone it is at the top, left of the round buttons. |
| 14 | medium | Shops edit form: fake mini-map, form below the list, map not moved | **Fixed.** The fake mini-map is gone. The real map flies to the shop being edited and marks it "Editing this shop". On the 760 px panel the list and the form sit side by side, with Save in view (the Location and On lines columns hide while a form is open; the form shows the location). On a phone the form stays below the list. |
| 15 | medium | Route form about 150 px taller than the canvas | **Fixed.** A place that was found shows a green check in its box; its hint line shows only while the box has focus (it stays in the page for screen readers). The "Check again" row is out of sight unless something changed (the button stays in the form, so Enter still checks). At 1440 × 900 the verdict and the top of the first route card are now above the fold. |
| 16 | medium | "Open route" was blue on the red at-risk strip | **Fixed.** Red for an at-risk car, purple for a car to check; the strip text uses a dark red token (9.1:1 light, 8.1:1 dark). |

## UX, accessibility and honesty

| # | Sev | Finding | Result |
|---|---|---|---|
| 17 | high | Cars took Enter, F and the arrows from every link on the page | **Fixed.** The keys act only on the Cars panel (or when nothing has focus). Enter, F and C act on the row that has focus, not the selected one; on any other control they keep their own meaning. Focus now moves with the selection at once, so a fast F after an arrow key acts on the right row. Tests: Enter on a row opens that row; F and arrows on the Shops tab do nothing to the list. |
| 18 | medium | The upload dialog did not hold focus | **Fixed.** Focus starts in the dialog, Tab and Shift+Tab cycle inside it, focus that escapes is brought back, the list ignores keys while it is open, and focus returns to "Upload batch" on close. A native `<dialog>` was not used: the test DOM (jsdom 25) has no `showModal`. |
| 19 | medium | Enter in "How files are read" uploaded the batch and dropped the change | **Fixed.** Enter in those boxes saves the settings. "Upload and check" stays off, with a note, while the settings are open. |
| 20 | medium | "Yes, delete this shop" had invisible text under the pointer; a double click deleted | **Fixed.** Danger and purple buttons keep their colour on hover. The confirm step is its own row ("Delete this shop? … [Keep it] [Yes, delete this shop]"), the Delete button leaves, and "Keep it" has focus, so neither a double click nor Enter deletes. |
| 21 | medium | Dark theme: white text on light fills | **Fixed** with tokens: `--on-fill` (white in light, #10213b in dark) for primary, danger, purple and "Fix route" chips; per-railroad tag text and fill (`--on-rr-*`, `--rr-tag-CPKC`). Every pair is 4.5:1 or more (lowest: light primary 4.51, light BNSF tag 5.04, dark CN tag 5.86). Measured in Chrome dark mode: "Copy at-risk list" 7.65, "Open route" 6.75. |
| 22 | medium | Phone hid the EXAMPLE badge, the car id and "not live" | **Fixed.** On a phone the header keeps only the EXAMPLE DATA badge, the folded summary starts with the car id, and the map chip says "<car id> · not live". |
| 23 | medium | Cars map: no "not live" cue; tooltip said "At node B" as a fact | **Fixed.** Chip "Cars drawn at their next node (B), from the report · not live tracking" (with EXAMPLE for an EXAMPLE batch; "At node B · not live" on a phone). Tooltip: "Drawn at node B, its next node (from the report, not live)". |
| 24 | medium | An EXAMPLE shop lost its EXAMPLE label outside the Shops table | **Fixed.** The resolver now carries `example` on a resolved place, and each list line carries `shopExample`. EXAMPLE shows in the Cars row, the copied at-risk list ("Kansas City, MO (EXAMPLE shop)"), the shop's hint ("· EXAMPLE shop, not a real location"), the steps row ("Shop · EXAMPLE, from Your shops") and suggestions ("Your shop · EXAMPLE · EX-NLR-01"). |
| 25 | medium | A batch could not be deleted | **Fixed.** "Delete this batch" under the batch name, with a confirm row ("Keep it" focused). After deleting, the newest batch shows, or the empty state. |
| 26 | medium | A batch row that failed to load showed no error; Fix route waited for ever | **Fixed.** A row that is loading says so; one that fails shows "This batch row could not be loaded…" with Try again and Back to Cars, and no form. Fix route shows a failed check as an alert. "Saved for this batch row" no longer appears for a row that never loaded. |
| 27 | medium | No keyboard way to add a stop | **Fixed.** While "Add a stop" is on, a field "Or type the stop: a node, code or city" (with suggestions) adds the stop the way a map click on that place would, through the same snapping and "Which line?". Works on Route and Fix route. |
| 28 | medium | Shops scrolled sideways on a phone; Edit seemed to do nothing | **Fixed.** The table's scroll box now contains the hidden "Edit" header. Opening a form scrolls it into view and focuses its Name box. The phone browser test now checks /cars, /shops and /route/fix for sideways scrolling and the Edit focus. |

## Changes to the sketch's types and signatures

Each was needed because the sketch could not express what the finding asked for.

- `shared/route.ts`: `RouteFlag` gains `{ kind: "direction-unknown" }` (#3).
- `shared/places.ts`: `ResolvedPlace` gains `example: boolean`; `shared/cars.ts`: `CarSummary` gains `shopExample: boolean` (#24). Required, not optional: the compile check that every answer is plain JSON rejects optional fields.
- `web/map/scene.ts`: the fleet scene gains `pins`, `approach` and `straight` (#8); `shopsScene` takes any `{ label, lon, lat }` for the place being edited (#14).
- `web/map/layers.ts`: `sceneLayers` gains an optional fourth argument `view` (new type `LabelView`) for labels that must stay on screen (#7, #11).
- Optional props added: `FitBounds` `leftInset`/`topInset`, `Legend` `railroads`, `CarsPanel` `onDeleteBatch`, `CarForm`/`RoutePanel` and `FixPanel` `onTypedStop`, `FixPanel` `error`, `PlaceField` `onChoose`; new component `StopField`. `ThemeColors` gains `status`.
- `package.json`: `vite` ^5.4.11 → ^5.4.21 (dev dependency; lock file updated).

## Open items (low findings, recorded, not fixed)

1. EXAMPLE shop label in two more places: Fix route's stops list ("· EXAMPLE shop") and the Cars shop filter ("(EXAMPLE)"). The steps row, hint, rows, suggestions and copied list are done (#24).
2. Route callouts on the map: square corners, no shadow, both lines bold, km not in the mono font, arrival not grey italic (deck.gl text limits; would need HTML markers).
3. No scale bar (mockup has "100 km" at bottom right).
4. "Fit whole route" does nothing while Fix route looks at a junction.
5. Small Fix route differences: no target icon in the inspector title, no fit icon on "Back to whole route", no map label for a stop the person added, railroad code missing for a one-railroad stop, shop row uses a square not the pin, "What changed" header not grey, Undo not blue when active.
6. Layers card does not close on Escape or an outside click; overlay tile looks selected like a radio; the Map thumbnail is blank.
7. Cars panel copy: "1 need fixing" should be "1 needs fixing"; the batch picker pushes "Upload batch" to its own row; the copied-list preview loses its hanging indent.
8. "Arrival spread" preview: the dashed line has no "Prep ends" label and no day axis; the time inputs show a 12-hour clock while the verdict shows 24 h.
9. Phone: the whole page scrolls and the map scrolls away (this follows UX_PLAN, which chose the stacked layout over the canvas's fixed map).
10. Text that looks like FRA or coordinate syntax ("123 456", "FRA 12") is read as that syntax before the code sets.
11. Route steps keep a stop's label from the first routing after a code set is re-imported with a new name (planner cache).
12. An existing data folder keeps looser permissions than 0700 (the database files themselves are 0600).
13. The node-code import card says `fra_node`; the server accepts `fra_id`.
14. "Remove" deletes a whole code set in one click, with no confirm and no undo.
15. The margin is shown as an exact number ("−14 h", "−3.5 days") while the speed is a placeholder. Follows the mockups: a design decision to confirm.
16. The parse summary counts only rows the reader could not read, not rows that are Cannot check for another reason.
17. "Report is old" uses a fixed 48 h, not the "Report is old after" setting, and changes only the colour of the icon.
18. Route has no h1, and the page title is the same on every screen.
19. "3 of 20 likely arrivals come before prep is ready (illustration)" is a bold made-up number under every real verdict.
20. Times are shown in the browser's zone with no zone label (UX_PLAN open question 5).

(The low finding "phone card covers almost the whole map" is closed by #12.)
