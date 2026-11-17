# What the page needs from the shared contract (web worker, 2026-11-17)

Each item is worked around in web/ with the current types; none blocks the page.

1. **Report age in the morning list.** The Cars mockup's parse summary says "reports 0 days old".
   `CarSummary` and `BatchView` carry no report time or age, so the page cannot compute it.
   Asked: `positionAgeH: number` on the `"checked"` member of `CheckSummary` (or `oldestReportH` on
   `BatchView`). Today the page shows "no old reports" / "N old reports", counted from the
   `stale-position` flags the server already sends.
   **Resolved (integration worker, 2026-11-17):** `positionAgeH: number` added to the `"checked"` member
   of `CheckSummary` (shared/cars.ts), filled by `summarize` in server/cars/checks.ts from the check's own
   `positionAgeH`. The parse summary now reads "6 rows read · 0 need fixing · reports 0 days old", or
   "reports up to 3 days old · 1 too old to trust" when the oldest is a day or more. Covered by
   web/screens/cars/CarsScreen.test.tsx, tests/api.test.ts and the Cars browser test.
2. **Where an interchange is on the map.** `Milestone` `"interchange"` has a place name but no
   coordinates. The page puts the ring at the start of the first leg on the new railroad, which is
   the same point today. Asked only if legs ever stop splitting exactly at an interchange.
   **No change (checked 2026-11-17):** engine/trip.ts names the interchange from `coreLeg.nodes[0]` and
   starts the new leg's path at that same node, so the page's ring is exactly at the interchange node.
3. **Snap preview while hovering (UX_PLAN P1).** Possible with `GET /api/places/nearest` as it is;
   not built: the page shows "Snaps to … · km" in the "Which line?" card after the click instead.
   No contract change needed.
   **No change:** nothing to add to the contract; the hover preview stays a page task for UX_PLAN P1.
