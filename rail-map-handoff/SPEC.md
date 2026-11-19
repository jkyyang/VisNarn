# Rail map UI redesign: "quiet map, glass chrome"

Goal: unify visual style and interaction logic. The map must look calm;
UI chrome is light, consistent, out of the way.

Reference material in this folder:
- `screenshots/` shows the target look in six states (night and day).
- `mockup/night.html` and `mockup/day.html` are clickable design mockups.
  Open them in a browser; read their inline styles for exact values.
  They are NOT production code, and their map is a hand-drawn schematic.
  Do not copy the mockup's map geometry, template runtime or sample data.

Implement in this order: tokens → side panel → map controls → map styling.
Do not add features beyond this spec.

## 0. Do not touch
- The real-time day/night lighting (terminator, night lights) and its code.
  Keep the "Time of day: Auto / Day / Night" control and its behavior as is.
- Renderer and tile provider (MapLibre + current tiles). No provider change.

## 1. Tokens (CSS variables; no hard-coded colors, radii, shadows)

```
--accent: #FFC72C      /* placeholder: replace with the official UTLX yellow */
--on-accent: #12161D
```

| Token | Dark (Night) | Light (Day) |
|---|---|---|
| `--surface` | `rgba(16,20,28,.72)` | `rgba(255,255,255,.76)` |
| `--surface-2` | `rgba(255,255,255,.07)` | `rgba(18,22,29,.055)` |
| `--stroke` | `rgba(255,255,255,.10)` | `rgba(18,22,29,.10)` |
| `--text` | `#F3F5F8` | `#12161D` |
| `--text-2` | `rgba(243,245,248,.64)` | `rgba(18,22,29,.68)` |

- Glass (every floating element): `backdrop-filter: blur(20px) saturate(140%)`,
  1px border `var(--stroke)`, shadow `0 8px 32px` (black .30 dark / ink .16 light).
- Radius 20 panel / 12 control / 999 pill. Control height 40. 4-pt spacing.
- Font: Inter; sizes 14 / 13 / 12; weights 400 and 600.
- Motion: 180ms ease-out; respect `prefers-reduced-motion`.
- No blue anywhere in the UI.

States, identical for every control:
- hover = `--surface-2`; disabled = 40% opacity
- segmented control: ONE neutral raised thumb that slides between segments
- switches and the primary button when on = accent fill + on-accent content
- icon toggle buttons (Layers) when open = accent fill + on-accent icon
- never use accent as a text or thin-icon color (unreadable on light)
- focus ring only on `:focus-visible`, never after a mouse click

## 2. Layout: exactly three floating elements
- A. Side panel: top-left, 360px wide, 16px margin
- B. Map controls: top-right vertical stack, 8px gap
- C. Attribution: bottom-right

Remove: the floating search bar, the separate legend card, undo/redo in the map stack.

## 3. Side panel
- Header: search field ("/" shortcut) + collapse chevron; below it a
  Route | Shops segmented control with a sliding thumb.
- Height hugs content; max-height = viewport − 32px; the body scrolls inside
  the panel with a thin scrollbar. The page never scrolls.
- Collapse: the panel hides and a 40px glass button at top-left reopens it. Persist the state.
- One search for shops + cities with grouped results; in Shops it also filters the list.

### Shops tab
- Header row: "12 shops" · [+ Add shop] accent pill · [⋯] menu with Import CSV.
- Row: owner glyph (filled dot = Procor, ring = UTLX) · "City, ST · Owner" (14/600) ·
  code (12, text-2) · up to 3 carrier dots, right-aligned, tooltip = carrier names.
- Row click selects the shop and flies to it; selected row = `--surface-2`.
  "Edit" appears only on hover or selection.

### Route tab
- Header row: "Route" · Undo · Redo (visible only when history exists;
  Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z).
- One card with Start and Destination rows: label, value, pick-on-map button, drag handle.
- "Route options" accordion replaces the chip row.
  - Closed: shows a summary of what is on, e.g. "Class I · Regional", ellipsized;
    "Class I only" when nothing else is on.
  - Open: no summary. Rows: "Class I lines — Always on" (static text), then switches
    for Regional lines, Short lines, Passenger lines, Turn at stops.
- Result card: total distance, "N carriers · N interchanges", one row per carrier
  segment (color bar · carrier · from → to · distance).

## 4. Map controls
`[Layers] · [+ / −] · [Reset view] · [Fullscreen]`
- Reset view fits the whole network. Fullscreen only toggles fullscreen.
- Layers opens ONE popover to the left of the button: top edges aligned, 8px gap;
  closes on outside click or Esc. Only one popover may be open app-wide.
- Popover sections, top to bottom: Carriers · Basemap (Map/Satellite) ·
  Time of day (Auto/Day/Night, exactly one selected) · Units (km/mi) ·
  Overlays (Rail network, Real tracks as switches).

## 5. Carriers = legend + filter
- Row: color line + name. Click isolates that carrier (the row shows "Only");
  click again or "Show all" resets. Hover previews the same effect.
- While filtered, show a small dot badge on the Layers button.

## 6. Map styling
- Default: ALL rail lines one neutral color, 1.1px, about 40% opacity.
  No carrier colors by default.
- Carrier color appears only (a) for the isolated or hovered carrier
  (1.9px, others dim to about 13%), or (b) on the active route.
- Active route: drawn on top, 3.4px, colored per segment by carrier, with a casing;
  other lines dim to about 16%. Mark each interchange with a small node and the
  city name. Start and end shops get an accent ring with a dark outline.
- One carrier palette per theme in tokens, reused by lines, legend rows and shop
  carrier dots. Keep the existing carrier hues; only make the three uses share values.
- Zoom hierarchy: below z5 main lines only (use the dataset's main/branch field if
  present); regional and short lines from z5+. Simplify geometry at low zoom;
  round joins and caps.
- Shop markers are the brightest elements on the map: Procor = filled dot,
  UTLX = ring, approximate location = extra dashed ring. Selected = accent ring
  with a dark outline. Shop label beside the marker.
- Labels below z5: major cities plus shop names. A shop label wins a collision
  with a city label (hide the city label).
- After the change, check Auto mode: neutral lines must stay visible on both the
  lit and the dark side. If they do not, add a dark semi-transparent casing under
  the lines. Do not change the lighting code.

## 7. Cursor
`grab` on the map · `grabbing` while dragging · `pointer` on markers, lines and any
clickable · `crosshair` ONLY while picking Start/Destination, with the hint
"Click the map to set Start · Esc to cancel".

## 8. Camera
Every fitBounds / flyTo / reset uses left padding = panel width + 32px when the
panel is open, 16px when collapsed.

## 9. Attribution
36px round glass "i" button, bottom-right. Click toggles a small popover to its
left; it closes on outside click, Esc or map move.

## 10. Acceptance
- No hard-coded colors; Day/Night only swap token values.
- No blue; no accent-colored text.
- One search, one popover at a time, three floating elements.
- Mouse click never leaves a focus ring; Tab shows one.
- Reset view with the panel open shows the whole network to the right of the panel.
- Default view: no carrier colors visible; shops are the first thing the eye lands on.
- Lighting behavior is unchanged in Auto, Day and Night.
