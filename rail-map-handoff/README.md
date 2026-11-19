# Rail map UI: design handoff

Put this folder in the project (for example `docs/design-handoff/`) and tell the
coding agent:

> Read `docs/design-handoff/SPEC.md` and look at the screenshots, then implement
> the redesign in the order the spec gives. Before changing anything, list the
> files you plan to touch.

## Contents

| Path | What it is |
|---|---|
| `SPEC.md` | The spec. Source of truth for behavior, tokens and acceptance checks. |
| `screenshots/1-shops-*.png` | Default view: neutral lines, shops highlighted. |
| `screenshots/2-route-*.png` | Route tab with options open and a routed result. |
| `screenshots/3-carrier-filter-*.png` | Layers popover open, one carrier isolated. |
| `mockup/night.html`, `mockup/day.html` | Clickable mockups. Open in a browser. |

## What the mockups are not

- Not production code. They use a tiny throwaway template renderer.
- Not real data. The map is a hand-drawn schematic SVG; line positions are approximate.
- Sample values: the route (Sarnia → Texarkana), its distances (540 km, 1,620 km,
  2,160 km) and the carrier split are illustrative.
- `#FFC72C` is a placeholder for the official UTLX yellow.
- Basemap, Time of day and Units in the Layers popover are static in the mockup.

## What works in the mockups

Route / Shops switch, panel collapse, shop row selection (highlights the marker),
Route options accordion and switches, Layers popover, carrier filter and
"Show all", attribution popover.
