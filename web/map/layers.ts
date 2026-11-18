/** deck.gl layers for a scene: the rail network underneath, the scene on top. The only file that knows deck.gl layer classes. */
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer, type LayersList, type PickingInfo } from "deck.gl";
import { isClassI, NETWORK_CLASSES, type NetworkClass } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import { CLASS_LINES, type RGBA, type ThemeColors } from "../theme.ts";
import { lineName } from "../words.ts";
import type { MapScene, ScenePin, SceneRoute, SceneTarget } from "./scene.ts";

export const LAYER = {
  alternativesCasing: "alternatives-casing",
  alternatives: "alternatives",
  routeCasing: "route-casing",
  route: "route",
  chevrons: "chevrons",
  interchanges: "interchanges",
  pins: "pins",
  pinGlyphs: "pin-glyphs",
} as const;

const ROUND = { widthUnits: "pixels", capRounded: true, jointRounded: true } as const;
const fade = ([r, g, b]: RGBA, alpha: number): RGBA => [r, g, b, alpha];

const svgUrl = (width: number, height: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)}`;

/** Pin colours, baked into the icon images: the day look's --pin-a, --shop, --route and --casing; a shop is a dark grey square. */
const PIN = { start: "#80868b", destination: "#c5221f", stop: "#0068d6", shop: "#3c4043", edge: "#fff" };

/** Pins as images: start a hollow ring, destination a red drop with a white dot, a stop a numbered ring, a shop a small dark square. */
export const PIN_ICONS = {
  start: { url: svgUrl(18, 18, `<circle cx="9" cy="9" r="6" fill="${PIN.edge}" stroke="${PIN.start}" stroke-width="3"/>`), width: 18, height: 18, anchorY: 9 },
  destination: {
    url: svgUrl(28, 34, `<path d="M14 33c-8-10-13-15-13-21a13 13 0 0 1 26 0c0 6-5 11-13 21z" fill="${PIN.destination}" stroke="${PIN.edge}" stroke-width="1.5"/><circle cx="14" cy="12" r="4.6" fill="${PIN.edge}"/>`),
    width: 28,
    height: 34,
    anchorY: 33,
  },
  stop: { url: svgUrl(22, 22, `<circle cx="11" cy="11" r="9" fill="${PIN.edge}" stroke="${PIN.stop}" stroke-width="3"/>`), width: 22, height: 22, anchorY: 11 },
  shop: { url: svgUrl(15, 15, `<rect x="1.5" y="1.5" width="12" height="12" rx="3" fill="${PIN.shop}" stroke="${PIN.edge}" stroke-width="1.5"/>`), width: 15, height: 15, anchorY: 7.5 },
} satisfies Record<ScenePin["kind"], { url: string; width: number; height: number; anchorY: number }>;

const CHEVRON = { url: svgUrl(12, 12, `<path d="M4 2.5l4 3.5-4 3.5" fill="none" stroke="${PIN.edge}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`), width: 12, height: 12, anchorY: 6 };

/** Route line widths in px. Regional and short-line sections are thinner than Class I, as in the legend; the casings are added to the line. */
const ROUTE_PX = { classI: 6, other: 4, casing: 5, alternative: 4, alternativeCasing: 2 };

/** deck.gl angles turn counter-clockwise from east; a bearing turns clockwise from north. */
const angleOf = (bearingDeg: number) => 90 - bearingDeg;

/**
 * The mainline, one layer per class, each shown only while `drawn` lists its class. Class I is
 * coloured by owner; regional, short-line and passenger track is thinner and fainter, in the colour
 * those sections have in a route. Hidden layers stay mounted so showing one again does not
 * re-tessellate megabytes of track; all dim when a route needs the attention.
 */
export function networkLayers(network: Mainline, drawn: readonly NetworkClass[], dimmed: boolean, colors: ThemeColors): LayersList {
  // Class I last, on top.
  return [...NETWORK_CLASSES].reverse().map(
    (c) =>
      new GeoJsonLayer<{ owner: string }>({
        id: `network-${c}`,
        data: network[c],
        visible: drawn.includes(c),
        opacity: (dimmed ? 0.35 : 0.8) * (c === "class_i" ? 1 : 0.7),
        filled: false,
        lineWidthUnits: "pixels",
        lineCapRounded: true,
        lineJointRounded: true,
        getLineWidth: (f) => (c === "class_i" && isClassI(f.properties.owner) ? 1.8 : 1),
        getLineColor: (f) => (c !== "class_i" ? colors.rail[CLASS_LINES[c][0]] : isClassI(f.properties.owner) ? colors.rail[f.properties.owner] : colors.muted),
        updateTriggers: { getLineColor: colors },
      }),
  );
}

type Leg = SceneRoute["legs"][number];
type Chevron = SceneRoute["chevrons"][number];
type Interchange = SceneRoute["interchanges"][number];
type AltLeg = Leg & { option: SceneRoute["id"] };

const legWidth = (leg: Leg) => (isClassI(leg.railroad) ? ROUTE_PX.classI : ROUTE_PX.other);

/** The selected route: a white casing so it stands out, each section in its line's colour, and chevrons for the direction of travel. */
function selectedRouteLayers(route: SceneRoute, colors: ThemeColors, zoom: number): LayersList {
  return [
    new PathLayer<Leg>({ id: LAYER.routeCasing, data: route.legs, getPath: (leg) => leg.path, getColor: colors.casing, getWidth: (leg) => legWidth(leg) + ROUTE_PX.casing, ...ROUND, updateTriggers: { getColor: colors } }),
    new PathLayer<Leg>({
      id: LAYER.route,
      data: route.legs,
      getPath: (leg) => leg.path,
      getColor: (leg) => colors.rail[leg.railroad],
      getWidth: legWidth,
      ...ROUND,
      // Picked so a click on it reaches the map (a stop there) instead of the grey route underneath.
      pickable: true,
      updateTriggers: { getColor: colors },
    }),
    new IconLayer<Chevron>({
      id: LAYER.chevrons,
      data: route.chevrons.filter((c) => c.minZoom <= zoom),
      getPosition: (c) => c.position,
      getIcon: () => CHEVRON,
      getAngle: (c) => angleOf(c.bearingDeg),
      getSize: 12,
      sizeUnits: "pixels",
    }),
    new ScatterplotLayer<Interchange>({
      id: LAYER.interchanges,
      data: route.interchanges,
      getPosition: (x) => x.position,
      radiusUnits: "pixels",
      getRadius: 7,
      getFillColor: colors.casing,
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 3,
      getLineColor: colors.fg,
      pickable: true,
      updateTriggers: { getFillColor: colors, getLineColor: colors },
    }),
  ];
}

/** Pins, and the number in each stop's ring. No names: the panel has them, and the map's own place names are under the pins. */
function pinLayers(pins: ScenePin[], colors: ThemeColors): LayersList {
  return [
    new IconLayer<ScenePin>({
      id: LAYER.pins,
      data: pins,
      getPosition: (pin) => pin.position,
      getIcon: (pin) => PIN_ICONS[pin.kind],
      getSize: (pin) => PIN_ICONS[pin.kind].height,
      sizeUnits: "pixels",
      pickable: true,
    }),
    new TextLayer<ScenePin>({
      id: LAYER.pinGlyphs,
      data: pins.filter((pin) => pin.kind === "stop"),
      getPosition: (pin) => pin.position,
      getText: (pin) => pin.glyph,
      getSize: 11,
      getColor: colors.route,
      fontFamily: colors.sans,
      fontWeight: 700,
      updateTriggers: { getColor: colors },
    }),
  ];
}

/**
 * Bottom to top, by scene kind:
 *   route  alternatives (thin, grey) · selected casing · selected route by railroad · chevrons ·
 *          interchange rings · pins
 *   shops  shop squares
 * The route pills and the turn-back markers are DOM, over all of these (./RouteMarks.tsx).
 */
export function sceneLayers(scene: MapScene, colors: ThemeColors, zoom: number): LayersList {
  if (scene.kind === "shops") return pinLayers(scene.pins, colors);

  const alternatives: AltLeg[] = scene.alternatives.flatMap((route) => route.legs.map((leg) => ({ ...leg, option: route.id })));
  return [
    new PathLayer<AltLeg>({
      id: LAYER.alternativesCasing,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: fade(colors.casing, 180),
      getWidth: ROUTE_PX.alternative + ROUTE_PX.alternativeCasing,
      ...ROUND,
      updateTriggers: { getColor: colors },
    }),
    new PathLayer<AltLeg>({
      id: LAYER.alternatives,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: fade(colors.alternative, 150),
      getWidth: ROUTE_PX.alternative,
      ...ROUND,
      pickable: true,
      autoHighlight: true,
      highlightColor: fade(colors.route, 140),
      updateTriggers: { getColor: colors },
    }),
    ...(scene.selected ? selectedRouteLayers(scene.selected, colors, zoom) : []),
    ...pinLayers(scene.pins, colors),
  ];
}

const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: "var(--panel)",
  color: "var(--fg)",
  border: "0",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-float)",
  padding: "5px 9px",
  fontFamily: "var(--sans)",
  fontSize: "var(--text-sm)",
  lineHeight: "1.45",
  maxWidth: "280px",
  marginLeft: "12px",
  marginTop: "12px",
};

/** Hover text: an interchange ring "BNSF → UP · Galesburg, IL", a pin's or a shop square's name. Nothing else. */
export function sceneTooltip(info: PickingInfo): { text: string; style: Partial<CSSStyleDeclaration> } | null {
  const { layer, object } = info;
  if (!layer || !object) return null;
  if (layer.id === LAYER.interchanges) {
    const x = object as Interchange;
    return { text: `${lineName(x.from)} → ${lineName(x.to)}${x.place ? ` · ${x.place}` : ""}`, style: TOOLTIP_STYLE };
  }
  if (layer.id === LAYER.pins) return { text: (object as ScenePin).label, style: TOOLTIP_STYLE };
  return null;
}

/**
 * What a click on a picked object means. A grey route: select it. A shop square: that shop as a place.
 * The plan's own pins and the interchange rings: nothing ("inert"), so a click on them adds no stop.
 * Anything else (the selected route, the network, an empty spot): null, a click on the map.
 */
export function sceneTarget(info: PickingInfo): SceneTarget | "inert" | null {
  const { layer, object } = info;
  if (!layer || !object) return null;
  if (layer.id === LAYER.alternatives) return { kind: "option", id: (object as AltLeg).option };
  if (layer.id === LAYER.interchanges) return "inert";
  if (layer.id === LAYER.pins) {
    const pin = object as ScenePin;
    return pin.shopId ? { kind: "place", ref: { kind: "shop", shopId: pin.shopId }, position: pin.position } : "inert";
  }
  return null;
}
