# Shop Arrival Check: design rationale

Stage 1 is a route planner over the North American rail network: places in travel order, the routes the
network has between them, and your own shops. This page says why the code has the shape it has.
`MODULE_MAP.md` says where each part lives.

## Shape

```
 browser                                  Node (one process, 127.0.0.1 only)
 ┌────────────────────────────┐   HTTP    ┌─────────────────────────────────────────────────┐
 │ web/screens  Route, Shops  │  /api/*   │ server/http    match · decode · handler · encode │
 │ web/map      one map       │ ────────► │ server/plans   route a plan · saved routes       │
 │ web/data     hooks, cache  │           │ server/places  Directory · shops                 │
 │ web/ui       shared kit    │           │ server/intake  shop CSV                          │
 └────────────┬───────────────┘           │ server/store   node:sqlite  (~/.visnarn)         │
              │ types only                │ server/routing planner ──► worker thread(s)      │
              ▼                           │                              └ engine: router    │
        shared/  ◄─────────────────────── └──────────────┬──────────────────────────────────┘
   domain types + API contract                           ▼
                                               engine/  network · trip · rules
```

## Sources of truth

| What | Where |
|---|---|
| Shops and saved routes | SQLite, through `server/store`, at `~/.visnarn/visnarn.db` |
| Routes | Nowhere: derived on request from the plan, the stored shops and the network version, cached in memory by the planner |
| Which screen, saved route and alternative | The URL (`web/app/routes.ts`) |
| The plan being edited, its undo history, which row's ⌖ is on | `usePlanSession` in the browser's memory (`web/screens/route/session.ts`) |
| Routing policy numbers | `engine/rules.ts` |
| Map camera and click numbers | `web/map/config.ts` |
| Colours, radii, motion | CSS tokens at the top of `web/styles.css` |
| Words the planner says | `web/words.ts` |

## Load-bearing decisions

1. **One ordered place list.** A plan is `places: (PlaceRef | null)[]`: the first row is the start, the
   last the destination, the rest stops; an empty row is null. The same list runs end to end: on the
   wire, in storage, in the answer (`PlanPlaces`, same order), in the engine (`Trip.points`) and as one
   row component in the panel. Reorder, reverse, insert and remove are list operations, and a problem,
   a pin number and a row share one index. Routes saved before the list are read as one (`sqlite.ts`).
2. **One resolver, on the server** (`server/places/directory.ts`). Free text goes through lists in an
   order fixed per role; a bare number is never an FRA id. A second resolver in the browser would be a
   second copy of this policy.
3. **Routes are derived.** Ask again and you get the same answer; there is nothing to
   invalidate. The planner keys its cache by network version, points and track included.
4. **Domain types are the wire types.** `shared/api.ts` types the handler table, the decoders and the
   client from one `Api` table, so there is no DTO layer.
5. **Indexes stay inside `engine/core`.** `engine/trip.ts` converts FRA ids to indexes on the way in and
   back on the way out. `FraId` is a branded number.
6. **One map for the whole app.** `MapStage` creates MapLibre once; a screen declares what to show with
   `<MapContent scene=… />`.
7. **Node runs the sources.** Every relative import carries `.ts`; the architecture test rejects
   parameter properties and enums in the areas Node runs.

## Invariants encoded in types

| Invariant | How |
|---|---|
| A graph index never leaves the engine | `FraId` brand; only `engine/core` has indexes; import rule test |
| A saved route has no empty row | `FullPlan.places: PlaceRef[]`; the decoder refuses null there |
| A routed answer always has a route to show | `routes: [RoutePath, ...RoutePath[]]` |
| Every route has a handler and a decoder | `Handlers` and `decodeBody` are mapped types over `Api` |
| The server is not reachable from the network | `LOOPBACK` is a constant; `serve()` has no host option |
| Links cannot drift from routes | links are built from `Screen` values with `hrefFor` |

**Validation** lives at three edges: `server/http/decode.ts` (JSON to domain), `server/intake` (CSV records
to shop drafts plus issues), and the inputs on the page. Past them, code trusts its types.
