/** deck.gl layers for a scene: the rail network underneath, the scene on top. The only file that knows deck.gl layer classes. */
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer, type LayersList, type PickingInfo } from "deck.gl";
import type { LngLat } from "../../shared/geo.ts";
import { NETWORK_CLASSES, RAILROADS, type NetworkClass, type Railroad } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import { css, type RGBA, type ThemeColors } from "../theme.ts";
import { lineName } from "../words.ts";
import { LABELS, SCENE_NAMES } from "./basemaps.ts";
import { LINK_DASH } from "./config.ts";
import type { MapScene, SceneLink, ScenePin, SceneRoute, SceneTarget } from "./scene.ts";

export const LAYER = {
  alternativesCasing: "alternatives-casing",
  alternatives: "alternatives",
  routeCasing: "route-casing",
  route: "route",
  carrier: "network-carrier",
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
type Icon = { url: string; width: number; height: number; anchorY: number };

/** Each pin's image box: width, height, and where the point it marks sits from the top. A marker is the mockup's 28 px square. */
export const PIN_BOX = {
  start: { width: 28, height: 28, anchorY: 14 },
  destination: { width: 28, height: 28, anchorY: 14 },
  stop: { width: 22, height: 22, anchorY: 11 },
  shop: { width: 28, height: 28, anchorY: 14 },
} satisfies Record<ScenePin["kind"], Omit<Icon, "url">>;

/** A marker's look: a filled dot or a ring (a shop's company, or the start's dot and the destination's ring), or a stop's numbered ring. */
type Face = { shape: "dot" | "ring" | "stop"; approximate: boolean; ringed: boolean };

/** A shop keeps its own marker as a place of the plan; the start and the destination wear the accent ring. */
function faceOf(pin: ScenePin): Face {
  if (pin.kind === "stop") return { shape: "stop", approximate: false, ringed: false };
  const filled = pin.mark ? pin.mark.filled : pin.kind === "start";
  return { shape: filled ? "dot" : "ring", approximate: pin.mark?.approximate ?? false, ringed: pin.kind !== "shop" || !!pin.mark?.selected };
}

/**
 * A pin as an image, in the theme's colours: an image cannot read CSS variables; deck.gl knows an image by its url, so
 * a new theme is a new image. A marker as the mockup draws it: a halo, the dashed ring, the dot or the ring on the
 * map's paper, the accent ring with its dark outline.
 */
function iconOf(face: Face, colors: ThemeColors): Icon {
  const [ink, paper] = [css(colors.fg), css(colors.casing)];
  if (face.shape === "stop") return { ...PIN_BOX.stop, url: svgUrl(22, 22, `<circle cx="11" cy="11" r="9" fill="${paper}" stroke="${ink}" stroke-width="3"/>`) };
  const ring = (r: number, stroke: string, width: number, extra = "") => `<circle cx="14" cy="14" r="${r}" fill="none" stroke="${stroke}" stroke-width="${width}"${extra}/>`;
  const body = [
    `<circle cx="14" cy="14" r="10" fill="${ink}" fill-opacity=".1"/>`,
    face.approximate ? ring(10, ink, 1, ` stroke-opacity=".75" stroke-dasharray="2 3"`) : "",
    face.shape === "dot"
      ? `<circle cx="14" cy="14" r="5" fill="${ink}" stroke="${paper}" stroke-width="2"/>`
      : `<circle cx="14" cy="14" r="6" fill="${paper}"/><circle cx="14" cy="14" r="4" fill="${paper}" stroke="${ink}" stroke-width="2.2"/>`,
    face.ringed ? ring(11, css(colors.onAccent), 5) + ring(11, css(colors.accent), 2.5) : "",
  ];
  return { ...PIN_BOX.shop, url: svgUrl(28, 28, body.join("")) };
}

const iconsOf = once<ThemeColors, Map<string, Icon>>();
function pinIcon(pin: ScenePin, colors: ThemeColors): Icon {
  const face = faceOf(pin);
  const key = `${face.shape} ${face.approximate} ${face.ringed}`;
  const made = iconsOf(colors, () => new Map());
  if (!made.has(key)) made.set(key, iconOf(face, colors));
  return made.get(key)!;
}

const chevronOf = once<ThemeColors, { url: string; width: number; height: number; anchorY: number }>();
const chevron = (colors: ThemeColors) =>
  chevronOf(colors, () => ({
    url: svgUrl(12, 12, `<path d="M4 2.5l4 3.5-4 3.5" fill="none" stroke="${css(colors.casing)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`),
    width: 12,
    height: 12,
    anchorY: 6,
  }));

/** Line widths in px: the selected route over its casing (the casing's whole width), the grey routes and a shop's links with the casing added. */
const ROUTE_PX = { line: 3.4, casing: 7.5, alternative: 2.4, alternativeCasing: 2, link: 3, linkCasing: 2 };
/** The selected route's casing lets a little of the map through. */
const ROUTE_CASING_ALPHA = 235;
/** Zoomed out, the route is a thin line: its chevrons start here. */
const CHEVRON_MIN_ZOOM = 6;

/** A suggested link's alpha, of 255, and a drag's preview of one: fainter than a link the shop has. */
const SUGGESTED_ALPHA = 110;

/** deck.gl angles turn counter-clockwise from east; a bearing turns clockwise from north. */
const angleOf = (bearingDeg: number) => 90 - bearingDeg;

const stopPinsOf = once<ScenePin[], ScenePin[]>();
const alternativeLegsOf = once<SceneRoute[], AltLeg[]>();

/**
 * deck.gl 9.0 types have no `beforeId`; a spread passes it unchecked. The network goes under the basemap's place names,
 * the scene under its own names (./SceneLabels.tsx), so a shop's name stays readable where the route runs past it.
 */
const UNDER_LABELS = { beforeId: LABELS };
const UNDER_NAMES = { beforeId: SCENE_NAMES };

/** What the network shows besides its quiet lines. */
export interface NetworkFocus {
  /** The carrier the Layers popover shows, in its colour over the rest. */
  carrier: Railroad | null;
  /** A route is selected: the network steps back under it. */
  underRoute: boolean;
  /** Auto zoomed out: the day side and the night side on one screen. */
  fromSpace: boolean;
}

/**
 * The network's lines in px and opacity: every line one neutral colour, faint. The carrier the Layers popover
 * shows stands out in its colour while the rest fade; under a route all fade further, that carrier half lit.
 * Seen from space, a casing 1 px wide each side keeps the light line readable on the day side.
 */
const NETWORK_LOOK = {
  width: 1.1,
  casing: 1.1 + 2,
  opacity: { plain: 0.4, besideCarrier: 0.13, underRoute: 0.16 },
  carrier: { width: 1.9, opacity: 1 },
  carrierUnderRoute: { width: 1.4, opacity: 0.55 },
};

const LINE_PX = { lineWidthUnits: "pixels", lineCapRounded: true, lineJointRounded: true } as const;

/** The Class I lines of each carrier, sorted once per network, so showing a carrier again gives deck.gl the same data. */
const carrierLinesOf = once<Mainline, Record<Railroad, Mainline["class_i"]>>();
const carrierLines = (network: Mainline, carrier: Railroad) =>
  carrierLinesOf(network, () => Object.fromEntries(RAILROADS.map((r) => [r, network.class_i.filter((f) => f.properties.owner === r)])) as Record<Railroad, Mainline["class_i"]>)[carrier];

/**
 * The mainline, one layer per class, each shown only while `drawn` lists its class, all in one neutral colour; seen
 * from space, over their casings. On top, the shown carrier's Class I lines in its colour. Hidden layers stay mounted
 * so showing one again does not re-tessellate megabytes of track; a fade is the layers' opacity, so it redraws nothing.
 */
export function networkLayers(network: Mainline, drawn: readonly NetworkClass[], focus: NetworkFocus, colors: ThemeColors): LayersList {
  const { carrier, underRoute, fromSpace } = focus;
  const opacity = underRoute ? NETWORK_LOOK.opacity.underRoute : carrier ? NETWORK_LOOK.opacity.besideCarrier : NETWORK_LOOK.opacity.plain;
  // Class I last, on top.
  const classes = [...NETWORK_CLASSES].reverse();
  const lines = (part: "casing" | "line") =>
    classes.map(
      (c) =>
        new GeoJsonLayer({
          ...UNDER_LABELS,
          id: part === "line" ? `network-${c}` : `network-${c}-casing`,
          data: network[c],
          visible: drawn.includes(c),
          opacity,
          filled: false,
          ...LINE_PX,
          getLineWidth: part === "line" ? NETWORK_LOOK.width : NETWORK_LOOK.casing,
          getLineColor: part === "casing" ? colors.fromSpace.casing : fromSpace ? colors.fromSpace.line : colors.neutral,
        }),
    );
  const quiet = [...(fromSpace ? lines("casing") : []), ...lines("line")];
  if (!carrier || !drawn.includes("class_i")) return quiet;
  const look = underRoute ? NETWORK_LOOK.carrierUnderRoute : NETWORK_LOOK.carrier;
  return [
    ...quiet,
    new GeoJsonLayer({ ...UNDER_LABELS, id: LAYER.carrier, data: carrierLines(network, carrier), opacity: look.opacity, filled: false, ...LINE_PX, getLineWidth: look.width, getLineColor: colors.rail[carrier] }),
  ];
}

type Leg = SceneRoute["legs"][number];
type Chevron = SceneRoute["chevrons"][number];
type Interchange = SceneRoute["interchanges"][number];
type AltLeg = Leg & { option: SceneRoute["id"] };

/**
 * The selected route: a casing in the map's paper so it stands out, in ink round the leg picked in the panel or on
 * the map; each section in its carrier's colour, chevrons for the direction of travel, and a small node at each
 * interchange (its name is a map label, ./SceneLabels.tsx).
 */
function selectedRouteLayers(route: SceneRoute, focus: number | null, colors: ThemeColors, zoom: number): LayersList {
  const paper = fade(colors.casing, ROUTE_CASING_ALPHA);
  return [
    new PathLayer<Leg>({
      ...UNDER_NAMES,
      id: LAYER.routeCasing,
      data: route.legs,
      getPath: (leg) => leg.path,
      getColor: (leg) => (leg.index === focus ? colors.fg : paper),
      getWidth: ROUTE_PX.casing,
      ...ROUND,
      updateTriggers: { getColor: [colors, focus] },
    }),
    new PathLayer<Leg>({
      ...UNDER_NAMES,
      id: LAYER.route,
      data: route.legs,
      getPath: (leg) => leg.path,
      getColor: (leg) => colors.rail[leg.railroad],
      getWidth: ROUTE_PX.line,
      ...ROUND,
      // A click on a leg picks it, in the panel too; hovering one lights it.
      pickable: true,
      autoHighlight: true,
      highlightColor: fade(colors.fg, 70),
      updateTriggers: { getColor: colors },
    }),
    new IconLayer<Chevron>({
      ...UNDER_NAMES,
      id: LAYER.chevrons,
      data: zoom < CHEVRON_MIN_ZOOM ? [] : route.chevrons.filter((c) => c.minZoom <= zoom),
      getPosition: (c) => c.position,
      getIcon: () => chevron(colors),
      getAngle: (c) => angleOf(c.bearingDeg),
      getSize: 12,
      sizeUnits: "pixels",
      updateTriggers: { getIcon: colors },
    }),
    new ScatterplotLayer<Interchange>({
      ...UNDER_NAMES,
      id: LAYER.interchanges,
      data: route.interchanges,
      getPosition: (x) => x.position,
      radiusUnits: "pixels",
      getRadius: 4.5,
      getFillColor: colors.casing,
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      getLineColor: colors.fg,
      pickable: true,
    }),
  ];
}

/** Pins, and the number in each stop's ring. Their names are map labels (./SceneLabels.tsx). */
function pinLayers(pins: ScenePin[], colors: ThemeColors): LayersList {
  return [
    new IconLayer<ScenePin>({
      ...UNDER_NAMES,
      id: LAYER.pins,
      data: pins,
      getPosition: (pin) => pin.position,
      getIcon: (pin) => pinIcon(pin, colors),
      getSize: (pin) => PIN_BOX[pin.kind].height,
      sizeUnits: "pixels",
      pickable: true,
      updateTriggers: { getIcon: colors },
    }),
    new TextLayer<ScenePin>({
      ...UNDER_NAMES,
      id: LAYER.pinGlyphs,
      data: stopPinsOf(pins, () => pins.filter((pin) => pin.kind === "stop")),
      getPosition: (pin) => pin.position,
      getText: (pin) => pin.glyph,
      getSize: 11,
      getColor: colors.fg,
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
  const colorOf = (piece: LinkPiece) => (piece.look === "refused" ? colors.risk : piece.look === "set" ? colors.fg : fade(colors.fg, SUGGESTED_ALPHA));
  const common = { getPath: (piece: LinkPiece) => piece.path, ...ROUND, updateTriggers: { getColor: colors } };
  return [
    new PathLayer<LinkPiece>({ ...UNDER_NAMES, id: LAYER.linksCasing, data: on, getColor: colors.casing, getWidth: ROUTE_PX.link + ROUTE_PX.linkCasing, ...common }),
    new PathLayer<LinkPiece>({ ...UNDER_NAMES, id: LAYER.links, data: on, getColor: colorOf, getWidth: ROUTE_PX.link, ...common }),
    new PathLayer<LinkPiece, PathStyleExtensionProps>({
      ...UNDER_NAMES,
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
      ...UNDER_NAMES,
      id: LAYER.alternativesCasing,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: fade(colors.casing, 180),
      getWidth: ROUTE_PX.alternative + ROUTE_PX.alternativeCasing,
      ...ROUND,
      updateTriggers: { getColor: colors },
    }),
    new PathLayer<AltLeg>({
      ...UNDER_NAMES,
      id: LAYER.alternatives,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: fade(colors.alternative, 150),
      getWidth: ROUTE_PX.alternative,
      ...ROUND,
      pickable: true,
      autoHighlight: true,
      highlightColor: fade(colors.fg, 140),
      updateTriggers: { getColor: colors },
    }),
    ...(scene.selected ? selectedRouteLayers(scene.selected, scene.leg, colors, zoom) : []),
    ...pinLayers(scene.pins, colors),
  ];
}

const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: "var(--surface-solid)",
  color: "var(--text)",
  border: "var(--stroke-w) solid var(--stroke)",
  borderRadius: "var(--radius-inner)",
  boxShadow: "var(--shadow-glass)",
  padding: "4px 8px",
  fontFamily: "var(--font)",
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
 * What a click on a picked object means. A shop square: that shop as a place. A leg of the selected route: that leg;
 * an interchange ring: the leg that leaves it. The plan's own pins: nothing ("inert"), so a click on them adds no stop.
 * Anything else (a grey route, the network, an empty spot): null, a click on the map.
 */
export function sceneTarget(info: PickingInfo): SceneTarget | "inert" | null {
  const { layer, object } = info;
  if (!layer || !object) return null;
  if (layer.id === LAYER.route) return { kind: "leg", index: (object as Leg).index };
  if (layer.id === LAYER.interchanges) return { kind: "leg", index: (object as Interchange).leg };
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
