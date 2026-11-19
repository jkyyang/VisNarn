# Module map

Every file in the repo, the one thing it owns, and what it may import.
Read [RATIONALE.md](RATIONALE.md) for why.

## Areas

Six areas. An arrow means "may import".

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
| `scripts/` | Node | the weekly network update, the shop sync to the site, import-rule test | `shared/`, `engine/index.ts`, `server/` | Node |
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
| `index.html` | the page shell; loads `/web/main.tsx`; the phone meta (viewport over the notch, theme colour, home-screen icon and name, `public/manifest.json`) | |
| `vercel.json` | Vercel: the built page (`dist/`) as static files, `/api/*` to the function and the files it reads (server sources, `public/data` network) | see `docs/deploy/vercel.md` |
| `.vercelignore` | what never goes to Vercel: the Python pipeline and its inputs | without it `requirements.txt` makes Vercel build Python |
| `api/index.ts` | the Vercel function: re-exports `server/vercel.ts` | outside the areas: one line |

## `shared/`: imports nothing

| File | Owns |
|---|---|
| `railroads.ts` | the Class I railroads and `LINES` in graph.bin bit order; the `Railroad` and `Line` types; the network classes |
| `geo.ts` | `LngLat`, `Bounds`, `haversineKm`, `round5`, `roundLngLat`, `pathKm`, `isLngLat`, `plainMinus` |
| `places.ts` | `PlaceRef`, `PlaceRole`, `Waypoint`, `ResolvedPlace`, `PlaceResolution`, `PlaceSuggestion`, `NetworkNode`, `LinkEnd`, `ShopLink` (a link as drawn: its node, its own track shop first), `NodeLocation`, `Shop` (with its links: the nodes it joins), `ShopDraft`, `ShopView`; `SHOP_LINKS_MAX`, `SHOP_LINK_MAX_KM`; the `FraId` and `ShopId` brands; the import types `UploadSource`, `RowIssue`, `ImportRequest`, `ImportReport`; `resolvedOf`, `NEAREST_MAX_KM` |
| `plans.ts` | a planned route: `Plan` (one ordered list of places: start, stops, destination; null is an empty row), `FullPlan`, `PlanPlaces`, `PlanProblem`, `placeKind`, `PlannedRoute` (incomplete, no-route or routed), `SavedRouteDraft`, `SavedRoute`; the `SavedRouteId` brand |
| `route.ts` | `RouteStrategy`, `Leg`, `TurnBack`, `Milestone`, `RoutePath` |
| `app.ts` | `AppError` and `APP_ERROR_KINDS` (invalid, not-found, conflict, internal) |
| `cache.ts` | `createCache`: the bounded least-recently-used cache every cache in the app uses (by entry count, and by size where given) |
| `api.ts` | the HTTP contract: the `Api` table, `CHANGES_DATA` (which routes change stored data: `ReadRoute`, `WriteRoute`), `Request`, `Res`, `Params`, `urlFor`, `routeMatcher`, the error body, the "answers are plain JSON" compile check. **Internal**: only `server/http/` and `web/data/` import it |
| `*.test.ts` | tests |

## `engine/`: imports `shared/`

Outside `engine/`, only `engine/index.ts` may be imported.

| File | Owns | May import |
|---|---|---|
| `index.ts` | the engine's public surface (a list of re-exports) | `./load`, `./network`, `./trip`, `./track` |
| `rules.ts` | the routing policy numbers: interchange penalty, reverse cost, sharpest turn, near-duplicate share, most interchanges, passenger track cost, snap distances | nothing |
| `load.ts` | reading `graph.bin` and `graph_meta.json` from disk; the network version (a hash of the bytes); `track.bin` for the server's main thread | `./network`, `./track`, `node:fs`, `node:crypto` |
| `track.ts` | `TrackShapes.follow`: a node-to-node path redrawn along each segment's surveyed line (`track.bin`), for the map's Real tracks | `./network`, `shared/geo` |
| `network.ts` | `RailNetwork`: the network by stable id (nodes by FRA id, the node nearest a click, snapping, town names (the nearest within `NEAR_CITY_KM`), `wayIn`: where a shop's own track most likely joins the network from a spot, `lead`: a shop's own track to a link's node, straight to its yard and then node by node). `coreOf` is engine-internal | `./core/graph`, `shared/` |
| `trip.ts` | `Trip` (points in travel order, track included, turning at stops), `createCarRouter().route` (one trip, one strategy), `combine` (distinct paths; a near-duplicate is not kept), `tripKey` (cache identity). The only place indexes become stable ids | `./network`, `./core/*`, `shared/` |
| `core/graph.ts` | `RailGraph`: graph.bin read into typed arrays, adjacency, nearest node, where a point meets the network (`serving`: its links, its node, or per-railroad snapping), `ownTrack`, `yardWalk` (yard track nearest first), `yardExit`, `lead`. **Internal**: speaks node indexes | `shared/railroads`, `shared/geo`, `shared/places` (type) |
| `core/router.ts` | `Router`: Dijkstra over (segment, railroad, interchanges), turn and yard rules, via points (left in either direction with `turnAtStops`), a linked point reached and left over its own track (one link: backed out of; two: through). **Internal** | `./graph`, `shared/railroads` |
| `core/testing.ts` | test-only loader for the core objects, `cityPoint`, `nodePoint` | `./graph`, `./router`, `node:fs` |
| `core/core.test.ts` | the search rules on the real network | |
| `trip.test.ts` | the engine's contract | |

## `server/`: imports `shared/`, `engine/index.ts`

`server/app.ts` is the only file that calls another module's factory.

| File | Owns | May import |
|---|---|---|
| `main.ts` | the entry point: config → app → serve, or `--selftest` | `./config`, `./app`, `./http/serve`, `./selftest` |
| `selftest.ts` | `node server/main.ts --selftest`: load the network, start one routing worker, route the EXAMPLE trip (no database, no port) | `./routing/planner`, `engine/index.ts`, `shared/` |
| `config.ts` | where things are: `DATABASE_URL` or the data folder, the port; the `LOOPBACK` constant | `engine/index.ts` (default network folder) |
| `app.ts` | `App` (what the HTTP layer may ask for: places, shops, plans, track) and `createApp` (the composition root); on a laptop, the database in `~/.visnarn/postgres` | every server module |
| `vercel.ts` | the Vercel function: one `App` per instance, answering with `http/serve.ts`'s `handler`, read-only but for the owner's `VISNARN_WRITE_TOKEN` | `./app`, `./config`, `./http/serve` |
| `http/serve.ts` | the `node:http` shell: `handler` (Origin check, on the public site the write token for a change, JSON-only bodies, `no-store`, match, decode, call, encode, errors) and `serve` on a laptop (the Host check, static files; Vite middleware in development). **Internal**: the only importer of `node:http` | `./handlers`, `./decode`, `shared/api`, `../app` (type), `../config` (`LOOPBACK`), `vite` (dev only) |
| `http/handlers.ts` | one line per route of `Api` | `./decode`, `shared/api`, `../app` (type) |
| `http/decode.ts` | untrusted JSON and query strings → domain values; path params → ids | `shared/` |
| `store/store.ts` | the `Store` interface: shops, saved routes (async) | `shared/` |
| `store/postgres.ts` | the Store on PostgreSQL: the `app` tables, ordered migrations (`ops.schema_migration`), SQL; Neon through `pg` for a `postgres://` URL, else PGlite in a folder. **Internal**: the only importer of `pg` and `@electric-sql/pglite`; exports `openStore` only | `./store`, `shared/`, `@vercel/functions` |
| `store/import-sqlite.ts` | once per laptop: the old `visnarn.db` (SQLite, schema 7) copied into a new Store; the file is read from a copy and left as it was | `./store` (type), `shared/` |
| `places/directory.ts` | `Directory`: the one resolver (`resolve`, `suggest`, `nearest`, `links`: a shop's links at nodes or rough spots, each with its own track, `shopPlace`: a shop with links joins the network at them, each over its own track) and the namespace rules | `../store/store` (type), `engine/index.ts`, `shared/` |
| `places/shops.ts` | `Shops`: rules for saving a shop and its links, the list with network facts, the shop import (links kept while a shop stays where it is) | `./directory`, `../store/store`, `../intake/intake`, `shared/` |
| `routing/planner.ts` | `RoutePlanner`: `plan`; the queue, the workers, the route cache (bounded, in memory) | `./protocol`, `engine/index.ts`, `shared/`, `node:worker_threads` |
| `routing/worker.ts` | the worker thread's entry: one `CarRouter`, one job at a time | `./protocol`, `engine/index.ts` |
| `routing/protocol.ts` | the messages between planner and worker | `engine/index.ts` (types), `shared/` |
| `plans/plans.ts` | `Plans`: `route` (resolve every place, then route through the set ones in order; stores nothing), `saved`, `save`, `remove` | `../places/directory`, `../routing/planner`, `../store/store`, `engine/index.ts` (types), `shared/` |
| `intake/intake.ts` | the one door for shop lists: `readShops` | `./csv`, `shared/` |
| `intake/csv.ts` | CSV text as records (RFC 4180) | `./intake` (type) |
| `**/*.test.ts` | test plans next to each module | |

## `web/`: imports `shared/`

| File | Owns | May import |
|---|---|---|
| `main.tsx` | mounting the app | `./app/App`, styles |
| `styles.css` | the look: tokens at the top (the accent, the glass surfaces, ink, strokes, the railroad palette, radii, sizes, motion), with the night set the whole page takes from the map's look and the phone sizes; nothing outside the token blocks names a colour (`styles.test.ts`); the shared kit classes (`.glass`, `.group`, `.segmented` with its sliding thumb, `.chip`, buttons, fields); then each part | |
| `app/App.tsx` | the page frame: one map, the panel floating over it (on a phone, a sheet over its foot with a grabber) with its header and scrolling body, folded away to a button (kept in this browser); the panel's search text, the place it found and the shop picked on Shops; how far the panel covers the map, for the camera; the note when the server cannot be reached | `./routes`, `./chrome`, `./PanelSearch`, `./sheet`, `../screens/*`, `../map/MapStage`, `../data/*`, `../ui/*` |
| `app/routes.ts` | `Screen` ↔ URL: `parseLocation`, `hrefFor`, `useScreen`, `go`, `linkTo` | `shared/` |
| `app/chrome.tsx` | `PanelHeader`: the search, the fold button, Route \| Shops with its sliding thumb | `./routes`, `../ui/*` |
| `app/sheet.ts` | the phone's sheet: `useSheet` (three rests, head, half and full; dragged by its head, and by its body where the body cannot scroll; settled on a spring with the release's momentum; raised full for a text field, the keyboard kept clear), `showSheet` (a screen sends it to a rest) | `../map/config` (`PHONE_QUERY`), `../ui/motion` |
| `app/PanelSearch.tsx` | `PanelSearch`: the one search (Your shops, cities, nodes; grouped), "/" to reach it; a place it cannot find turns its edge red | `../data/hooks`, `../ui/*`, `shared/` |
| `data/query.ts` | the transport and the query cache: `useQuery`, `read`, `write`, `callApi`. **Internal**: only `web/data/` imports it; the only `fetch` to the API | `shared/api`, `shared/app` |
| `data/hooks.ts` | the named reads and changes the screens use; `useReadOnly` (the public site: no control that changes stored data) | `./query`, `shared/` |
| `data/basemap.ts` | loading the static mainline GeoJSON; `canDrawMaps` | |
| `data/blackMarble.ts` | downloading NASA GIBS Black Marble tiles for the night side, with a bounded in-memory cache (GIBS sends `no-store`); its URL and attribution | `shared/cache` |
| `words.ts` | the words the page says: `shortPlace`, `lineName`, `plural`, `errorText`, `clickToSet`, `pillText`, `routeName`, `placeHint`, `placeProblem`, `interchangesWord`, `turnBackMove`, `trackWords`, `linkText`, `linkJoinsThere`, `BACK_OUT`, `PLACE_SOURCE_WORDS` | `shared/` |
| `format.ts` | distances in the viewer's unit (`fmtDistance`), subdivision names, compass points. No clock | `shared/`, `./units` (type) |
| `units.ts` | the viewer's distance unit, km or mi, kept in this browser: `useDistanceUnit`, `DISTANCE_UNITS`, `DEFAULT_UNIT`. Only the words change; everything else stays in km | `./ui/stored` |
| `theme.ts` | CSS theme tokens as deck.gl colours (ink, accent, casing, risk, the railroads) and the page font for the map's canvas text; `MapLine`, `CLASS_LINES`, `lineColor` | `shared/railroads` |
| `owner.ts` | `ownerOf`: Procor or UTLX, read from a shop's name or code | `shared/` (type) |
| `map/config.ts` | the map's camera and click numbers: pan bounds, zooms (`SHOP_ZOOM`: a shop being edited, with its own track), fly and fit times, the room kept round a framed route, pick radii, a shop link's dash, the phone query; the tile cache cap and the spare tile textures kept | nothing |
| `map/MapStage.tsx` | the one map: `MapStageProvider`, `MapStage`, `MapContent` (a scene, clicks, handles, the answer to the last click); layer choices (basemap and time of day kept in this browser) | `./MapCanvas` (lazy), `./scene`, `../data/basemap`, `../ui/stored` |
| `map/MapCanvas.tsx` | MapLibre + deck.gl + controls + legend (the heavy, lazily loaded half): the basemap look for the layer choices, the crosshair while a row's ⌖ is on (else grab, and a pointer on what a click selects), the place found with the panel's search, the answer to a click (`Flash`); every camera move framed in the map the panel leaves free; frees MapLibre's spare tile textures when idle | `./layers`, `./DeckOverlay`, `./FitBounds`, `./RealTracks`, `./MapControls`, `./MapHandles`, `./Flash`, `./FoundPin`, `./Legend`, `./basemaps`, `../theme` |
| `map/scene.ts` | `MapScene` and its builders (`planScene`, `shopsScene` with the edited shop's links: set, offered, a drag's preview, refused), `chosenRoute`, `pillAnchors`, `routePaths` / `withRoutePaths` (what runs on track, redrawn on the real track): what the map draws, as data | `../words`, `shared/` |
| `map/pills.ts` | `placePills`, `pillWidthPx`: where the route pills go on screen, beside the route lines and kept apart from each other, the pins and the legend (pure geometry) | |
| `map/RouteMarks.tsx` | `RouteMarks`: the route pills and turn-back discs as MapLibre markers, laid out with `placePills` when a move ends | `./pills`, `./RouteMarkFaces`, `./scene` (types), `../words`, `react-map-gl` |
| `map/MapHandles.tsx` | `MapHandles`: things a person drags or taps on the map (the edited shop's pin, its links' rings, the ＋ bud) as MapLibre markers; reports where a handle's face is dragged and dropped; Esc puts a dragged one back. Knows nothing of shops | `./RouteMarkFaces` (`useNativeClick`), `../ui/badges`, `../ui/useEscape`, `react-map-gl` |
| `map/Flash.tsx` | `Flash`: where a click on the map landed, a ring that pulses (set) or a red ✕ that fades (nothing there) | `./MapStage` (type), `react-map-gl` |
| `map/RouteMarkFaces.tsx` | `PillFace`, `TurnBackMark`, `useNativeClick` (a click on a mark never reaches the map): plain DOM, so page tests draw them without a map | `./pills` (type), `./scene` (type), `../words` |
| `map/layers.ts` | a scene as deck.gl layers (the network by class under the basemap's place names; the selected route by railroad, thin alternatives, pins, shop squares, the edited shop's links, dashed off the track and solid on it; no place names: the panel and the basemap have them); hover names; click targets (`sceneTarget`) and the grey route a click landed on (`lineAt`), where the stop snaps. The only file that names deck.gl layer classes | `./scene`, `./basemaps` (`LABELS`), `./config`, `../theme`, `../words`, `../data/basemap` (type) |
| `map/MapControls.tsx` | the layers button and its popover card (Map layer, Time of day and Distances, drawn by one row component; Rail network, Real tracks; Escape closes it), zoom, fit | `./MapCanvas` (type), `./daylight`, `../units`, `../ui/*` |
| `map/daylight.ts` | day and night: sun position and the subsolar point from the clock (no package), `mapLook` (Auto / Day / Night → day or night colours and the Day / Sunrise / Sunset / Night word, at the map centre) | `shared/geo` (type) |
| `map/nightTiles.ts` | the night side of the Earth per tile: `nightFactor`, `nightShade` (Black Marble where the sun is down, a soft twilight band, clear by day; Black Marble's no-data strip at 180° drawn as night ocean; pure), `sunRange` and `nightTileKind` (tiles wholly day or night skip the pixel maths), the `earthnight://` tile URL and its MapLibre loader | `./daylight`, `../data/blackMarble`, `maplibre-gl` (type) |
| `map/DayNight.tsx` | `NightLights`: the `earthnight://` raster layer over the basemap's ground and under `LABELS` (and so under the network), its opacity per basemap and mode, redrawn every 10 minutes in Auto; `BasemapStyle`: puts the basemap style on, diffing between the street looks so their tiles stay | `./nightTiles`, `./basemaps`, `../data/blackMarble` |
| `map/basemaps.ts` | the basemap styles: Satellite, and a quiet street map of our own over OpenFreeMap's tiles (`GROUND`: day and night colours; place names only; in Auto the Earth from space zoomed out), each look built once; `LABELS`, the bottom text layer of both, which the app's own layers go under; `carryOwnLayers` (the app's own layers kept across a switch between street looks) | `./config` |
| `map/DeckOverlay.tsx`, `FitBounds.tsx`, `RealTracks.tsx` | deck.gl drawn inside the map style (interleaved), told where the camera is once it has loaded; camera fit (also when a plan first gets its route); Real tracks (OpenStreetMap rail lines from OpenFreeMap vector tiles under `LABELS`, drawn from the street map's own source when it is shown) | `./basemaps` |
| `map/Legend.tsx` | `Legend`, `legendFor`: the selected route's railroads only (with no route, the lines of the classes drawn), and "↩ Turn-back" when it has one | `./scene` (type), `../theme`, `shared/railroads` |
| `screens/route/RouteWorkspace.tsx` | container for the route planner (desktop and phone): saved route from the URL, session, `usePlannedRoute`, the leg, stop or turn-back picked in the panel or on the map (picked in the panel, a stop or turn-back is flown to), the answer to a map click, scene, save | `./session`, `./RoutePanel`, `../../data/hooks`, `../../map/*`, `../../app/routes`, `../../ui/*` |
| `screens/route/session.ts` | the plan being worked on: the place list with undo history, which row's ⌖ is on, the missed click; `planReducer` (set, insert, remove, move, reverse as list operations; track and turning at stops), `nextTarget`, `placeAtEnd`, `stopInsertIndex`, `fullPlan`, `usePlanSession` (with a row's ⌖ on, click → snap to the line clicked or the nearest node → that row; ⌖ then moves to the next empty row) | `../../data/hooks`, `../../map/config`, `../../ui/useEscape`, `shared/` |
| `screens/route/RoutePanel.tsx` | the planner's panel: the bar (Route, Undo / Redo, the ⋯ menu: Reverse, Save, Copy route string, New); `PlaceList` (one card, a row per place: glyph, name over value, ⌖, × on hover, drag handle; then Add stop; a red edge says what is wrong); Route options (track classes, Turn at stops, the carrier from a place where several meet); the routes found when two or more; the result card (length, carriers, interchanges, a row per carrier leg, stop and turn-back that picks it on the map); Saved routes (the open one renamed in place; after Save route it opens on that row, lit once) | `./session`, `../../app/sheet`, `../../map/scene` (`chosenRoute`), `../../ui/*`, `../../words`, `../../format`, `shared/` |
| `screens/shops/ShopsScreen.tsx` | container: shops (narrowed by the panel's search, one selected and flown to), the form, the shop import; the edited shop's links with their undo history, the suggestion and a drag's preview (`useShopLinks`), a drop or a tap refined (`shopLinkAt`); the map's handles for the pin (red where no track is near), the rings and the ＋; the answer to a drop or a tap | `./ShopsPage`, `../route/session` (`History`, a type), `../../data/hooks`, `../../map/*`, `../../app/*` |
| `screens/shops/ShopsPage.tsx` | `ShopList` (count, Add shop, ⋯ with Import CSV; a row per shop: owner's mark, name, code, carrier dots, Edit), `ShopForm` (Undo / Redo of link changes, Name, Shop code, Location set on the map and shown as the place it is near), `ShopLinks` (Track links: a ring per link to press, ×, the suggestion's Use, ＋), `ImportPreview` ("update" on a row that replaces a saved shop), `useImport` | `../../ui/*`, `../../app/sheet`, `../../data/hooks`, `../../owner`, `shared/` |
| `ui/badges.tsx` | `RailroadChip`, `RailroadChips`, `Railroads`, `PlacePin` (the start a filled dot, a numbered stop, the destination a ring), `TurnBadge` | `shared/` |
| `ui/icons.tsx` | the icons, one stroke style: `Crosshair`, `Cross`, `Search`, `Undo`, `Redo`, `Plus`, `More`, `Check`, `Chevron`, `PanelIcon`, `Grip` | |
| `ui/combobox.tsx` | `moveActive`, `SuggestionList` (grouped under headings when asked): what the place inputs share | `shared/` (types) |
| `ui/ConfirmDelete.tsx` | the inline "Delete this …?" question | |
| `ui/useEscape.ts` | Escape anywhere turns a mode off | |
| `ui/segmented.ts` | `thumbAt`: where a segmented control's thumb sits | |
| `ui/popover.ts` | `usePopover`: one popover open in the whole page; a press outside it or Escape closes it | `./useEscape` |
| `ui/Menu.tsx` | `Menu`, `MenuItem`: ⋯ and a list's other actions; ✓ in place of ⋯ a moment after one worked | `./popover`, `./icons` |
| `ui/Accordion.tsx` | `Accordion`: a card that folds to a line saying what is in it | `./icons` |
| `ui/Switch.tsx` | `Switch`: an on/off row, the accent when on | |
| `ui/history.tsx` | `HistoryButtons`, `useHistoryKeys`: Undo and Redo while there is history, and Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | `./icons` |
| `ui/stored.ts` | `storedChoice`: a choice the viewer makes that this browser keeps, shared by every part of the page that shows it, held for the page while storage is refused | |
| `ui/reorder.ts` | `useReorder`: drag to reorder with momentum, rubber band and a settle spring; keyboard grab mode; FLIP slides | `./motion`, `react-dom` |
| `ui/motion.ts` | what every drag shares: rubber band, release speed, momentum projection, settle spring, reduced motion | |
| `ui/WhyTip.tsx` | `WhyTip`: on a touch screen, a tap on something marked wrong shows why (its tooltip) | |
| `ui/ErrorBoundary.tsx`, `ui/files.ts` | an error fallback; reading a chosen file as text | |
| `**/*.test.ts` | tests next to the code | |

Who may call data hooks: the two containers, `App`, and the input widgets `PlaceField` and `ShopForm`. Every other component takes props.

Two screens: Route (the planner) and Shops.

## `scripts/`

| File | Owns | May import |
|---|---|---|
| `update-network.ts` | the weekly network update (`npm run data:update`, run by `launchd/`): rebuild in a temporary copy, check, then replace `public/data` | `engine/index.ts`, `server/selftest`, `server/intake/csv`, `shared/` |
| `free-port.mjs` | frees the app's port before `npm run dev` and `npm start` | `node:` only |
| `sync-shops.ts` | `node scripts/sync-shops.ts <site>`: the site's shops made the same as this laptop's, with the write token from the macOS Keychain | `shared/places` (types), `server/config` |
| `architecture.test.ts` | the import rules the compiler cannot check; the ban on parameter properties and enums in Node-run code | `node:fs` |
| `copy.test.ts` | the wording rules for UI strings, messages, docs, comments and test names: no em dash aside, no "not a ..." | `node:fs` |

## `tests/`

| File | Owns |
|---|---|
| `fixtures.ts` | the EXAMPLE shops the API, screen and browser tests add to their empty databases |
| `harness.ts` | `startTestApp`: the real back end on a temp folder (with the EXAMPLE shops) and a free loopback port |
| `api.test.ts` | the API end to end over HTTP, one block per screen's needs, plus restart |
| `screens.test.tsx` | the planner and Shops rendered from the real back end's answers |
| `map-look.test.ts` | the railroad colours: told apart from each other and from the grey of routes not selected (CIEDE2000, also with simulated colour-blind vision), by day and by night; against the grounds they are drawn on; the night tokens against the dark theme |
| `e2e/*.spec.ts`, `e2e/app.ts` | the browser tests against the real app (Playwright, port 8797; projects: a laptop in Chrome, `phone.spec.ts` on an iPhone in WebKit and an Android phone in Chrome) and what they share |

## Data

| Path | Notes |
|---|---|
| `pipeline/run_all.sh`, `download_narn.py`, `build_graph.py`, `export_web_graph.py`, `export_basemap.py`, `places.py`, `railroad_classes.py` | the producer of `public/data/`; `railroad_classes.py` holds `CLASS1`, `LINES` and `CARRIER_COLS` once; `places.py` downloads the GeoNames towns (`MIN_POPULATION`) and writes them into `graph_meta.json`, largest first. `graph_meta.json` records `lines`, which the engine checks against `shared/railroads.ts` when it loads the network |
| `public/data/graph.bin`, `graph_meta.json`, `track.bin`, `basemap_mainline.geojson` | read by `engine/load.ts` (first three) and by the page (the last) |
