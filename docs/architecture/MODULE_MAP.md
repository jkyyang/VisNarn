# Module map

Every file in the repo, the one thing it owns, and what it may import.
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
| `engine/` | Node | rail network, routing | `shared/` | Node |
| `server/` | Node | the back end | `shared/`, `engine/index.ts` | Node (no DOM) |
| `web/` | browser | the page | `shared/` | DOM (no Node) |
| `scripts/` | Node | the weekly network update, import-rule test | `shared/`, `engine/index.ts`, `server/` | Node |
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
| `package.json` | scripts: `dev`, `start`, `selftest`, `build`, `typecheck`, `test`, `test:e2e`, `data`, `data:update` | |
| `tsconfig.base.json` | compiler options every area shares | |
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
| `places.ts` | `PlaceRef`, `PlaceRole`, `Waypoint`, `ResolvedPlace`, `PlaceResolution`, `PlaceSuggestion`, `NetworkNode`, `NodeLocation`, `Shop`, `ShopDraft`, `ShopView`; the `FraId` and `ShopId` brands; the import types `UploadSource`, `SourceInfo`, `RowIssue`, `ImportRequest`, `ImportReport` |
| `plans.ts` | a planned route, no clock: `Plan` (start, stops in travel order, destination), `FullPlan`, `PlanField`, `PlanPlaces`, `PlanProblem`, `PlannedRoute` (incomplete, no-route or routed), `SavedRouteDraft`, `SavedRoute`; the `SavedRouteId` brand |
| `route.ts` | `RouteStrategy`, `Leg`, `TurnBack`, `Milestone`, `RoutePath` |
| `app.ts` | `Meta`; `AppError` (invalid, not-found, conflict, internal) |
| `api.ts` | the HTTP contract: the `Api` table, `Request`, `Res`, `Params`, `urlFor`, `routeMatcher`, the error body, the "answers are plain JSON" compile check. **Internal**: only `server/http/` and `web/data/` import it |
| `*.test.ts` | tests |

## `engine/` — imports `shared/`

Outside `engine/`, only `engine/index.ts` may be imported.

| File | Owns | May import |
|---|---|---|
| `index.ts` | the engine's public surface (a list of re-exports) | `./load`, `./network`, `./trip`, `./track` |
| `load.ts` | reading `graph.bin` and `graph_meta.json` from disk; the network version (a hash of the bytes); `track.bin` for the server's main thread | `./network`, `./track`, `node:fs`, `node:crypto` |
| `track.ts` | `TrackShapes.follow`: a node-to-node path redrawn along each segment's surveyed line (`track.bin`), for the map's Real tracks | `./network`, `shared/geo` |
| `network.ts` | `RailNetwork`: the network by stable id (nodes by FRA id, snapping, city names). `coreOf` is engine-internal | `./core/graph`, `shared/` |
| `trip.ts` | `Trip` (start, stops, destination, track included), `createCarRouter().route` (one trip, one strategy), `combine` (distinct paths), `tripKey` (cache identity). The only place indexes become stable ids | `./network`, `./core/*`, `shared/` |
| `core/graph.ts` | `RailGraph`: the binary layout, typed arrays, adjacency, nearest node, per-railroad serving. **Internal**: speaks node indexes | `shared/railroads`, `shared/geo`, `shared/places` (type) |
| `core/router.ts` | `Router`: Dijkstra over (segment, railroad, interchanges), turn and yard rules, via points. **Internal** | `./graph`, `shared/railroads` |
| `core/testing.ts` | test-only loader for the core objects | `./graph`, `./router`, `node:fs` |
| `core/core.test.ts` | the search rules on the real network | |
| `trip.test.ts` | the engine's contract | |

## `server/` — imports `shared/`, `engine/index.ts`

`server/app.ts` is the only file that calls another module's factory.

| File | Owns | May import |
|---|---|---|
| `main.ts` | the entry point: config → app → serve, or `--selftest` | `./config`, `./app`, `./http/serve`, `./selftest` |
| `selftest.ts` | `node server/main.ts --selftest`: load the network, start one routing worker, route the EXAMPLE trip (no database, no port) | `./routing/planner`, `engine/index.ts`, `shared/` |
| `config.ts` | where things are on this laptop; the `LOOPBACK` constant | `engine/index.ts` (default network folder) |
| `app.ts` | `App` (what the HTTP layer may ask for: meta, places, shops, plans, track) and `createApp` (the composition root); first-run EXAMPLE shops | every server module |
| `http/serve.ts` | the `node:http` shell: Host and Origin check, JSON-only bodies, `no-store`, match, decode, call, encode, errors, static files; Vite middleware in development. **Internal**: the only importer of `node:http` | `./handlers`, `./decode`, `shared/api`, `../app` (type), `../config` (`LOOPBACK`), `vite` (dev only) |
| `http/handlers.ts` | one line per route of `Api` | `./decode`, `shared/api`, `../app` (type) |
| `http/decode.ts` | untrusted JSON and query strings → domain values; path params → ids | `shared/` |
| `store/store.ts` | the `Store` interface: shops, saved routes, `revision`, `fresh` | `shared/` |
| `store/sqlite.ts` | the Store on `node:sqlite`: schema, migrations (schema 2 adds `saved_routes`; older tables stay, unread), SQL, JSON columns. **Internal**: the only importer of `node:sqlite`; exports `openStore` only | `./store`, `shared/` |
| `places/directory.ts` | `Directory`: the one resolver (`resolve`, `suggest`, `nearest`) and the namespace rules | `../store/store` (type), `engine/index.ts`, `shared/` |
| `places/shops.ts` | `Shops`: rules for saving a shop, the list with network facts, the shop import | `./directory`, `../store/store`, `../intake/intake`, `shared/` |
| `routing/planner.ts` | `RoutePlanner`: `plan`; the queue, the workers, the route cache | `./protocol`, `engine/index.ts`, `shared/`, `node:worker_threads` |
| `routing/worker.ts` | the worker thread's entry: one `CarRouter`, one job at a time | `./protocol`, `engine/index.ts` |
| `routing/protocol.ts` | the messages between planner and worker | `engine/index.ts` (types), `shared/` |
| `plans/plans.ts` | `Plans`: `route` (resolve every place, then route start → stops → destination; stores nothing), `saved`, `save`, `remove` | `../places/directory`, `../routing/planner`, `../store/store`, `engine/index.ts` (types), `shared/` |
| `intake/intake.ts` | the one door for imported data: `RecordSource`, `openSource`, `readShops` | `./csv`, `shared/` |
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
| `map/DeckOverlay.tsx`, `FitBounds.tsx`, `RealTracks.tsx`, `basemaps.ts` | overlay control, camera fit (also when a plan first gets its route), Real tracks (OpenStreetMap rail lines from OpenFreeMap vector tiles), basemap styles | |
| `map/Legend.tsx` | `Legend`, `legendFor`: the selected route's railroads only (with no route, all six while the network is drawn), and "↩ Turn-back" when it has one | `./scene` (type), `shared/railroads` |
| `screens/route/RouteWorkspace.tsx` | container for the route planner (desktop and phone): saved route from the URL, session, `usePlannedRoute`, scene, save | `./session`, `./RoutePanel`, `../../data/hooks`, `../../map/*`, `../../app/routes` |
| `screens/route/session.ts` | the plan being worked on: start, stops, destination with undo history, ⌖ pick, the missed click; `planReducer`, `nextTarget`, `stopInsertIndex`, `usePlanSession` (click → snap → start, destination, then a stop where it adds the least km) | `../../data/hooks`, `shared/` |
| `screens/route/RoutePanel.tsx` | the planner's panel: `PlaceField`, stop rows with `LineChips` (Any / BNSF / UP), route rows, sections, save bar, saved routes, the one hint line | `./session`, `../../map/scene` (`chosenRoute`), `../../ui/badges`, `../../words`, `../../format`, `shared/` |
| `screens/shops/ShopsScreen.tsx` | container: shops, the form, the shop import, picking a location | `./ShopsPage`, `../../data/hooks`, `../../map/*`, `../../app/*` |
| `screens/shops/ShopsPage.tsx` | `ShopTable`, `ShopForm`, `ShopImportCard`, `PickPrompt` | `../../ui/*`, `../../data/hooks`, `shared/` |
| `ui/badges.tsx` | `RailroadChip` | `shared/` |
| `ui/ErrorBoundary.tsx`, `ui/files.ts` | an error fallback; reading a chosen file as text | |
| `**/*.test.ts` | tests next to the code | |

Who may call data hooks: the two containers, `App`, and the input widgets `PlaceField` and `ShopForm`. Every other component takes props.

Two screens: Route (the planner) and Shops.

## `scripts/`

| File | Owns | May import |
|---|---|---|
| `update-network.ts` | the weekly network update (`npm run data:update`, run by `launchd/`): rebuild in a temporary copy, check, then replace `public/data` | `engine/index.ts`, `server/selftest`, `shared/` |
| `free-port.mjs` | frees the app's port before `npm run dev` and `npm start` | `node:` only |
| `architecture.test.ts` | the import rules the compiler cannot check; the ban on parameter properties and enums in Node-run code | `node:fs` |

## `tests/`

| File | Owns |
|---|---|
| `harness.ts` | `startTestApp`: the real back end on a temp folder and a free loopback port |
| `api.test.ts` | the API end to end over HTTP, one block per screen's needs, plus restart |
| `screens.test.tsx` | the planner and Shops rendered from the real back end's answers |

## Data

| Path | Notes |
|---|---|
| `pipeline/run_all.sh`, `download_narn.py`, `build_graph.py`, `export_web_graph.py`, `export_basemap.py`, `places.py`, `railroad_classes.py` | the producer of `public/data/`; `CLASS1` must equal `shared/railroads.ts`, which the engine checks when it loads the network |
| `public/data/graph.bin`, `graph_meta.json`, `track.bin`, `basemap_mainline.geojson` | read by `engine/load.ts` (first three) and by the page (the last) |
| `docs/design/*.dc.html` | the canvas mockups |
