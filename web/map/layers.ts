/** deck.gl layers for a scene: the Class I network underneath, the scene on top. The only file that knows deck.gl layer classes. */
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer, type LayersList, type PickingInfo } from "deck.gl";
import type { LngLat } from "../../shared/geo.ts";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import type { RGBA, ThemeColors } from "../theme.ts";
import { shapeDataUrl } from "../ui/shapes.ts";
import { PILL_LABELS, trackWords, turnBackMove } from "../words.ts";
import type { MapScene, SceneCar, ScenePin, SceneRoute, SceneTarget } from "./scene.ts";

export const LAYER = {
  network: "class1-network",
  alternativesCasing: "alternatives-casing",
  alternatives: "alternatives",
  ghost: "ghost",
  approachCasing: "approach-casing",
  approach: "approach",
  approachArrow: "approach-arrow",
  routeCasing: "route-casing",
  route: "route",
  chevrons: "chevrons",
  interchanges: "interchanges",
  turnBacks: "turn-backs",
  turnBackLabels: "turn-back-labels",
  straight: "straight-line",
  straightLabel: "straight-line-label",
  cars: "cars",
  carShapes: "car-shapes",
  carSelected: "car-selected",
  turnBackLeaders: "turn-back-leaders",
  pins: "pins",
  pinGlyphs: "pin-glyphs",
  labels: "labels",
  callouts: "callouts",
} as const;

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const ROUND = { widthUnits: "pixels", capRounded: true, jointRounded: true } as const;
/** Round caps would fill every gap shorter than the line is wide: deck.gl draws a cap at both ends of each dash. */
const DASHED = { widthUnits: "pixels", capRounded: false, jointRounded: true } as const;
const isClassI = (owner: string): owner is Railroad => (RAILROADS as readonly string[]).includes(owner);
const fade = ([r, g, b]: RGBA, alpha: number): RGBA => [r, g, b, alpha];
const TURN: RGBA = [176, 96, 0, 255];

const svgUrl = (width: number, height: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)}`;

/** Pins as images: their shapes come from the mockups (A hollow grey, B blue drop, shop red drop with a square). */
const PIN_ICONS = {
  a: { url: svgUrl(18, 18, '<circle cx="9" cy="9" r="6" fill="#fff" stroke="#80868b" stroke-width="3"/>'), width: 18, height: 18, anchorY: 9 },
  b: {
    url: svgUrl(22, 28, '<path d="M11 27c-6-8-10-12-10-17a10 10 0 0 1 20 0c0 5-4 9-10 17z" fill="#1a73e8" stroke="#fff" stroke-width="1.5"/><circle cx="11" cy="10" r="3.6" fill="#fff"/>'),
    width: 22,
    height: 28,
    anchorY: 27,
  },
  shop: {
    url: svgUrl(28, 34, '<path d="M14 33c-8-10-13-15-13-21a13 13 0 0 1 26 0c0 6-5 11-13 21z" fill="#c5221f" stroke="#fff" stroke-width="1.5"/><rect x="9" y="7" width="10" height="10" rx="1.5" fill="#fff"/>'),
    width: 28,
    height: 34,
    anchorY: 33,
  },
  stop: { url: svgUrl(22, 22, '<circle cx="11" cy="11" r="9" fill="#fff" stroke="#1a73e8" stroke-width="3"/>'), width: 22, height: 22, anchorY: 11 },
} satisfies Record<ScenePin["kind"], { url: string; width: number; height: number; anchorY: number }>;

const CHEVRON = { url: svgUrl(12, 12, '<path d="M4 2.5l4 3.5-4 3.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'), width: 12, height: 12, anchorY: 6 };
const ARROW = { url: svgUrl(14, 14, '<path d="M2 2l10 5-10 5z" fill="#5f6368" stroke="#fff" stroke-width="1"/>'), width: 14, height: 14, anchorY: 7 };
const LEADER_PX = 14;
const LEADER = { url: svgUrl(LEADER_PX, 4, `<path d="M0 2h${LEADER_PX}" stroke="#b06000" stroke-width="2"/>`), width: LEADER_PX, height: 4, anchorY: 2 };
/** The turn-back ring's outer edge, in pixels from its centre (radius 15 plus half its 3.5 px line). */
const RING_EDGE_PX = 17;
/** The callout sits a little below the ring's centre: B's label, often at the same place, hangs above it. */
const CALLOUT_DROP_PX = 9;

/** How the layers can see the screen, for labels that must stay on it. Without it they take their default side. */
export interface LabelView {
  /** A phone: shorter labels, and no route boxes. */
  compact: boolean;
  /** The map's width, less the column of round buttons at its right edge. */
  width: number;
  /** Screen x of a place, in CSS pixels from the map's left edge. */
  screenX: (position: LngLat) => number;
  /** Screen y of a place, in CSS pixels from the map's top edge. Without it labels are not thinned out. */
  screenY?: (position: LngLat) => number;
}

/**
 * Labels that would overlap one already placed are left out (their pins stay), in list order.
 * Boxes are estimated from the text length, which is close enough to keep labels apart.
 */
function thinLabels(labels: Label[], view: LabelView | undefined, size = 12.5): Label[] {
  if (!view?.screenY) return labels;
  const placed: [number, number, number, number][] = [];
  const height = size + 6;
  return labels.filter((label) => {
    const width = textWidthPx(label.text, size) + 6;
    const x = view.screenX(label.position) + label.offset[0];
    const y = view.screenY!(label.position) + label.offset[1];
    const left = label.anchor === "start" ? x : label.anchor === "end" ? x - width : x - width / 2;
    const box: [number, number, number, number] = [left, y - height / 2, left + width, y + height / 2];
    if (placed.some((p) => box[0] < p[2] && p[0] < box[2] && box[1] < p[3] && p[1] < box[3])) return false;
    placed.push(box);
    return true;
  });
}

/** Inter at 12.5 px, semibold: close enough to keep a label on screen. */
const textWidthPx = (text: string, size: number) => text.length * size * 0.53;

/** deck.gl angles turn counter-clockwise from east; a bearing turns clockwise from north. */
const angleOf = (bearingDeg: number) => 90 - bearingDeg;

function lastBearing(path: LngLat[]): number {
  const [p, q] = [path[path.length - 2], path[path.length - 1]];
  const r = Math.PI / 180;
  const y = Math.sin((q[0] - p[0]) * r) * Math.cos(q[1] * r);
  const x = Math.cos(p[1] * r) * Math.sin(q[1] * r) - Math.sin(p[1] * r) * Math.cos(q[1] * r) * Math.cos((q[0] - p[0]) * r);
  return Math.atan2(y, x) / r;
}

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
type AltLeg = Leg & { option: SceneRoute["id"] };
type TurnBackMark = Extract<MapScene, { kind: "route" }>["turnBacks"][number];

interface Label {
  position: LngLat;
  text: string;
  anchor: "start" | "middle" | "end";
  offset: [number, number];
}

/** The selected route: white casing, the line, and white chevrons for the direction of travel. */
function selectedRouteLayers(route: SceneRoute, colors: ThemeColors, zoom: number): LayersList {
  return [
    new PathLayer<Leg>({ id: LAYER.routeCasing, data: route.legs, getPath: (leg) => leg.path, getColor: colors.casing, getWidth: 11, ...ROUND }),
    new PathLayer<Leg>({
      id: LAYER.route,
      data: route.legs,
      getPath: (leg) => leg.path,
      getColor: colors.route,
      getWidth: 6,
      ...ROUND,
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
    new ScatterplotLayer<SceneRoute["interchanges"][number]>({
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

/** The white boxes beside each route: what it is and when it arrives. The selected route's box has a blue edge. */
function calloutLayer(labels: (Label & { selected: boolean })[], colors: ThemeColors) {
  return new TextLayer<Label & { selected: boolean }>({
    id: LAYER.callouts,
    data: labels,
    getPosition: (label) => label.position,
    getText: (label) => label.text,
    getTextAnchor: "start",
    getAlignmentBaseline: "center",
    getPixelOffset: [16, 0],
    getSize: 12,
    lineHeight: 1.35,
    getColor: colors.fg,
    fontFamily: FONT,
    fontWeight: 600,
    characterSet: "auto",
    background: true,
    backgroundPadding: [9, 6],
    getBackgroundColor: colors.casing,
    getBorderColor: (label) => (label.selected ? colors.route : fade(colors.alternative, 200)),
    getBorderWidth: (label) => (label.selected ? 2 : 1),
    updateTriggers: { getColor: colors, getBackgroundColor: colors, getBorderColor: colors },
  });
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
 * "Turns back here: check" as a white pill with an orange edge, beside the ring and joined to it by
 * a short line, as on the canvas. It goes left of the ring unless that would leave the screen. On a
 * phone it is shorter and sits above the ring.
 */
function turnBackCalloutLayers(marks: TurnBackMark[], colors: ThemeColors, view: LabelView | undefined): LayersList {
  const compact = view?.compact ?? false;
  const text = compact ? "Turns back: check" : "Turns back here: check";
  const size = compact ? 13 : 12.5;
  const [padX, padY] = [10, 6];
  const boxWidth = textWidthPx(text, size) + 2 * padX;
  const placed = marks.map((mark) => {
    const x = view?.screenX(mark.position) ?? null;
    if (compact) {
      // Above the ring, starting a little to its left, but never past either edge of the map.
      const left = x === null ? -32 : Math.min(Math.max(x - 32, 8), (view?.width ?? Infinity) - 8 - boxWidth) - x;
      return { mark, offset: [left + padX, -(RING_EDGE_PX + 14)] as [number, number], leader: null };
    }
    const fitsLeft = x === null || x - RING_EDGE_PX - LEADER_PX - boxWidth >= 8;
    const side = fitsLeft ? -1 : 1;
    return {
      mark,
      offset: [side * (RING_EDGE_PX + LEADER_PX + padX), CALLOUT_DROP_PX] as [number, number],
      leader: [side * (RING_EDGE_PX + LEADER_PX / 2), CALLOUT_DROP_PX] as [number, number],
    };
  });
  type Placed = (typeof placed)[number];
  return [
    new IconLayer<Placed>({
      id: LAYER.turnBackLeaders,
      data: placed.filter((p) => p.leader),
      getPosition: (p) => p.mark.position,
      getIcon: () => LEADER,
      getSize: 4,
      sizeUnits: "pixels",
      getPixelOffset: (p) => p.leader ?? [0, 0],
    }),
    new TextLayer<Placed>({
      id: LAYER.turnBackLabels,
      data: placed,
      getPosition: (p) => p.mark.position,
      getText: () => text,
      getTextAnchor: (p) => (compact || p.offset[0] > 0 ? "start" : "end"),
      getAlignmentBaseline: (p) => (compact ? "bottom" : "center"),
      getPixelOffset: (p) => p.offset,
      getSize: size,
      getColor: colors.warn,
      fontFamily: FONT,
      fontWeight: 600,
      characterSet: "auto",
      background: true,
      backgroundPadding: [padX, padY],
      getBackgroundColor: colors.panel,
      getBorderColor: colors.warn,
      getBorderWidth: 1.5,
      updateTriggers: { getColor: colors, getBackgroundColor: colors, getBorderColor: colors },
    }),
  ];
}

/**
 * The A → B line: the first part of the car's route, in the route colour, so the route reads from A.
 * Dashed, with one arrow toward B, because the car is somewhere on it and the report does not say where.
 */
function approachLayers(approach: LngLat[][], colors: ThemeColors): LayersList {
  const end = approach[approach.length - 1];
  return [
    new PathLayer<LngLat[]>({ id: LAYER.approachCasing, data: approach, getPath: (path) => path, getColor: colors.casing, getWidth: 9, ...ROUND }),
    new PathLayer<LngLat[], PathStyleExtensionProps<LngLat[]>>({
      id: LAYER.approach,
      data: approach,
      getPath: (path) => path,
      getColor: colors.route,
      getWidth: 5,
      ...DASHED,
      extensions: [new PathStyleExtension({ dash: true })],
      // In half line-widths: 6 px dashes and 6 px gaps at 5 px wide, so the gaps stay open.
      getDashArray: [2.4, 2.4],
      updateTriggers: { getColor: colors },
    }),
    new IconLayer<LngLat[]>({
      id: LAYER.approachArrow,
      data: end && end.length >= 2 ? [end] : [],
      getPosition: (path) => path[path.length - 1],
      getIcon: () => ARROW,
      getAngle: (path) => angleOf(lastBearing(path)),
      getPixelOffset: [0, 0],
      getSize: 14,
      sizeUnits: "pixels",
    }),
  ];
}

/** The last word of a car id, as the markers have room for: "EXAMPLE 104233" → "104233". */
const shortCarId = (carId: string) => carId.trim().split(/\s+/).pop() ?? carId;

/**
 * Every car as a white pill at its node B: the status shape, then the car number, edged and written
 * in the status colour (word + shape + colour; the word is in the tooltip and the list).
 */
function carMarkerLayers(cars: SceneCar[], colors: ThemeColors): LayersList {
  const ringed = cars.filter((car) => car.selected);
  return [
    new ScatterplotLayer<SceneCar>({
      id: LAYER.carSelected,
      data: ringed,
      getPosition: (car) => car.position,
      radiusUnits: "pixels",
      getRadius: 16,
      getFillColor: fade(colors.route, 40),
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 3,
      getLineColor: colors.route,
      updateTriggers: { getFillColor: colors, getLineColor: colors },
    }),
    new TextLayer<SceneCar>({
      id: LAYER.cars,
      data: cars,
      getPosition: (car) => car.position,
      getText: (car) => shortCarId(car.carId),
      getTextAnchor: "start",
      getAlignmentBaseline: "center",
      getPixelOffset: [9, 0],
      getSize: 11.5,
      getColor: (car) => colors.status[car.pill],
      fontFamily: FONT,
      fontWeight: 600,
      characterSet: "auto",
      background: true,
      // The left side leaves room for the shape, drawn over the pill at the car's position.
      backgroundPadding: [17, 5, 9, 5],
      getBackgroundColor: colors.panel,
      getBorderColor: (car) => (car.selected ? colors.route : colors.status[car.pill]),
      getBorderWidth: (car) => (car.selected ? 2.5 : 1.5),
      pickable: true,
      updateTriggers: { getColor: colors, getBackgroundColor: colors, getBorderColor: colors },
    }),
    new IconLayer<SceneCar>({
      id: LAYER.carShapes,
      data: cars,
      getPosition: (car) => car.position,
      getIcon: (car) => ({ id: car.pill, url: shapeDataUrl(car.pill, 13), width: 13, height: 13 }),
      getSize: 13,
      sizeUnits: "pixels",
    }),
  ];
}

/**
 * Pins and their labels. A label goes on its pin's side unless it would leave the screen there; on
 * a phone the shop's label is just "Shop", as on the canvas.
 */
/** `collide`: many shops on one map; a label that would overlap another is hidden (its pin stays). */
function pinLayers(pins: ScenePin[], colors: ThemeColors, view?: LabelView, collide = false): LayersList {
  const labels: Label[] = pins
    .filter((pin) => pin.kind !== "stop" || pin.glyph === "+")
    .map((pin) => {
      const text = view?.compact && pin.kind === "shop" && pin.label.startsWith("Shop · ") ? "Shop" : pin.label;
      const x = view?.screenX(pin.position) ?? null;
      const room = textWidthPx(text, 12.5) + 16 + 8;
      let side = pin.side;
      if (x !== null && view) {
        if (side > 0 && x + room > view.width && x - room >= 0) side = -1;
        else if (side < 0 && x - room < 0 && x + room <= view.width) side = 1;
      }
      return { position: pin.position, text, anchor: side > 0 ? "start" : "end", offset: [side * 16, pin.kind === "shop" || pin.kind === "b" ? -14 : 0] };
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
    textLayer(LAYER.labels, collide ? thinLabels(labels, view) : labels, colors),
  ];
}

/**
 * Bottom to top, by scene kind:
 *   route  alternatives (grey) · ghost (grey dashed) · approach (dashed + arrow) · selected casing ·
 *          selected route · chevrons · interchange rings · turn-back rings · pins · labels ·
 *          turn-back callouts · route boxes
 *   fleet  selected car's route (as above, without alternatives) · straight line B to shop ·
 *          approach · car pills · pins · labels
 *   shops  shop pins · labels
 */
export function sceneLayers(scene: MapScene, colors: ThemeColors, zoom: number, view?: LabelView): LayersList {
  if (scene.kind === "shops") return pinLayers(scene.pins, colors, view, true);

  if (scene.kind === "fleet") {
    const straight = scene.straight;
    // Once the selected car's pins are drawn, they mark it; its pill would sit on top of the B pin.
    const markers = scene.pins.length ? scene.cars.filter((car) => !car.selected) : scene.cars;
    return [
      ...(scene.selected ? selectedRouteLayers(scene.selected, colors, zoom) : []),
      new PathLayer<[LngLat, LngLat], PathStyleExtensionProps<[LngLat, LngLat]>>({
        id: LAYER.straight,
        data: straight ? [straight.path] : [],
        getPath: (path) => path,
        getColor: fade(colors.route, 180),
        getWidth: 1.5,
        ...DASHED,
        extensions: [new PathStyleExtension({ dash: true })],
        getDashArray: [2.7, 5.3],
        updateTriggers: { getColor: colors },
      }),
      textLayer(
        LAYER.straightLabel,
        straight
          ? [{ position: [(straight.path[0][0] + straight.path[1][0]) / 2, (straight.path[0][1] + straight.path[1][1]) / 2], text: straight.label, anchor: straight.side > 0 ? "start" : "end", offset: [straight.side * 10, 0] }]
          : [],
        { ...colors, fg: colors.route },
        11.5,
      ),
      ...approachLayers(scene.approach, colors),
      ...carMarkerLayers(markers, colors),
      ...pinLayers(scene.pins, colors, view),
    ];
  }

  const alternatives: AltLeg[] = scene.alternatives.flatMap((route) => route.legs.map((leg) => ({ ...leg, option: route.id })));
  const callouts = [scene.selected, ...scene.alternatives].map((route, i) => ({
    position: route.callout.position,
    text: `${route.callout.title}\n${route.callout.sub}`,
    anchor: "start" as const,
    offset: [16, 0] as [number, number],
    selected: i === 0,
  }));

  return [
    new PathLayer<AltLeg>({ id: LAYER.alternativesCasing, data: alternatives, getPath: (leg) => leg.path, getColor: colors.casing, getWidth: 10, ...ROUND }),
    new PathLayer<AltLeg>({
      id: LAYER.alternatives,
      data: alternatives,
      getPath: (leg) => leg.path,
      getColor: colors.alternative,
      getWidth: 6,
      ...ROUND,
      pickable: true,
      autoHighlight: true,
      highlightColor: fade(colors.route, 120),
      updateTriggers: { getColor: colors },
    }),
    new PathLayer<Leg, PathStyleExtensionProps<Leg>>({
      id: LAYER.ghost,
      data: scene.ghost?.legs ?? [],
      getPath: (leg) => leg.path,
      getColor: colors.alternative,
      getWidth: 4,
      ...DASHED,
      extensions: [new PathStyleExtension({ dash: true })],
      // In half line-widths: 9 px dashes and 7 px gaps at 4 px wide, as on the canvas.
      getDashArray: [4.5, 3.5],
      dashJustified: true,
      updateTriggers: { getColor: colors },
    }),
    ...approachLayers(scene.approach, colors),
    ...selectedRouteLayers(scene.selected, colors, zoom),
    new ScatterplotLayer<TurnBackMark>({
      id: LAYER.turnBacks,
      data: scene.turnBacks,
      getPosition: (t) => t.position,
      radiusUnits: "pixels",
      getRadius: 15,
      filled: true,
      getFillColor: [255, 255, 255, 1],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 3.5,
      getLineColor: TURN,
      pickable: true,
    }),
    ...pinLayers(scene.pins, colors, view),
    ...turnBackCalloutLayers(scene.turnBacks, colors, view),
    calloutLayer(callouts, colors),
  ];
}

const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  backgroundColor: "var(--panel)",
  color: "var(--fg)",
  border: "1px solid var(--line)",
  borderRadius: "8px",
  boxShadow: "0 2px 10px rgb(0 0 0 / 0.15)",
  padding: "7px 10px",
  fontFamily: "var(--sans)",
  fontSize: "12.5px",
  lineHeight: "1.45",
  maxWidth: "280px",
  whiteSpace: "pre-line",
  marginLeft: "12px",
  marginTop: "12px",
};

/** Hover text for whatever is under the pointer; null for layers that are not pickable. */
export function sceneTooltip(info: PickingInfo): { text: string; style: Partial<CSSStyleDeclaration> } | null {
  const { layer, object } = info;
  if (!layer || !object) return null;
  let text: string;
  switch (layer.id) {
    case LAYER.route:
      text = `${(object as Leg).railroad}: the selected route`;
      break;
    case LAYER.alternatives:
      text = `Another route on ${(object as AltLeg).railroad}\nClick to compare`;
      break;
    case LAYER.interchanges: {
      const x = object as SceneRoute["interchanges"][number];
      text = `Change railroad ${x.from} → ${x.to}${x.place ? `\n${x.place}` : ""}`;
      break;
    }
    case LAYER.turnBacks: {
      const { turnBack } = object as TurnBackMark;
      const move = turnBackMove(turnBack);
      text = `Turns back here: check\n${turnBack.at.near} · ${trackWords(turnBack.track)}\nArrives ${move.arrives}, leaves ${move.leaves} (${Math.round(turnBack.turnDeg)}°)\nClick to look closer`;
      break;
    }
    case LAYER.pins: {
      const pin = object as ScenePin;
      const role = pin.kind === "a" ? "A · last passed" : pin.kind === "b" ? "B · next node" : pin.kind === "shop" ? "Shop" : `Stop ${pin.glyph}`;
      text = `${role}\n${pin.label.replace(/^(A|B|Shop) · /, "")}`;
      break;
    }
    case LAYER.cars: {
      const car = object as SceneCar;
      text = `${car.carId} · ${PILL_LABELS[car.pill]}\nDrawn at node B, its next node (from the report, not live)\nClick to see its route`;
      break;
    }
    default:
      return null;
  }
  return { text, style: TOOLTIP_STYLE };
}

/** What a click on a picked object means, for the screen to act on. */
export function sceneTarget(info: PickingInfo): SceneTarget | null {
  const { layer, object } = info;
  if (!layer || !object) return null;
  if (layer.id === LAYER.alternatives) return { kind: "option", id: (object as AltLeg).option };
  if (layer.id === LAYER.turnBacks) return { kind: "turn-back", index: (object as TurnBackMark).index };
  if (layer.id === LAYER.cars) return { kind: "car", row: (object as SceneCar).row };
  return null;
}
