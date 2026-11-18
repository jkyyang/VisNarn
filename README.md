# VisNARN: Shop Arrival Check

Stage 1: a route planner over the North American rail network (Class I, regional, short line and passenger track), for one laptop. Click (or type) a start and a
destination, shop or station, and a route appears; each further click adds a stop the route must pass
through. Choose the line where several meet, pick between the alternatives, and save the route with a
name. Your own shops are on the Shops screen. Stage 1 shows no dates, times or cars.

> Read [docs/architecture/MODULE_MAP.md](docs/architecture/MODULE_MAP.md) first.

## Run
```
npm install
npm run dev        # one command, one port: http://127.0.0.1:5173 (API + page from source, hot reload)
npm start          # build the page, then serve it and the API on http://127.0.0.1:5173
npm run selftest   # quick check: loads the network, starts a routing worker, routes one EXAMPLE trip
npm test           # vitest: engine, server, page, and the import rules
npm run typecheck  # tsc -b: one program per area; an import across areas fails here
npm run test:e2e   # Playwright in the installed Chrome: every screen against the real app (port 8797, throwaway data)
```
The browser tests build the page, start the app on 127.0.0.1:8797 with an empty data folder in the
system temp folder (never `~/.visnarn`), and save a screenshot of each screen to `test-results/screenshots/`.
Node 23.6 or newer (the server runs its TypeScript sources directly). No build step for the server.
In development Vite runs inside the Node server (middleware mode), so the page, `/api` and hot reload
share one origin. The server restarts by itself when a file in `server/`, `engine/` or `shared/` changes.

Settings (environment variables): `VISNARN_PORT` (default 5173), `VISNARN_DATA_DIR` (default
`~/.visnarn`), `VISNARN_ROUTE_WORKERS` (default 2).

The database is `~/.visnarn/visnarn.db`. The server listens on 127.0.0.1 only and refuses requests
addressed to any other host name or sent from another web page. Your shops and routes never leave the laptop;
map tiles and fonts are fetched from public servers.

Network files in `public/data/` are committed. To rebuild them from public sources (BTS NTAD NARN):
```
npm run data       # needs python3; creates .venv and runs pipeline/run_all.sh
```

## Layout
- `shared/`: places, plans, routes and the HTTP contract (`api.ts`)
- `engine/`: rail network and router, used through `engine/index.ts`
- `server/`: database, places, routing workers, plans, shop import, HTTP
- `web/`: screens, map, server data
- `scripts/`: weekly network update, free-port, import rules test
- `tests/`: the API over HTTP, the screens, the browser tests
- `pipeline/`: Python that downloads NARN and writes `public/data` (graph.bin, track.bin, basemap)

## Map sources (free, no key)
OpenFreeMap vector styles (OpenStreetMap data) for the map and the Real tracks overlay, Esri World Imagery for
satellite, NASA Black Marble for night lights.

## Routing
Routes follow track distance and the carriers you choose. A typed coordinate snaps to nearby mainline; a shop with track links joins the network at its links.
