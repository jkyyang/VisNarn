# VisNARN — Shop Arrival Check

Will repair preprocessing at the shop finish before the railcar gets there?
A local tool for one laptop: give a car's position (between node A and node B), its destination shop and the
prep end time; it routes the car over the Class I network, estimates arrival, and flags cars that may arrive
before prep ends. One car on the Route screen, a morning list on the Cars screen, your own shops on the Shops screen.

> ETA numbers (speed, interchange delay, buffer) are **placeholders** until calibrated from history.
> Read [docs/architecture/RATIONALE.md](docs/architecture/RATIONALE.md) and [docs/architecture/MODULE_MAP.md](docs/architecture/MODULE_MAP.md) first.

## Run
```
npm install
npm run dev        # one command, one port: http://127.0.0.1:8787 (API + page from source, hot reload)
npm start          # build the page, then serve it and the API on http://127.0.0.1:8787
npm run selftest   # quick check: loads the network, starts a routing worker, routes the EXAMPLE car
npm test           # vitest: engine, server, page, and the import rules
npm run typecheck  # tsc -b: one program per area; an import across areas fails here
npm run test:e2e   # Playwright in the installed Chrome: every screen against the real app (port 8797, throwaway data)
```
The browser tests build the page, start the app on 127.0.0.1:8797 with an empty data folder in the
system temp folder (never `~/.visnarn`), and save a screenshot of each screen to `docs/screenshots/`.
Node 23.6 or newer (the server runs its TypeScript sources directly). No build step for the server.
In development Vite runs inside the Node server (middleware mode), so the page, `/api` and hot reload
share one origin. The server restarts by itself when a file in `server/`, `engine/` or `shared/` changes.

Settings (environment variables): `VISNARN_PORT` (default 8787), `VISNARN_DATA_DIR` (default
`~/.visnarn`), `VISNARN_ROUTE_WORKERS` (default 2: batch checks use at most one of them, so a click on
the Route screen never waits behind the morning list).

The database is `~/.visnarn/visnarn.db`. The server listens on 127.0.0.1 only and refuses requests
addressed to any other host name or sent from another web page. Car data never leaves the laptop;
map tiles and fonts are fetched from public servers.

Network files in `public/data/` are committed. To rebuild them from public sources (BTS NTAD NARN):
```
npm run data       # needs python3; creates .venv and runs pipeline/run_all.sh
```

## Layout
- `shared/` — the words both sides use: places, cars, routes, assumptions, and the HTTP contract (`api.ts`)
- `engine/` — rail network, router, verdict. Pure logic; the server and the backtest use it through `engine/index.ts`
- `server/` — the back end: database (`store/`), places (`places/`), routing workers (`routing/`), cars (`cars/`), company data in (`intake/`), HTTP (`http/`)
- `web/` — the page: screens (`screens/`), map (`map/`), server data (`data/`)
- `scripts/` — `backtest.ts` and the import-rule test
- `tests/` — the API over HTTP and the screens rendered from real answers
- `pipeline/` — Python: download NARN lines, build the graph, export `public/data/graph.bin`

## Map sources (free, no key)
OpenFreeMap vector styles (OpenStreetMap data), Esri World Imagery for satellite, OpenRailwayMap overlay.
Check each provider's terms before production use (Esri imagery needs an ArcGIS account for commercial apps).

## Known limits
Shortest-distance routing is not the railroads' real operating plan; only Class I track (short lines and spurs
mostly missing); coordinates snap to Class I mainline within 15 km.
