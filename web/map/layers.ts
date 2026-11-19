/** deck.gl layers for a scene: the rail network underneath, the scene on top. The only file that knows deck.gl layer classes. */
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer, type LayersList, type PickingInfo } from "deck.gl";
import type { LngLat } from "../../shared/geo.ts";
import { isClassI, NETWORK_CLASSES, type NetworkClass } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import { CLASS_LINES, type RGBA, type ThemeColors } from "../theme.ts";
import { lineName } from "../words.ts";
import { LABELS } from "./basemaps.ts";
import { LINK_DASH } from "./config.ts";
import type { MapScene, SceneLink, ScenePin, SceneRoute, SceneTarget } from "./scene.ts";

export const LAYER = {
  alternativesCasing: "alternatives-casing",
  alternatives: "alternatives",
  routeCasing: "route-casing",
  route: "route",
  chevrons: "chevrons",
  interchanges: "interchanges",
  pins: "pins",
  pinGlyphs: "pin-glyphs",
  linksCasing: "shop-links-casing",
  links: "shop-links",
  linksOffTrack: "shop-links-off-track",
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
const ROUTE_PX = { classI: 6, other: 4, casing: 5, alternative: 4, alternativeCasing: 2, link: 3, linkCasing: 2 };

/** A suggested link's alpha, of 255, and a drag's preview of one: fainter than a link the shop has. */
const SUGGESTED_ALPHA = 110;

/** deck.gl angles turn counter-clockwise from east; a bearing turns clockwise from north. */
const angleOf = (bearingDeg: number) => 90 - bearingDeg;

/**
 * deck.gl redraws a layer's data whenever it is a new array. The big arrays derived from a scene are
 * made once per scene, so a zoom step (which builds the layers again) does not redraw the routes.
 */
function once<K extends object, V>(): (key: K, make: () => V) => V {
  const made = new WeakMap<K, V>();
  return (key, make) => {
    if (!made.has(key)) made.set(key, make());
    return made.get(key)!;
  };
}
const stopPinsOf = once<ScenePin[], ScenePin[]>();
const alternativeLegsOf = once<SceneRoute[], AltLeg[]>();

/** deck.gl 9.0 types have no `beforeId`; a spread passes it unchecked. The network goes under the basemap's place names. */
const UNDER_LABELS = { beforeId: LABELS };

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
        ...UNDER_LABELS,
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
      data: stopPinsOf(pins, () => pins.filter((pin) => pin.kind === "stop")),
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

type LinkPiece = { path: LngLat[]; look: SceneLink["look"] };
const DASHED = new PathStyleExtension({ dash: true });

/** Each link in two pieces: off the track (shop to its yard, the first step) and on it (the rest, when there is a rest). */
const piecesOf = once<SceneLink[], { off: LinkPiece[]; on: LinkPiece[] }>();

/**
 * The edited shop's links, thin in the route colour: on the track solid over a casing, off it dashed. A suggestion
 * and a drag's preview are fainter; a drop that would be refused is the risk colour.
 */
function linkLayers(links: SceneLink[], colors: ThemeColors): LayersList {
  const { off, on } = piecesOf(links, () => ({
    off: links.map((link) => ({ path: link.path.slice(0, 2), look: link.look })),
    on: links.filter((link) => link.path.length > 2).map((link) => ({ path: link.path.slice(1), look: link.look })),
  }));
  const colorOf = (piece: LinkPiece) => (piece.look === "refused" ? colors.risk : piece.look === "set" ? colors.route : fade(colors.route, SUGGESTED_ALPHA));
  const common = { getPath: (piece: LinkPiece) => piece.path, ...ROUND, updateTriggers: { getColor: colors } };
  return [
    new PathLayer<LinkPiece>({ id: LAYER.linksCasing, data: on, getColor: colors.casing, getWidth: ROUTE_PX.link + ROUTE_PX.linkCasing, ...common }),
    new PathLayer<LinkPiece>({ id: LAYER.links, data: on, getColor: colorOf, getWidth: ROUTE_PX.link, ...common }),
    new PathLayer<LinkPiece, PathStyleExtensionProps>({
      id: LAYER.linksOffTrack,
      data: off,
      getColor: colorOf,
      getWidth: ROUTE_PX.link,
      ...common,
      capRounded: false,
      getDashArray: LINK_DASH,
      dashJustified: true,
      extensions: [DASHED],
    }),
  ];
}

/**
 * Bottom to top, by scene kind:
 *   route  alternatives (thin, grey) · selected casing · selected route by railroad · chevrons ·
 *          interchange rings · pins
 *   shops  the edited shop's links (casing, on track, off track) · the other shops' squares
 * The route pills and the turn-back markers are DOM, over all of these (./RouteMarks.tsx).
 */
export function sceneLayers(scene: MapScene, colors: ThemeColors, zoom: number): LayersList {
  if (scene.kind === "shops") return [...linkLayers(scene.links, colors), ...pinLayers(scene.pins, colors)];

  const alternatives = alternativeLegsOf(scene.alternatives, () => scene.alternatives.flatMap((route) => route.legs.map((leg) => ({ ...leg, option: route.id }))));
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
 * What a click on a picked object means. A shop square: that shop as a place. The plan's own pins and
 * the interchange rings: nothing ("inert"), so a click on them adds no stop. Anything else (a route,
 * the network, an empty spot): null, a click on the map.
 */
export function sceneTarget(info: PickingInfo): SceneTarget | "inert" | null {
  const { layer, object } = info;
  if (!layer || !object) return null;
  if (layer.id === LAYER.interchanges) return "inert";
  if (layer.id === LAYER.pins) {
    const pin = object as ScenePin;
    return pin.shopId ? { kind: "place", ref: { kind: "shop", shopId: pin.shopId }, position: pin.position } : "inert";
  }
  return null;
}

/** The grey route a click on the map landed on, so a stop there snaps to that line; null: none. */
export function lineAt(info: PickingInfo): SceneRoute["id"] | null {
  return info.layer?.id === LAYER.alternatives && info.object ? (info.object as AltLeg).option : null;
}
