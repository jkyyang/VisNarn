# Module map (candidate 2)

Every file in the target repo, the one thing it owns, and what it may import.
Read [RATIONALE.md](RATIONALE.md) for why.

## Areas

Six areas (区域). An arrow means "may import".

```
web ──► shared ◄── engine ◄── server ◄── scripts
                                 ▲           ▲
                               tests (may import every area)
```

| Area | Runs in | Purpose | May import | Types it can see |
|---|---|---|---|---|
| `shared/` | browser and Node | the domain words and the HTTP contract | nothing | ES2023 only: no DOM, no Node |
| `engine/` | Node | rail network, routing, verdict | `shared/` | Node |
| `server/` | Node | the back end | `shared/`, `engine/index.ts` | Node (no DOM) |
| `web/` | browser | the page | `shared/` | DOM (no Node) |
| `scripts/` | Node | backtest, import-rule test | `shared/`, `engine/index.ts`, `server/` | Node |
| `tests/` | Node (vitest) | tests that cross areas | every area | DOM and Node |

How the rules are enforced:

| Rule | Enforced by | What a violation looks like |
|---|---|---|
| An area imports only the areas it may | `npm run typecheck` (`tsc -b tsconfig.areas.json`, project references) | `TS6307: File … is not listed within the file list of project` |
| Server code cannot touch the DOM; page code cannot touch Node | each area's `lib` / `types` | `TS2584: Cannot find name 'document'` |
| Node-run areas write `.ts` on every relative import | `module: NodeNext` in those areas | `TS2835` |
| Type imports are marked as such | `verbatimModuleSyntax` | `TS1484` |
| Rules inside an area (the "Internal" notes below) | `scripts/architecture.test.ts` (`npm test`) | a failing test that names the file |

`npx tsc --noEmit` checks the whole repo as one program (types only, no boundaries). The strict check is `npm run typecheck`.

## Root

| File | Owns | Notes |
|---|---|---|
| `package.json` | scripts: `dev`, `start`, `selftest`, `build`, `typecheck`, `test`, `backtest`, `data` | no new dependency |
| `tsconfig.base.json` | compiler options every area shares | `noUnusedParameters` is off for the sketch only |
| `tsconfig.json` | the whole repo as one program, for `npx tsc --noEmit` | |
| `tsconfig.areas.json` | the list of areas, for `tsc -b` | the architecture test reads the area list from here |
| `<area>/tsconfig.json` | that area's runtime and its allowed imports (`references`) | |
| `vite.config.ts` | Vite: React, vitest settings; in development it runs inside the Node server (middleware mode, one port, no proxy) | checked in the `scripts` area |
| `index.html` | the page shell; loads `/web/main.tsx` | |

## `shared/` — imports nothing

| File | Owns |
|---|---|
| `railroads.ts` | the six Class I railroads in graph.bin bit order; the `Railroad` type |
| `geo.ts` | `LngLat`, `Bounds`, `haversineKm`, `round5` |
| `time.ts` | `Instant` (a time with its zone, as text); `readTime` under a `ZonelessRule`; hour arithmetic |
| `assumptions.ts` | `Assumptions` in three groups (`routing`, `timing`, `flags`), `EstimateBasis`, the defaults |
| `places.ts` | `PlaceRef`, `PlaceRole`, `Waypoint`, `ResolvedPlace`, `PlaceResolution`, `PlaceSuggestion`, `NetworkNode`, `NodeLocation`, `Shop`, `ShopDraft`, `ShopView`, `CodeSet`, `NodeCode`; the `FraId` and `ShopId` brands; the import types `UploadSource`, `SourceInfo`, `RowIssue`, `ImportRequest`, `ImportReport` |
| `plans.ts` | a planned route, no clock: `Plan` (start, stops in travel order, destination), `FullPlan`, `PlanField`, `PlanPlaces`, `PlanProblem`, `PlannedRoute` (incomplete, no-route or routed), `SavedRouteDraft`, `SavedRoute`; the `SavedRouteId` brand |
| `route.ts` | `RouteStrategy`, `Leg`, `TurnBack`, `Milestone`, `RoutePath` (no clock); the clock types `RouteStep`, `EtaWindow`, `Verdict`, `RouteFlag`, `TriageGroup`, `RouteOption`, `Approach`, used only by `engine/verdict.ts` since stage 1 |
| `app.ts` | `Meta`; `AppError` (invalid, not-found, conflict, internal) |
| `api.ts` | the HTTP contract: the `Api` table, `Request`, `Res`, `Params`, `urlFor`, `routeMatcher`, the error body, the "answers are plain JSON" compile check. **Internal**: only `server/http/` and `web/data/` import it |
| `api.test.ts`, `time.test.ts` | test plans |

## `engine/` — imports `shared/`

Outside `engine/`, only `engine/index.ts` may be imported.

| File | Owns | May import |
|---|---|---|
| `index.ts` | the engine's public surface (a list of re-exports) | `./load`, `./network`, `./trip`, `./verdict` |
| `load.ts` | reading `graph.bin` and `graph_meta.json` from disk; the network version (a hash of the bytes) | `./network`, `node:fs`, `node:crypto` |
| `network.ts` | `RailNetwork`: the network by stable id (nodes by FRA id, snapping, city names). `coreOf` is engine-internal | `./core/graph`, `shared/` |
| `trip.ts` | `Trip`, `createCarRouter().route` (one car, one strategy), `combine` (distinct paths), `tripKey` (cache identity). The only place indexes become stable ids | `./network`, `./core/*`, `shared/` |
| `verdict.ts` | `judge` (paths + clock + assumptions → options), `travelHours`, `classifyTiming`, `triage`, `assumptionsProblem`. The only place the group policy lives | `./trip` (types), `shared/` |
| `core/graph.ts` | `RailGraph`: the binary layout, typed arrays, adjacency, nearest node, per-railroad serving. **Internal**: speaks node indexes | `shared/railroads`, `shared/geo`, `shared/places` (type) |
| `core/router.ts` | `Router`: Dijkstra over (segment, railroad, interchanges), turn and yard rules, via points. **Internal** | `./graph`, `shared/railroads` |
| `core/testing.ts` | test-only loader for the core objects | `./graph`, `./router`, `node:fs` |
| `core/core.test.ts` | the search rules on the real network (kept from `src/lib/router.test.ts`) | |
| `trip.test.ts`, `verdict.test.ts` | the engine's contract; two timing tests run now | |

`core/graph.ts` and `core/router.ts` are today's `src/lib/graph.ts` and `router.ts` with mechanical edits only:
`.ts` imports, an explicit field in place of the parameter property, `RailGraph.resolve` removed (text
resolution moved to the Directory), `indexOf(fraId)` and `maskOf` added, `Point.only` (one railroad may serve
the point), and `Reversal` now keeps the segments, headings and km that `describe` already computed.

## `server/` — imports `shared/`, `engine/index.ts`

`server/app.ts` is the only file that calls another module's factory.

| File | Owns | May import |
|---|---|---|
| `main.ts` | the entry point: config → app → serve, or `--selftest` | `./config`, `./app`, `./http/serve`, `./selftest` |
| `selftest.ts` | `node server/main.ts --selftest`: load the network, start one routing worker, route the EXAMPLE car (no database, no port) | `./routing/planner`, `engine/index.ts`, `shared/` |
| `config.ts` | where things are on this laptop; the `LOOPBACK` constant | `engine/index.ts` (default network folder) |
| `app.ts` | `App` (what the HTTP layer may ask for: meta, the routing rules with no screen yet, places, shops, codes, plans) and `createApp` (the composition root); first-run EXAMPLE shops | every server module |
| `http/serve.ts` | the `node:http` shell: Host and Origin check, JSON-only bodies, `no-store`, match, decode, call, encode, errors, static files; Vite middleware in development. **Internal**: the only importer of `node:http` | `./handlers`, `./decode`, `shared/api`, `../app` (type), `../config` (`LOOPBACK`), `vite` (dev only) |
| `http/handlers.ts` | one line per route of `Api` | `./decode`, `shared/api`, `../app` (type) |
| `http/decode.ts` | untrusted JSON and query strings → domain values; path params → ids | `shared/` |
| `store/store.ts` | the `Store` interface: shops, codes, saved routes, settings (the routing rules), `revision`, `fresh` | `shared/` |
| `store/sqlite.ts` | the Store on `node:sqlite`: schema, migrations (schema 2 adds `saved_routes`; the old car tables stay, unread), SQL, JSON columns. **Internal**: the only importer of `node:sqlite`; exports `openStore` only | `./store`, `shared/` |
| `places/directory.ts` | `Directory`: the one resolver (`resolve`, `suggest`, `nearest`) and the namespace rules | `../store/store` (type), `engine/index.ts`, `shared/` |
| `places/shops.ts` | `Shops`: rules for saving a shop, the list with network facts, the shop import | `./directory`, `../store/store`, `../intake/intake`, `shared/` |
| `places/codes.ts` | `Codes`: code sets and their import | `./directory`, `../store/store`, `../intake/intake`, `shared/` |
| `routing/planner.ts` | `RoutePlanner`: `plan`, `peek`; the queue, the workers, the route cache | `./protocol`, `engine/index.ts`, `shared/`, `node:worker_threads` |
| `routing/worker.ts` | the worker thread's entry: one `CarRouter`, one job at a time | `./protocol`, `engine/index.ts` |
| `routing/protocol.ts` | the messages between planner and worker | `engine/index.ts` (types), `shared/` |
| `plans/plans.ts` | `Plans`: `route` (resolve every place, then route start → stops → destination with the stored routing rules; stores nothing; the engine's "A / B / shop" words never pass through), `saved`, `save`, `remove` | `../places/directory`, `../routing/planner`, `../store/store`, `engine/index.ts` (types), `shared/` |
| `intake/intake.ts` | the one door for company data: `RecordSource`, `openSource`, `readShops`, `readCodes` | `./csv`, `shared/` |
| `intake/csv.ts` | CSV text as a `RecordSource` (RFC 4180) | `./intake` (type) |
| `intake/example.ts` | the EXAMPLE shops | `shared/` |
| `**/*.test.ts` | test plans next to each module | |

## `web/` — imports `shared/`

| File | Owns | May import |
|---|---|---|
| `main.tsx` | mounting the app | `./app/App`, styles |
| `styles.css` | the look (to be rewritten to the canvas) | |
| `app/App.tsx` | the page frame: panel, one map, which screen | `./routes`, `./chrome`, `../screens/*`, `../map/MapStage`, `../data/*`, `../ui/*` |
| `app/routes.ts` | `Screen` ↔ URL: `parseLocation`, `hrefFor`, `useScreen`, `go`, `linkTo` | `shared/` |
| `app/chrome.tsx` | `AppHeader`, `ModeTabs`, `BackHeader` | `./routes` |
| `data/query.ts` | the transport and the query cache: `useQuery`, `read`, `write`, `callApi`. **Internal**: only `web/data/` imports it; the only `fetch` to the API | `shared/api`, `shared/app` |
| `data/hooks.ts` | the named reads and changes the screens use | `./query`, `shared/` |
| `data/basemap.ts` | loading the static mainline GeoJSON | |
| `data/blackMarble.ts` | downloading NASA GIBS Black Marble tiles for the night side, with an in-memory cache (GIBS sends `no-store`); its URL and attribution | |
| `words.ts` | the few words the planner says: `shortPlace`, `pillText`, `routeName`, `placeProblem`, `interchangesWord`, `turnBackMove`, `trackWords` | `shared/` |
| `format.ts` | distances, subdivision names, compass points. No clock | `shared/` |
| `theme.ts` | CSS theme tokens as deck.gl colours | `shared/railroads` |
| `map/MapStage.tsx` | the one map: `MapStageProvider`, `MapStage`, `MapContent`; layer choices | `./MapCanvas` (lazy), `./scene`, `../data/basemap` |
| `map/MapCanvas.tsx` | MapLibre + deck.gl + controls + legend (the heavy, lazily loaded half) | `./layers`, `./DeckOverlay`, `./FitBounds`, `./RealTracks`, `./MapControls`, `./Legend`, `./basemaps`, `../theme` |
| `map/scene.ts` | `MapScene` and its builders (`planScene`, `shopsScene`), `chosenRoute`, `pillAnchors`: what the map draws, as data | `../words`, `shared/` |
| `map/pills.ts` | `placePills`, `pillWidthPx`: where the route pills go on screen, beside the route lines and kept apart from each other, the pins and the legend (pure geometry) | |
| `map/RouteMarks.tsx` | `RouteMarks`: the route pills and turn-back discs as MapLibre markers, laid out with `placePills` on every move | `./pills`, `./RouteMarkFaces`, `./scene` (types), `../words`, `react-map-gl` |
| `map/RouteMarkFaces.tsx` | `PillFace`, `TurnBackMark`, `useNativeClick` (a click on a mark never reaches the map): plain DOM, so page tests draw them without a map | `./pills` (type), `./scene` (type), `../words` |
| `map/layers.ts` | a scene as deck.gl layers (the selected route by railroad, thin alternatives, pins, shop squares; no place names: the panel and the basemap have them); hover names; click targets (`sceneTarget`). The only file that names deck.gl layer classes | `./scene`, `../theme`, `../data/basemap` (type) |
| `map/MapControls.tsx` | layers card (with the Auto / Day / Night switch), zoom, undo / redo, fit | `./MapCanvas` (type), `./daylight` |
| `map/daylight.ts` | day and night: sun position and the subsolar point from the clock (no package), `mapLook` (Auto / Day / Night → day or night colours and the Day / Sunrise / Sunset / Night word, at the map centre) | `shared/geo` (type) |
| `map/nightTiles.ts` | the night side of the Earth per tile: `nightFactor`, `nightShade` (Black Marble where the sun is down, a soft twilight band, clear by day; pure), the `earthnight://` tile URL and its MapLibre loader | `./daylight`, `../data/blackMarble`, `maplibre-gl` (type) |
| `map/DayNight.tsx` | `NightLights`: the `earthnight://` raster layer under the place names, inside MapLibre (under deck.gl), its opacity per basemap and mode, redrawn every 10 minutes in Auto | `./nightTiles`, `../data/blackMarble` |
| `map/DeckOverlay.tsx`, `FitBounds.tsx`, `RealTracks.tsx`, `basemaps.ts` | overlay control, camera fit (also when a plan first gets its route), OpenRailwayMap overlay, basemap styles | |
| `map/Legend.tsx` | `Legend`, `legendFor`: the selected route's railroads only (with no route, all six while the network is drawn), and "↩ Turn-back" when it has one | `./scene` (type), `shared/railroads` |
| `screens/route/RouteWorkspace.tsx` | container for the route planner (desktop and phone): saved route from the URL, session, `usePlannedRoute`, scene, save | `./session`, `./RoutePanel`, `../../data/hooks`, `../../map/*`, `../../app/routes` |
| `screens/route/session.ts` | the plan being worked on: start, stops, destination with undo history, ⌖ pick, the missed click; `planReducer`, `nextTarget`, `stopInsertIndex`, `usePlanSession` (click → snap → start, destination, then a stop where it adds the least km) | `../../data/hooks`, `shared/` |
| `screens/route/RoutePanel.tsx` | the planner's panel: `PlaceField`, stop rows with `LineChips` (Any / BNSF / UP), route rows, sections, save bar, saved routes, the one hint line | `./session`, `../../map/scene` (`chosenRoute`), `../../ui/badges`, `../../words`, `../../format`, `shared/` |
| `screens/shops/ShopsScreen.tsx` | container: shops, the form, the shop import, picking a location | `./ShopsPage`, `../../data/hooks`, `../../map/*`, `../../app/*` |
| `screens/shops/ShopsPage.tsx` | `ShopTable`, `ShopForm`, `ShopImportCard`, `PickPrompt` | `../../ui/*`, `../../data/hooks`, `shared/` |
| `ui/badges.tsx` | `RailroadChip` | `shared/` |
| `ui/ErrorBoundary.tsx`, `ui/files.ts` | kept from today | |
| `**/*.test.ts` | test plans next to the code; `format.test.ts` runs now | |

Who may call data hooks: the two containers, `App`, and the input widgets `PlaceField` and `ShopForm`. Every other component takes props.

Stage 1 has no clock in the page: nothing under `web/` imports `shared/time.ts` or `shared/assumptions.ts` (`scripts/architecture.test.ts` checks). Two screens: Route (the planner) and Shops. The Cars screen, Fix route, batches and the import profile are gone; their tables stay in the database, unread.

## `scripts/`

| File | Owns | May import |
|---|---|---|
| `backtest.ts` | completed trips through the engine: modelled versus actual hours | `engine/index.ts`, `shared/`, later `server/intake` |
| `architecture.test.ts` | the import rules the compiler cannot check; the ban on parameter properties and enums in Node-run code | `node:fs` |

## `tests/`

| File | Owns |
|---|---|
| `harness.ts` | `startTestApp`: the real back end on a temp folder and a free loopback port |
| `api.test.ts` | the API end to end over HTTP, one block per screen's needs, plus restart |
| `screens.test.tsx` | the planner and Shops rendered from the real back end's answers |

## Unchanged

| Path | Notes |
|---|---|
| `pipeline/run_all.sh`, `download_narn.py`, `build_graph.py`, `export_web_graph.py`, `export_basemap.py`, `places.py` | the producer of `public/data/`; `CLASS1` in `export_web_graph.py` must equal `shared/railroads.ts`, which the engine checks when it loads the network |
| `public/data/graph.bin`, `graph_meta.json`, `basemap_mainline.geojson` | read by `engine/load.ts` (first two) and by the page (the third) |
| `docs/design/*.dc.html` | the canvas mockups |

## Removed

| Was | Now |
|---|---|
| `src/lib/graph.ts`, `router.ts`, `router.test.ts` | `engine/core/` |
| `src/lib/arrival.ts` | `engine/verdict.ts` (`checkArrival` split: routing in `engine/trip.ts`, timing in `judge`) |
| `src/lib/check.ts` | resolution → `server/places/directory.ts`; one car and batch → `server/cars/checks.ts`; times → `shared/time.ts`; form values → `web/screens/route/session.ts` |
| `src/lib/csv.ts` | `server/intake/csv.ts`, `intake.ts`, `example.ts`; the results CSV is dropped |
| `src/lib/scene.ts`, `vias.ts` | `web/map/scene.ts`; `stopInsertIndex` in `session.ts` |
| `src/lib/load.ts`, `testing.ts` | `web/data/basemap.ts`; `engine/load.ts`, `engine/core/testing.ts` |
| `src/lib/routeJson.ts` | dropped (the API returns the same facts as JSON) |
| `src/App.tsx`, `useSingleCar.ts`, `useBatch.ts`, `useMapData.ts`, `src/components/*` | `web/app/`, `web/screens/`, `web/data/`, `web/map/`, `web/ui/` |
| `pipeline/carrier_route.py`, `railroute.py`, `test_routes.py` | to delete: the Python routers have drifted from the engine and nothing calls them (still present in this sketch) |
| `shared/cars.ts` (stage 1) | dropped: no car in stage 1. The import types moved to `shared/places.ts`; a plan is `shared/plans.ts` |
| `server/cars/batches.ts`, `checks.ts`, `checks.test.ts` (stage 1) | dropped; routing a plan is `server/plans/plans.ts` (it took `waypoint()` from `checks.ts`). The `batches`, `batch_rows` and `route_fixes` tables and the `import_profile` setting stay in the database, unread |
| `web/screens/cars/*`, `web/screens/route/FixPanel.tsx` (stage 1) | dropped with the Cars screen and Fix route. `WhichLine` became `LineChips` in `RoutePanel.tsx`; `PickPrompt` moved to `ShopsPage.tsx` |
| `web/ui/shapes.ts`, `CopyButton.tsx`, `clipboard.ts` (stage 1) | dropped: they drew and copied car statuses |

### Tests the sketch replaces

No test is left failing. Tests of replaced APIs were removed and their intent re-listed as `it.todo`:

| Old test | Replaced API | New plan |
|---|---|---|
| `src/lib/check.test.ts` | `checkCar`, `checkBatch`, `parseTime`, `rowToForm`, `viaInsertIndex`, `buildScene`, `routeJson` | `server/cars/checks.test.ts`, `server/intake/intake.test.ts`, `shared/time.test.ts`, `web/screens/route/session.test.ts`, `web/map/scene.test.ts` |
| `src/lib/router.test.ts`: "arrival check", "csv" blocks | `checkArrival`, `parseCarRows`, `batchToCsv` | `engine/verdict.test.ts`, `server/intake/intake.test.ts` |
| `src/lib/router.test.ts`: "resolves place names, FRA IDs, and coordinates" | `RailGraph.resolve` | `server/places/directory.test.ts` |
| `src/useSingleCar.test.ts` | `singleCarReducer` | `web/screens/route/session.test.ts` |
| `src/components/render.test.tsx` | the old panels | `tests/screens.test.tsx` |
| `src/components/map/layers.test.ts` | `routeLayers`, `routeTooltip` | `web/map/scene.test.ts` |

Kept and passing: `engine/core/core.test.ts` (11), `web/format.test.ts` (3), two timing tests in `engine/verdict.test.ts`, and `scripts/architecture.test.ts` (8).
