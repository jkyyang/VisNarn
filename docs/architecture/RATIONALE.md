# Shop Arrival Check, full stack: design rationale (candidate 2)

Status: **sketch**. Types, signatures and module boundaries are meant to be final. Bodies throw `not implemented`.
The file-by-file map is in [MODULE_MAP.md](MODULE_MAP.md).

## Problem

Today everything runs in the browser: the rail graph, the router, the check, and all state. The user wants
a full app: the five canvas screens (Route, Cars, Fix route, Shops, Phone) on top of a back end that owns
the data (shops, car batches, node codes, route fixes), serves routing and arrival checks, and takes
company data by CSV now and from a database later. Five facts from the grounding make the shape non-obvious:

1. **No stable identity (稳定标识).** The engine addresses nodes by index, and an index changes every time `graph.bin` is rebuilt. Anything saved or sent must use an FRA id, coordinates, or a name the user owns.
2. **Names collide.** `graph.resolve` tries FRA ids before anything else, and company codes (SPLC, FSAC) are also digits. A longer fallback chain would resolve codes to the wrong node without any error.
3. **The router is heavy.** It is about 52 MB, synchronous, and not re-entrant (不可重入). A search blocks its thread for up to 0.3 s.
4. **Results go stale easily.** A verdict depends on the report, the shops, the code sets, the fixes, the assumptions and the network file. Any stored result would have to be invalidated when any of them changes.
5. **Node runs the sources directly** (type stripping, 类型擦除). That needs `.ts` import extensions and forbids parameter properties and enums. TypeScript 5.6 cannot flag those.

Constraints kept: one laptop, loopback only, no login, no new runtime dependency, real car data never leaves the machine.

## Usage (caller's view)

Written first. The types in the sketch were derived from these call sites. Call sites 1, 2, 3 and 5 are taken from files that compile in this tree; 4 shows the shape of a future adapter.

**Quickstart**

```
npm run dev        # one command: API on 127.0.0.1:8787 (node --watch), page on 127.0.0.1:5173 (Vite, proxies /api)
npm start          # built page + API together on 127.0.0.1:8787
npm test           # vitest: engine, server, page, import rules
npm run typecheck  # tsc -b: one program per area; an import across areas fails
```

**1. A screen reads the morning list** (`web/screens/cars/CarsScreen.tsx`). No route strings, no `fetch`, no job to start.

```tsx
const view = useBatchView(batchId);               // reads again while the server is still routing rows
const row = useBatchCar({ batchId, row: selectedRow });
const check = useCarCheck(row.status === "ready" ? { report: row.data.report, asOf: row.data.batch.asOf } : null);
const scene = fleetScene(view.data.cars, selectedRow, checked);
```

**2. Check a car and fix its route** (`web/screens/route/RouteWorkspace.tsx`). One read gives the verdict for a typed car and for a batch row, with stops and without.

```tsx
const car = useCarSession(screen.car, row);       // form draft, stops and their undo history (view state)
const check = useCarCheck(car.report && { report: car.report, asOf });
const before = useCarCheck(fixing && car.baseline ? { report: car.baseline, asOf } : null);   // "Before" column
await saveFix(rowKey, car.session.stops.present); // "Use for this batch row"
```

**3. The server's side of the contract** (`server/http/handlers.ts`). One line per route. A route missing here, or returning the wrong type, does not compile.

```ts
export const handlers: Handlers = {
  "GET /api/batches/:batchId": ({ params }, { app }) => app.checks.batch(batchId(params.batchId)),
  "POST /api/check": ({ body }, { app, signal }) => app.checks.car(body.report, body.asOf, signal),
  "PUT /api/shops/:shopId": ({ params, body }, { app }) => app.shops.save(body, shopId(params.shopId)),
  // … 21 more
};
```

**4. A new company data source** (`server/intake/intake.ts`). The database later is one more `RecordSource`. The readers, the store and the API do not change.

```ts
export function synapseSource(query: SavedQuery): RecordSource {
  return { info: { kind: "database", label: query.name }, records: () => rowsOf(query) };   // header → text, like the CSV source
}
```

**5. The backtest uses the engine alone** (`scripts/backtest.ts`). No HTTP, no database.

```ts
const router = createCarRouter(loadNetwork());
const result = router.route(trip, "pick");        // stable ids in, stable ids out
if (result.ok) travelHours(result.path.km, result.path.interchanges, timing);
```

**The HTTP contract** (`shared/api.ts`, 24 routes). Requests and answers are the domain types themselves.

| Resource | Routes | Carries |
|---|---|---|
| Meta, settings | `GET /api/meta` · `GET, PUT /api/assumptions` · `GET, PUT /api/import-profile` | `Meta`, `Assumptions`, `ImportProfile` |
| Places | `GET /api/places/suggest` · `POST /api/places/resolve` · `GET /api/places/nearest` | `PlaceSuggestion[]`, `PlaceResolution`, `NetworkNode \| null` |
| Shops | `GET, POST /api/shops` · `PUT, DELETE /api/shops/:shopId` · `POST /api/shops/import` | `ShopDraft` → `ShopView`, `ImportReport<ShopView>` |
| Node codes | `GET /api/codes` · `POST /api/codes/import` · `DELETE /api/codes/:codeType` | `CodeSet[]`, `ImportReport<NodeCode>` |
| Batches | `GET, POST /api/batches` · `GET, DELETE /api/batches/:batchId` | `BatchUpload` → `Batch`, `BatchView` |
| Batch rows | `GET /api/batches/:batchId/cars/:row` · `PUT, DELETE …/fix` | `BatchCar`, `{ stops }` → `SavedFix` |
| Check | `POST /api/check` | `{ report: CarReport, asOf }` → `CarCheck` |

## Shape

```
 browser                                  Node (one process, 127.0.0.1 only)
 ┌────────────────────────────┐   HTTP    ┌─────────────────────────────────────────────────┐
 │ web/screens  (5 screens)   │  /api/*   │ server/http    match · decode · handler · encode │
 │ web/map      (one map)     │ ────────► │ server/cars    batches · checks                   │
 │ web/data     hooks, cache  │           │ server/places  Directory · shops · codes          │
 └────────────┬───────────────┘           │ server/intake  CSV now, database later            │
              │ types only                │ server/store   node:sqlite  (~/.visnarn)          │
              ▼                           │ server/routing planner ──► worker thread(s)       │
        shared/  ◄──────────────────────── │                              └ engine: router     │
   domain types + API contract            └──────────────┬──────────────────────────────────┘
                                                          ▼
                                                engine/  network · trip · verdict   (also: scripts/backtest.ts)
```

### The decisions the task asked for

| Question | Decision |
|---|---|
| Where the router runs | **On the server, in a worker thread (工作线程)**. `engine/` is a library used by the routing worker and by the backtest. The browser holds no graph and no router: only the static mainline GeoJSON for drawing. |
| Source of truth: shops, code sets, batches, fixes, assumptions, import profile | **SQLite, through `server/store`**. Fixes are an append-only table; the fix in force is the latest one not reverted. |
| Source of truth: routes and verdicts | **Nowhere. They are derived (派生) on request.** Routes are cached in memory by the planner; verdicts are recomputed from the cached route every time. |
| Source of truth: which screen, car, option, filter | **The URL** (`web/app/routes.ts`, a `Screen` union). |
| Source of truth: form draft, unsaved stops, undo history, pick mode | **`useCarSession`** in the browser's memory. Map layer choices: `MapStage`. |
| API | **One typed table, `Api`**, from which the handler table, the decoders and the client are all typed. Answers are domain types, which are plain JSON by construction. |
| Company data | **One door: `server/intake`**. A `RecordSource` yields `header → text` records; readers turn them into `CarReport`, `ShopDraft`, node codes plus a list of issues. Column names, code set and time zone come from a saved `ImportProfile`. |
| Persistence | **`node:sqlite`** at `~/.visnarn/visnarn.db`, outside the repo, `public/`, `dist/` and `~/Documents`. JSON text for nested values, columns only for what is looked up. |
| Front-end data | **Named hooks over a small query cache**. No optimistic updates (乐观更新). A write is awaited, then every cached read is marked stale and the mounted ones refetch. The batch list polls while rows are pending. |
| Tests | Unit tests next to the code in each area; `tests/` drives the real server over HTTP and renders the five screens from its answers; `scripts/architecture.test.ts` checks the import rules. |
| Dev | **`npm run dev`** starts the API (`node --watch`) and Vite. No build step for the server. |

### Data structures first

- **`PlaceRef`** (`shared/places.ts`): how a location was given. `text | shop | code | node | coord`. It is stored and sent as given and resolved again at every check. So importing a code set or adding a missing shop repairs old batch rows without a new upload.
- **`CarReport`**: car id, `a`, `b`, `shop` (PlaceRefs), `stops`, two `Instant | null` times. The single input of a check, for a typed car and a batch row alike.
- **`RoutePath` vs `RouteOption`** (`shared/route.ts`): a path is track only, with no clock in it. An option is that path under the current times and assumptions (steps with rough arrival times, and a `Verdict`). The planner caches paths; `judge` turns them into options. This is the split that makes a speed change free.
- **`Assumptions`** in three groups: `routing` (decides the path), `timing` (decides the clock), `flags` (decides what goes to "Check first"). The cache key is built from `routing` only.
- **`CarCheck = CannotCheck | CheckedCar`**: a car that cannot be checked has problems and no verdict. A checked car has `options: [RouteOption, ...RouteOption[]]`, pick first.
- **`CarSummary`**: one list line, no geometry, with its `group` decided on the server.

Access patterns, traced through these:

| Pattern | Path |
|---|---|
| Open the list | rows → Directory (memoised per store revision) → `planner.peek` → `judge` → `summarize`. Rows not routed yet come back `pending` and are queued. |
| Change speed, delay, buffer, thresholds | same path; every `peek` hits; no routing. |
| Change allowed railroads or penalty, move a shop, save a fix | the trip's key changes, so the planner is asked under a new key. Old queued work is aborted. |
| Select a car | `GET …/cars/:row`, then `POST /api/check` with `"all"` strategies (three more searches, cached). |
| Add a stop | the session's report changes, so `useCarCheck` asks again; the previous answer stays on screen, marked stale. |
| Click the map | `GET /api/places/nearest` (about 0.2 ms of work on loopback). |

### Load-bearing decisions

1. **One resolver, on the server** (`server/places/directory.ts`). Each list is its own namespace (命名空间): a `code` ref is looked up in its code set and nowhere else; free text goes through lists in an order fixed per role; a bare number is never an FRA id. Because shops and codes live in the database, a second resolver in the browser would be a second copy of this policy. Per **single source of truth**.
2. **Checks are derived, not stored.** Reading a batch is what starts its checking, and reading again finds more rows done. There is no job to create, poll, or cancel, and nothing to invalidate. Per **derive instead of sync** and **make operations idempotent (幂等)**.
3. **Domain types are the wire types.** Times are `Instant` strings, places are stable ids, there is no `Date`, `Map` or index in any type. `shared/api.ts` has a compile-time check that every answer is plain JSON. So there is no DTO layer and no mapper pair per type to keep in step.
4. **Indexes stay inside `engine/core`.** `engine/trip.ts` converts FRA ids to indexes on the way in and back on the way out. `FraId` is a branded number, so an index cannot be passed where an id is expected.
5. **One map for the whole app.** `MapStage` creates MapLibre once; a screen declares what to show with `<MapContent scene=… />`. Fix route forces Real tracks on through a prop, without owning the layer state.
6. **Node runs the sources.** Every relative import carries `.ts`; `verbatimModuleSyntax` is on; the architecture test rejects parameter properties and enums in Node-run areas.

### Invariants encoded in types

| Invariant | How |
|---|---|
| "Cannot check" never shows as "On time" | `CannotCheck` has no `verdict` field |
| A graph index never leaves the engine | `FraId` brand; only `engine/core` has indexes; import rule test |
| A time always has a zone | `Instant` brand; `readTime(text, rule)` returns an Instant or a reason |
| A timing change cannot re-route | `Trip.rules` is `Assumptions["routing"]`; `judge` takes the rest |
| There is always a route to show for a checked car | `options: [RouteOption, ...RouteOption[]]` |
| Every route has a handler and a decoder | `Handlers` and `decodeBody` are mapped types over `Api` |
| A write cannot be issued as a read | `ReadRoute` / `WriteRoute` split the routes by type |
| The server is not reachable from the network | `LOOPBACK` is a constant; `serve()` has no host option |
| Links cannot drift from routes | links are built from `Screen` values with `hrefFor` |

**Validation** lives at three edges and nowhere else: `server/http/decode.ts` (JSON → domain), `server/intake` (company records → domain rows plus issues), and the form (`fromLocalInput`, `PlaceField`). Past them, code trusts its types. Per **boundary-discipline**.

**Deliberately not done**: no login, no hosting, no stored results, no results CSV or route JSON export (not on the canvas), no drag-to-reroute, no live tracking, no second code path for "one car" versus "batch row".

### Interface depth

| Module | Public surface | What it hides |
|---|---|---|
| `engine/index.ts` | `loadNetwork`, `createCarRouter().route`, `combine`, `tripKey`, `judge` + 4 small functions | binary layout, indexes, Dijkstra over 6.5 M states, turn and yard rules, strategy costs, leg splitting, turn-back facts |
| `Directory` | `resolve`, `suggest`, `nearest` | three namespaces, role order, ambiguity, snapping, memo per store revision |
| `RoutePlanner` | `plan`, `peek`, `close` | worker threads, priority queue, in-flight sharing, cache and eviction, crash recovery |
| `Checks` | `car`, `batch` | composition of the three "no" answers, pending rows, background generations, list order |
| `Store` | 23 domain methods in five groups | schema, SQL, JSON columns, transactions, the idempotency rules, the revision counter |
| `web/data/hooks.ts` | 11 reads, 1 one-off read, 11 changes | routes, URLs, the cache, polling, abort, error mapping |
| `MapStage` | `MapStageProvider`, `MapStage`, `MapContent` | MapLibre, deck.gl, lazy loading, layer state, camera, picking |

`Store` is the widest. It is wide because it is the whole persistence port. Its methods are domain operations, not table access. The named hooks forward to `useQuery`, and that forwarding is the boundary: it is where transport names become the page's vocabulary.

### Component tree

```
App                          MapStageProvider · panel · MapStage (one map for every screen)
├─ AppHeader · ModeTabs      Route | Cars (act-now count) | Shops         [Route and Cars]
├─ RouteWorkspace            container for Main, Phone and Fix route: session + check + scene
│  ├─ RoutePanel             Main / Phone (compact under 640 px)
│  │  ├─ CarForm             PlaceField ×3 (A, swap, B, shop) · Add stop · times · report age
│  │  ├─ VerdictCard | CannotCheckCard      headline · pills · two bounds · margin · AssumptionChips
│  │  ├─ RouteOptions        one card per option · tags · turn-back alert → Fix route
│  │  ├─ StepsChain          A · "car is somewhere here" · B · legs / changes / turn-backs / stops · shop
│  │  └─ SpreadPreview       "after calibration", static
│  ├─ FixPanel               BackHeader · problem step · stops · What changed · Use for this batch row
│  └─ MapContent             PickPrompt · WhichLine · JunctionInspector · DeltaBalloon · undo / redo
├─ CarsScreen                container: batch view (polls) + selected row's check
│  ├─ CarsPanel              batch header · parse summary · count chips · shop filter · Copy at-risk · CarRow groups
│  ├─ UploadBatch            file · name · as of · import profile
│  └─ MapContent             CarCard
└─ ShopsScreen               container
   ├─ BackHeader · ShopTable · ShopForm
   ├─ ShopImportCard · CodeImportCard (the one piece of UI not on the canvas)
   └─ MapContent             pick a shop's location
```

Containers (`*Screen.tsx`, `RouteWorkspace.tsx`) and three input widgets (`PlaceField`, `ShopForm`, `UploadBatch`) call data hooks. Everything else is props in, markup out, so it renders from fixtures.

### How tests cover it

| Layer | Where | How |
|---|---|---|
| Search rules | `engine/core/core.test.ts` | kept from today, on the real network (11 tests, passing) |
| Engine contract | `engine/trip.test.ts`, `engine/verdict.test.ts` | stable ids only, strategies, turn-back facts, flags, triage |
| Namespace rules | `server/places/directory.test.ts` | "a six-digit code never resolves as an FRA node" |
| Store, intake, checks, planner | next to each module | `:memory:` database; real worker threads |
| **API** | `tests/api.test.ts` | real server on a free loopback port, driven through the page's own transport, typed by `Api` |
| **UI** | `tests/screens.test.tsx` | the five screens rendered to HTML from the real server's answers |
| UI decisions | `web/**/*.test.ts` | reducer, list functions, URL round trip, scene, words: plain functions |
| Boundaries | `npm run typecheck`, `scripts/architecture.test.ts` | compiler for areas; import rules for internals |

There is no browser test yet. Clicks, WebGL drawing and tile loading are not covered by anything above.

### Red-flag screen

| Flag | Result |
|---|---|
| Shallow module | Surfaces are in the table above. `Store` is wide by nature; noted. |
| Information leakage | Schema only in `sqlite.ts`; indexes only in `engine/core`; routes only in `server/http` and `web/data`; group policy only in `engine/verdict.ts`. |
| Temporal decomposition | Server modules are named for what they know (places, routing, cars, intake, store), not for a stage. |
| Pass-through | Handlers and named hooks forward on purpose: each is a transport edge that adapts names and ids. |
| Split ownership | Fixed during the screen: the session no longer copies saved stops or the batch time; the page no longer decides groups. |
| Two ways | One resolver, one way to get a `CarCheck`. Exception accepted: two typecheck commands (see tradeoffs). |
| Importable internals | Areas by the compiler (TS6307, tested). `engine/core`, `node:sqlite`, `node:http`, `shared/api.ts`, `web/data/query.ts` by the import rule test (tested with deliberate violations). |
| Hand-synced lists | Routes, decoders, labels and areas are derived or compile-checked. Route tags were removed: a path's tags are the strategies that found it. Railroad order (Python and TS) is checked when the network loads. |

## Synthesis decision

Arena with two runners (Opus xhigh, Fable xhigh) in isolated copies; cross-judge skipped because the configured judge pool has
only Claude models (same family as the picker). Both candidates converged on the same big shape: server-only router in worker
threads, thin browser, SQLite for user-owned data only, verdicts derived on every read, one typed endpoint table, content-hashed
batches, append-only fixes, polling. That convergence is taken as strong agreement.

**Base: candidate 2 (this sketch).** It encodes more invariants in types (`CannotCheck` has no verdict; `Assumptions` split into
routing / timing / flags so a timing change cannot re-route; `Instant` and `FraId` brands), keeps derived data in memory only
(no second database file), stores places as `PlaceRef` exactly as given so later code imports repair old rows, and has an
`ImportProfile` that owns column names and the zone rule.

**Grafted from candidate 1** (to be applied during implementation):
1. One process in dev: Vite in middleware mode inside the Node server (one port, no proxy), replacing the two-process `scripts/dev.ts`.
2. Two routing workers by default with lanes: interactive work first, batch work may use at most `workers - 1` threads, so a click never waits behind a list.
3. A boot self-test that starts `node server/main.ts --selftest` from a test, because vitest's esbuild accepts syntax Node rejects.
4. Local-only HTTP rules: `Host` must be loopback (blocks DNS rebinding), writes need `application/json` and a same-origin `Origin`, `Cache-Control: no-store`, request bodies never logged.
5. An RFC 4180 CSV parser (quoted newlines, doubled quotes).

**Rejected from candidate 1:** a persisted plan cache (`plans.db`) and its `PLAN_FORMAT` key (a second derived store to keep
valid); the global `X-Data-Rev` header (candidate 2's "refetch mounted reads after any write" gives the same result with less
protocol); the `auto` namespace with a 2 km agreement rule (candidate 2's per-role order with a bare number never read as an FRA
id is simpler and equally safe).

## Tradeoffs accepted

- We accept **a loopback request for every suggestion, hint and map click** in exchange for one resolver and no graph in the browser. If the tool is ever hosted remotely, that latency becomes visible.
- We accept **routing again after a server restart** (seconds for a regional list, a minute or two for hundreds of continental cars, shown as progress) in exchange for no derived data on disk and no stale-cache rule.
- We accept **refetching every mounted read after any write** in exchange for having no list of which write affects which read.
- We accept **polling every 400 ms while rows are pending** in exchange for not managing a streaming connection.
- We accept **`Instant` strings in domain types** (arithmetic needs `new Date(instant)` at the use site) in exchange for having no DTO layer.
- We accept **a hand-written URL router and query cache** (roughly 60 and 120 lines) in exchange for no new dependency. If the cache grows needs, TanStack Query fits behind `web/data/hooks.ts` without touching a screen.
- We accept **one routing worker by default** (about 70 MB) in exchange for a small footprint. The pool size is a setting.
- We accept **three extra searches when a car is opened** (alternatives) in exchange for never computing them for the list.
- We accept **JSON text columns** (no SQL query inside a place) in exchange for a schema that does not change when the code format becomes known.
- We accept **`.ts` on every import and no enums or parameter properties** in exchange for a server with no build step.
- We accept **two typecheck commands**. `npx tsc --noEmit` checks the whole repo as one program, so the habitual command is a real check. `npm run typecheck` (`tsc -b`) is the strict one, per area. A solution-style root would make the habitual command pass while checking nothing.
- We accept **`noUnusedParameters` off during the sketch** because bodies throw. Turn it back on when they are filled in.
- We accept **sentences built in the browser** (`web/words.ts`) in exchange for the server sending facts only. The copied at-risk text is therefore not available from the API.

## Alternatives considered

- **Thick client: keep the router in the browser, make the server a store.** It is the smallest migration, and checks stay synchronous. It lost on interface depth: the page would have to hold the engine, a copy of shops and code sets to resolve against, and a rule for when its graph and the server's saved data disagree. A few hundred cars would block the page's thread or need a 52 MB router per tab in a web worker. It also does not match the request that the back end serve routing and checks.
- **Explicit jobs with stored results** (`POST /jobs`, poll, read results from a table). This is the usual shape for long work, and it survives restarts. It lost because stored results are a second source of truth: every caller must start, poll and fetch, and every change to a shop, a code set, a fix, an assumption or the network file needs an invalidation rule. It hides less and exposes more.
- **Separate wire types with mappers** (a DTO per domain type). It hides the domain from the transport. It lost because, with about 25 types, it creates 25 pairs to keep in step by hand, and the domain types here are already JSON by construction.

## Open questions and risks

1. **Tight cars.** Should a Tight car with no route flag go to "Check first" (the sketch's default, in `triage`) or to "OK"? The mockup only shows Tight together with a route flag.
2. **Thresholds.** Detour 1.5×, position age 48 h, buffer 24 h are guesses. Should every turn-back flag the route, or only some?
3. **Time zones.** Until the export's zone is known, should zone-less times be rejected, or read in the laptop's zone (the sketch's default profile, which keeps today's behaviour)?
4. **Fix scope.** A fix belongs to one batch row. Should a fix be offered again for the same lane (A, B, shop) next morning? The table keeps the stops as stable ids, so this can be added without migration.
5. **Pinning an alternative.** A person can add stops, but cannot say "this row runs the UP option". Is that needed, or are stops enough?
6. **Node codes.** Which code type does the company use, and is there a station table with coordinates? The code-set import card is the only UI not on the canvas: is a card on the Shops screen the right place?
7. **Existing ETA.** If Synapse or CPS already holds a railroad ETA, should `CarReport` carry it and the verdict prefer it? That would bypass the planner for those cars.
8. **Batch retention and size.** How long are batches kept, and how many cars does a morning list have? Hundreds of continental cars suggest two or three workers.
9. **Phone.** The server listens on 127.0.0.1, so a real phone cannot reach it. Is "Phone" a narrow window on the laptop for now, or must the tool be reachable on the local network (which needs a login first)?
10. **Third parties.** Map tiles and fonts are fetched from OpenFreeMap, Esri, OpenRailwayMap and Google Fonts. They see map viewports, not car rows. Is that acceptable, and should fonts be bundled?
11. **Database location.** Is `~/.visnarn` acceptable, given that `~/Documents` may sync to a cloud drive?
12. **Interchange limit.** Routes needing more than 3 interchanges return "no route" (fixed when the router is built). Is 3 enough for the company's lanes?
13. **Shop dwell.** Where should the destination dwell term (1 to 3 days) live once it is wanted: per shop, or in the assumptions?

Risks:

- `node:sqlite` is experimental in Node 25. The schema is small and lives in one file, so a move to another driver touches `sqlite.ts` only.
- Nothing has been seen in a real browser. The map slot pattern (`MapContent`), the picking flow and the phone layout are the least proven parts.
- The Vite proxy, `node --watch` and the worker under vitest were reasoned about, not run. What was run: the area typecheck with deliberate violations, a worker thread with a `.ts` entry under Node 25.6.1, and the engine core routing under plain `node`.
- TypeScript 5.6 cannot flag non-erasable syntax. The architecture test covers the common cases with patterns; TypeScript 5.8's `erasableSyntaxOnly` would cover all of them.

## Next implementation step

Fill `createCarRouter().route` for the `"pick"` strategy and wire `POST /api/check` through `serve` → `checks.car` → planner worker, driven by the first test in `tests/api.test.ts` on the EXAMPLE car.
