/** deck.gl layers for a scene: the Class I network underneath, the scene on top. The only file that knows deck.gl layer classes. */
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer, type LayersList, type PickingInfo } from "deck.gl";
import type { LngLat } from "../../shared/geo.ts";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import type { RGBA, ThemeColors } from "../theme.ts";
import { shortPlace } from "../words.ts";
import type { MapScene, ScenePin, SceneRoute, SceneTarget } from "./scene.ts";

export const LAYER = {
  network: "class1-network",
  alternativesCasing: "alternatives-casing",
  alternatives: "alternatives",
  routeCasing: "route-casing",
  route: "route",
  chevrons: "chevrons",
  interchanges: "interchanges",
  pins: "pins",
  pinGlyphs: "pin-glyphs",
  labels: "labels",
} as const;

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const ROUND = { widthUnits: "pixels", capRounded: true, jointRounded: true } as const;
const isClassI = (owner: string): owner is Railroad => (RAILROADS as readonly string[]).includes(owner);
const fade = ([r, g, b]: RGBA, alpha: number): RGBA => [r, g, b, alpha];

const svgUrl = (width: number, height: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)}`;

/** Pins as images: start a hollow ring, destination a red drop with a white dot, a stop a numbered ring, a shop a small dark square. */
const PIN_ICONS = {
  start: { url: svgUrl(18, 18, '<circle cx="9" cy="9" r="6" fill="#fff" stroke="#80868b" stroke-width="3"/>'), width: 18, height: 18, anchorY: 9 },
  destination: {
    url: svgUrl(28, 34, '<path d="M14 33c-8-10-13-15-13-21a13 13 0 0 1 26 0c0 6-5 11-13 21z" fill="#c5221f" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="12" r="4.6" fill="#fff"/>'),
    width: 28,
    height: 34,
    anchorY: 33,
  },
  stop: { url: svgUrl(22, 22, '<circle cx="11" cy="11" r="9" fill="#fff" stroke="#1a73e8" stroke-width="3"/>'), width: 22, height: 22, anchorY: 11 },
  shop: { url: svgUrl(15, 15, '<rect x="1.5" y="1.5" width="12" height="12" rx="3" fill="#3c4043" stroke="#fff" stroke-width="1.5"/>'), width: 15, height: 15, anchorY: 7.5 },
} satisfies Record<ScenePin["kind"], { url: string; width: number; height: number; anchorY: number }>;

const CHEVRON = { url: svgUrl(12, 12, '<path d="M4 2.5l4 3.5-4 3.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'), width: 12, height: 12, anchorY: 6 };

/** How the layers can see the screen, for labels that must stay on it. Without it they take their default side. */
export interface LabelView {
  /** The map's width, less the column of round buttons at its right edge. */
  width: number;
  /** Screen x of a place, in CSS pixels from the map's left edge. */
  screenX: (position: LngLat) => number;
  /** Screen y of a place, in CSS pixels from the map's top edge. Without it labels are not thinned out. */
  screenY?: (position: LngLat) => number;
}

interface Label {
  position: LngLat;
  text: string;
  anchor: "start" | "middle" | "end";
  offset: [number, number];
}

/** Inter at 12.5 px, semibold: close enough to keep a label on screen. */
const textWidthPx = (text: string, size: number) => text.length * size * 0.53;

/**
 * Labels that would overlap one already placed are left out (their pins stay), in list order.
 * Boxes are estimated from the text length, which is close enough to keep labels apart.
 */
function thinLabels(labels: Label[], view: LabelView | undefined, size = 12.5): Label[] {
  const screenY = view?.screenY;
  if (!view || !screenY) return labels;
  const placed: [number, number, number, number][] = [];
  const height = size + 6;
  return labels.filter((label) => {
    const width = textWidthPx(label.text, size) + 6;
    const x = view.screenX(label.position) + label.offset[0];
    const y = screenY(label.position) + label.offset[1];
    const left = label.anchor === "start" ? x : label.anchor === "end" ? x - width : x - width / 2;
    const box: [number, number, number, number] = [left, y - height / 2, left + width, y + height / 2];
    if (placed.some((p) => box[0] < p[2] && p[0] < box[2] && box[1] < p[3] && p[1] < box[3])) return false;
    placed.push(box);
    return true;
  });
}

/** deck.gl angles turn counter-clockwise from east; a bearing turns clockwise from north. */
const angleOf = (bearingDeg: number) => 90 - bearingDeg;

/**
 * Class I mainline coloured by owner. Stays mounted while hidden so toggling it back on does not
 * re-tessellate 4 MB of track; dims when a route needs the attention.
 */
export function networkLayer(network: Mainline, visible: boolean, dimmed: boolean, colors: ThemeColors): LayersList[number] {
  return new GeoJsonLayer<{ owner: string }>({
    id: LAYER.network,
    data: network,
    visible,
    opacity: dimmed ? 0.35 : 0.8,
    filled: false,
    lineWidthUnits: "pixels",
    lineCapRounded: true,
    lineJointRounded: true,
    getLineWidth: (f) => (isClassI(f.properties.owner) ? 1.8 : 1),
    getLineColor: (f) => (isClassI(f.properties.owner) ? colors.rail[f.properties.owner] : colors.muted),
    updateTriggers: { getLineColor: colors },
  });
}

type Leg = SceneRoute["legs"][number];
type Chevron = SceneRoute["chevrons"][number];
type Interchange = SceneRoute["interchanges"][number];
type AltLeg = Leg & { option: SceneRoute["id"] };

/** The selected route: a white casing so it stands out, each section in its railroad's colour, and chevrons for the direction of travel. */
function selectedRouteLayers(route: SceneRoute, colors: ThemeColors, zoom: number): LayersList {
  return [
    new PathLayer<Leg>({ id: LAYER.routeCasing, data: route.legs, getPath: (leg) => leg.path, getColor: colors.casing, getWidth: 11, ...ROUND, updateTriggers: { getColor: colors } }),
    new PathLayer<Leg>({
      id: LAYER.route,
      data: route.legs,
      getPath: (leg) => leg.path,
      getColor: (leg) => colors.rail[leg.railroad],
      getWidth: 6,
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

function textLayer(id: string, data: Label[], colors: ThemeColors, size = 12.5) {
  return new TextLayer<Label>({
    id,
    data,
    getPosition: (label) => label.position,
    getText: (label) => label.text,
    getTextAnchor: (label) => label.anchor,
    getAlignmentBaseline: "center",
    getPixelOffset: (label) => label.offset,
    getSize: size,
    getColor: colors.fg,
    fontFamily: FONT,
    fontWeight: 600,
    characterSet: "auto",
    outlineWidth: 4,
    outlineColor: fade(colors.casing, 230),
    fontSettings: { sdf: true },
    updateTriggers: { getColor: colors },
  });
}

/**
 * Pins, and labels for the pins `labelled` picks. A label goes on its pin's side unless it would leave
 * the screen there; one that would overlap another is left out (its pin stays).
 */
function pinLayers(pins: ScenePin[], colors: ThemeColors, view: LabelView | undefined, labelled: (pin: ScenePin) => string | null): LayersList {
  const labels: Label[] = pins.flatMap((pin): Label[] => {
    const text = labelled(pin);
    if (text === null) return [];
    const x = view?.screenX(pin.position) ?? null;
    const room = textWidthPx(text, 12.5) + 16 + 8;
    let side = pin.side;
    if (x !== null && view) {
      if (side > 0 && x + room > view.width && x - room >= 0) side = -1;
      else if (side < 0 && x - room < 0 && x + room <= view.width) side = 1;
    }
    return [{ position: pin.position, text, anchor: side > 0 ? "start" : "end", offset: [side * 16, pin.kind === "destination" ? -14 : 0] }];
  });
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
      fontFamily: FONT,
      fontWeight: 700,
      updateTriggers: { getColor: colors },
    }),
    textLayer(LAYER.labels, thinLabels(labels, view), colors),
  ];
}

/**
 * Bottom to top, by scene kind:
 *   route  alternatives (thin, grey) · selected casing · selected route by railroad · chevrons ·
 *          interchange rings · pins · start and destination names
 *   shops  shop squares · their names
 * The route pills and the turn-back markers are DOM, over all of these (./RouteMarks.tsx).
 */
export function sceneLayers(scene: MapScene, colors: ThemeColors, zoom: number, view?: LabelView): LayersList {
  if (scene.kind === "shops") return pinLayers(scene.pins, colors, view, (pin) => (pin.kind === "shop" || pin.glyph === "+" ? pin.label : null));

  const alternatives: AltLeg[] = scene.alternatives.flatMap((route) => route.legs.map((leg) => ({ ...leg, option: route.id })));
  return [
    new PathLayer<AltLeg>({
      id: LAYER.alternativesCasing,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: fade(colors.casing, 180),
      getWidth: 6,
      ...ROUND,
      updateTriggers: { getColor: colors },
    }),
    new PathLayer<AltLeg>({
      id: LAYER.alternatives,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: fade(colors.alternative, 150),
      getWidth: 4,
      ...ROUND,
      pickable: true,
      autoHighlight: true,
      highlightColor: fade(colors.route, 140),
      updateTriggers: { getColor: colors },
    }),
    ...(scene.selected ? selectedRouteLayers(scene.selected, colors, zoom) : []),
    ...pinLayers(scene.pins, colors, view, (pin) => (pin.kind === "start" || pin.kind === "destination" ? shortPlace(pin.label) : null)),
  ];
}

const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: "var(--panel)",
  color: "var(--fg)",
  border: "1px solid var(--line)",
  borderRadius: "8px",
  boxShadow: "0 2px 10px rgb(0 0 0 / 0.15)",
  padding: "5px 9px",
  fontFamily: "var(--sans)",
  fontSize: "12.5px",
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
    return { text: `${x.from} → ${x.to}${x.place ? ` · ${x.place}` : ""}`, style: TOOLTIP_STYLE };
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
