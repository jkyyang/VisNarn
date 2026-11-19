# VisNARN: Shop Arrival Check

Stage 1: a route planner over the North American rail network (Class I, regional, short line and passenger track), for one laptop. Type a start and a destination, shop
or station, or set each with its ⌖ and a click on the map, and a route appears; Add stop adds a row for a stop the
route must pass through, set the same way. Choose the line where several meet, pick between the alternatives, and save the route with a
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
`~/.visnarn`), `VISNARN_ROUTE_WORKERS` (default 2), `DATABASE_URL` (a PostgreSQL server in place of the data folder).

On a laptop the database is PostgreSQL inside the server process (PGlite), in `~/.visnarn/postgres`. Its first start
copies in the shops, shop links and saved routes of an older `~/.visnarn/visnarn.db` (SQLite) and leaves that file as it was.
The server listens on 127.0.0.1 only and refuses requests addressed to any other host name or sent from another web page.
Your shops and routes stay on the laptop; map tiles and fonts are fetched from public servers.

## Deploy
Vercel (Hobby) for the page and the API, Neon (Free) for the database, open to anyone with the link and read-only:
it plans routes and opens saved ones, and shows nothing that would change them. `node scripts/sync-shops.ts <site>`
copies this laptop's shops there. See [docs/deploy/vercel.md](docs/deploy/vercel.md).

Network files in `public/data/` are committed. To rebuild them from public sources (BTS NTAD NARN, and GeoNames
for the town names that label places):
```
npm run data       # needs python3; creates .venv and runs pipeline/run_all.sh
```

## Layout
- `shared/`: places, plans, routes and the HTTP contract (`api.ts`)
- `engine/`: rail network and router, used through `engine/index.ts`
- `server/`: database, places, routing workers, plans, shop import, HTTP, the Vercel function
- `api/`: the Vercel function's entry (one line)
- `web/`: screens, map, server data
- `scripts/`: weekly network update, shop sync to the site, free-port, import rules test
- `tests/`: the API over HTTP, the screens, the browser tests
- `pipeline/`: Python that downloads NARN and GeoNames and writes `public/data` (graph.bin, graph_meta.json with the places, track.bin, basemap)

## Map sources (free, no key)
OpenFreeMap vector styles (OpenStreetMap data) for the map and the Real tracks overlay, Esri World Imagery for
satellite, NASA Black Marble for night lights. Place names: GeoNames (CC BY 4.0), US, Canadian and Mexican towns
of 5,000 people or more, built into `graph_meta.json`; no lookup online while the app runs.

## Routing
Routes follow track distance and the carriers you choose. A typed coordinate snaps to nearby mainline; a shop with track links joins the network at its links.
