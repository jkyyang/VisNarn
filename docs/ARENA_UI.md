# UI arena synthesis (2026-11-16)

Two candidates built the React UI from the same contract (scratchpad `arena-ui/TASK.md`):
candidate 1 on Opus xhigh, candidate 2 on Fable xhigh.

**Cross-judge: skipped.** The configured judge pool (Opus, Fable) has only Claude models, the same family as
the picker, and Claude Code cannot run a non-Claude judge. The base was picked against the rubric alone.

## Convergence
Both candidates independently chose the same architecture: deck.gl `MapboxOverlay` in overlaid mode (independent of
basemap style switches), OpenRailwayMap as a react-map-gl `<Source>/<Layer>` (re-added after each style load), a
draft/submitted split for inputs, batch selection keyed by CSV row index, and camera refits keyed on the bounds.
That agreement is treated as strong evidence the shape is right.

## Base: candidate 2
| Rubric | C1 | C2 |
|---|---|---|
| Build health | tsc/build clean, 27 tests | tsc/build clean, 46 tests (reducer + deck layers too) |
| Features | complete | complete + "Open in One car", most-urgent row preselected, field-level `aria-invalid`, A→B stretch drawn |
| Map | good; asymmetric fit padding | zoom-aware snap radius, lazy map chunk, ErrorBoundary, shell-first loading |
| State model | single owner, simple | reducer + hooks (unit-tested), explicit assumption validation |
| Readability | smaller, flatter | more files, each small |

C2 wins on robustness and test coverage; its extra files have clear single jobs.

## Grafts from candidate 1
1. Unicode-aware `titleCase` (C2 still produced "QuéRetaro"). Test: `src/lib/format.test.ts`.
2. Fit-bounds right padding on wide maps so the route is not hidden under the layers card (`FitBounds.tsx`).

## Rejected from candidate 1
- Pins drawn when the check fails: useful, but C2 shows field-level errors instead; not worth a second code path.
- `NumberField` that silently keeps the last valid value: C2's visible validation message is more honest.
- Global de-duplication of subdivision names: route order with repeats is informative.

## Verification
- `npx tsc --noEmit`: clean. `npx vitest run`: 49 passed (6 files). `npx vite build`: OK (main chunk 178 kB; map and MapLibre lazy, ~800 kB each).
- `vite preview`: index, `graph.bin`, `graph_meta.json`, `basemap_mainline.geojson` served with 200; a missing file returns the HTML page with 200, which `load.ts` detects.
- **Not verified:** anything in a real browser (tiles, WebGL drawing, picking clicks, style-switch survival of the OpenRailwayMap overlay, phone layout, clipboard).

## Side effects reported by candidate 2
It tried headless Chrome once for screenshots; that woke Chrome's updater and the script hung. It stopped Chrome and deleted its temp files.
Its test runs also rewrote `node_modules/.vite/vitest/results.json` (a test cache) through the symlink. Harmless.
