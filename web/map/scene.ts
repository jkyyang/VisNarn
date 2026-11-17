/**
 * What the map draws, as plain data. No map library in here: ./layers.ts is a direct rendering of a
 * scene, and the screens build scenes from domain values with the functions below.
 */
import type { CarSummary, CheckedCar } from "../../shared/cars.ts";
import { haversineKm, type Bounds, type LngLat } from "../../shared/geo.ts";
import type { ResolvedPlace, ShopView } from "../../shared/places.ts";
import type { Railroad } from "../../shared/railroads.ts";
import type { RouteOption, RouteStrategy, TurnBack } from "../../shared/route.ts";
import { fmtKmShort, fmtWindow } from "../format.ts";
import { pillsOf, shortPlace, type Pill } from "../words.ts";

export type PinKind = "a" | "b" | "shop" | "stop";

export interface ScenePin {
  kind: PinKind;
  /** Drawn inside the pin: A, B, the shop mark, or the stop number. */
  glyph: string;
  label: string;
  position: LngLat;
  /** Which side the label goes on, so neighbouring labels point away from each other. */
  side: -1 | 1;
}

/** One route as drawn: a path per leg with its railroad colour, and chevrons along it for the direction of travel. */
export interface SceneRoute {
  id: RouteStrategy;
  legs: { railroad: Railroad; path: LngLat[] }[];
  /** Arrowheads at a few zoom spacings: position and bearing. */
  chevrons: { position: LngLat; bearingDeg: number; minZoom: number }[];
  /** "BNSF · 1,046 km" / "about Thu 19 night – Fri 20 early". */
  callout: { position: LngLat; title: string; sub: string };
  interchanges: { position: LngLat; from: Railroad; to: Railroad; place: string }[];
}

export interface SceneCar {
  row: number;
  carId: string;
  position: LngLat;
  pill: Pill;
  selected: boolean;
}

export type MapScene =
  | {
      kind: "route";
      selected: SceneRoute;
      /** The other options, drawn grey underneath; clicking one selects it. */
      alternatives: SceneRoute[];
      /** Fix route only: the route before the person's stops, grey and dashed. */
      ghost: SceneRoute | null;
      /** A → B, dashed, with one arrow toward B: the car is somewhere on it. */
      approach: LngLat[][];
      pins: ScenePin[];
      /** A ring at each place the selected route reverses. */
      turnBacks: { index: number; position: LngLat; turnBack: TurnBack }[];
      bounds: Bounds;
    }
  | {
      kind: "fleet";
      /** One marker per checked car, at its node B. Once the selected car's route is in, its pins mark it instead. */
      cars: SceneCar[];
      selected: SceneRoute | null;
      /** The selected car's A, B and shop, as on the Route screen. */
      pins: ScenePin[];
      /** The selected car's A → B line. */
      approach: LngLat[][];
      /** From B to the shop as the crow flies, for "straight line 661 km". */
      straight: { path: [LngLat, LngLat]; label: string; side: -1 | 1 } | null;
      bounds: Bounds;
    }
  | { kind: "shops"; pins: ScenePin[]; bounds: Bounds };

/** Something in the scene the user clicked. */
export type SceneTarget = { kind: "option"; id: RouteStrategy } | { kind: "car"; row: number } | { kind: "turn-back"; index: number };

/** The Class I network end to end: where a scene with nothing in it is framed. */
export const NETWORK_BOUNDS: Bounds = [-125, 24, -66, 55];

/** Chevrons every 10 km; every 4th also shows from zoom 6, every 16th at any zoom. Spacing on screen stays near 25 px. */
const CHEVRON_KM = 10;
const chevronMinZoom = (i: number) => (i % 16 === 0 ? 0 : i % 4 === 0 ? 6 : 8);

function bearingDeg([lon1, lat1]: LngLat, [lon2, lat2]: LngLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

/** Points every CHEVRON_KM along a path, each with the bearing of the segment it is on. */
function chevronsAlong(path: LngLat[]): SceneRoute["chevrons"] {
  const out: SceneRoute["chevrons"] = [];
  let next = CHEVRON_KM / 2;
  let walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [p, q] = [path[i], path[i + 1]];
    const length = haversineKm(p[0], p[1], q[0], q[1]);
    if (length === 0) continue;
    const bearing = bearingDeg(p, q);
    while (next <= walked + length) {
      const t = (next - walked) / length;
      const index = Math.round((next - CHEVRON_KM / 2) / CHEVRON_KM);
      out.push({ position: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], bearingDeg: bearing, minZoom: chevronMinZoom(index) });
      next += CHEVRON_KM;
    }
    walked += length;
  }
  return out;
}

function sceneRoute(option: RouteOption, car: CheckedCar): SceneRoute {
  const legs = option.legs.filter((leg) => leg.path.length >= 2).map((leg) => ({ railroad: leg.railroad, path: leg.path }));
  const interchanges: SceneRoute["interchanges"] = [];
  const changes = option.steps.filter((step) => step.kind === "interchange");
  for (let i = 1, c = 0; i < legs.length; i++) {
    if (legs[i].railroad === legs[i - 1].railroad) continue;
    const step = changes[c++];
    interchanges.push({ position: legs[i].path[0], from: legs[i - 1].railroad, to: legs[i].railroad, place: step && step.kind === "interchange" ? step.at : "" });
  }
  const longest = option.legs.reduce((best, leg) => (leg.km > best.km && leg.path.length ? leg : best), option.legs[0]);
  const mid = longest?.path[Math.floor(longest.path.length / 2)] ?? [car.places.shop.place.lon, car.places.shop.place.lat];
  const changesWord = option.interchanges ? `${option.interchanges} interchange${option.interchanges === 1 ? "" : "s"} · ` : "";
  return {
    id: option.id,
    legs,
    chevrons: legs.flatMap((leg) => chevronsAlong(leg.path)),
    callout: {
      position: mid,
      title: `${option.railroads.join(" + ")} · ${fmtKmShort(option.km)}`,
      sub: changesWord + fmtWindow(option.verdict.arrival, car.assumptions.timing.basis),
    },
    interchanges,
  };
}

/**
 * Moves each route's callout to the point of its middle stretch farthest from the other routes, so
 * that routes which share their middle (as alternatives often do) do not stack their labels.
 */
function spreadCallouts(routes: SceneRoute[]): void {
  if (routes.length < 2) return;
  const sample = (route: SceneRoute) => {
    const points = route.legs.flatMap((leg) => leg.path);
    const step = Math.max(1, Math.floor(points.length / 60));
    return points.filter((_, i) => i % step === 0);
  };
  const samples = routes.map(sample);
  const gap = ([x1, y1]: LngLat, [x2, y2]: LngLat) => Math.hypot((x1 - x2) * Math.cos((y1 * Math.PI) / 180), y1 - y2);
  routes.forEach((route, r) => {
    const own = samples[r];
    const others = samples.filter((_, i) => i !== r).flat();
    const from = Math.floor(own.length * 0.2);
    const to = Math.max(from + 1, Math.ceil(own.length * 0.8));
    let best: LngLat | null = null;
    let bestGap = -1;
    for (const point of own.slice(from, to)) {
      const nearest = others.reduce((min, other) => Math.min(min, gap(point, other)), Infinity);
      if (nearest > bestGap) {
        bestGap = nearest;
        best = point;
      }
    }
    if (best) route.callout = { ...route.callout, position: best };
  });
}

class BoundsBuilder {
  private west = Infinity;
  private south = Infinity;
  private east = -Infinity;
  private north = -Infinity;

  add([lon, lat]: LngLat): void {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    this.west = Math.min(this.west, lon);
    this.south = Math.min(this.south, lat);
    this.east = Math.max(this.east, lon);
    this.north = Math.max(this.north, lat);
  }

  addAll(points: LngLat[]): void {
    for (const p of points) this.add(p);
  }

  /** A lone point still gets a small box around it. */
  done(): Bounds {
    if (this.west === Infinity) return NETWORK_BOUNDS;
    const pad = this.east - this.west < 0.05 && this.north - this.south < 0.05 ? 0.25 : 0;
    return [this.west - pad, this.south - pad, this.east + pad, this.north + pad];
  }
}

/** "Taylor, TX" → "Taylor": a pin label has little room. */
const pinName = (label: string) => shortPlace(label);

/** Where the car's A, B and shop are drawn for one option, with their pins and the A → B line. */
function carMarks(car: CheckedCar, option: RouteOption) {
  const { a, b, shop, stops } = car.places;
  const approach = car.approach.paths.filter((path) => path.length >= 2);
  const firstLeg = option.legs.find((leg) => leg.path.length);
  const lastLeg = [...option.legs].reverse().find((leg) => leg.path.length);

  const aAt: LngLat = approach[0]?.[0] ?? [a.place.lon, a.place.lat];
  const bAt: LngLat = firstLeg?.path[0] ?? approach[approach.length - 1]?.at(-1) ?? [b.place.lon, b.place.lat];
  const shopAt: LngLat = lastLeg?.path[lastLeg.path.length - 1] ?? [shop.place.lon, shop.place.lat];
  const aSide: -1 | 1 = aAt[0] <= bAt[0] ? -1 : 1;
  const stopPins: ScenePin[] = stops.map((stop, i) => ({
    kind: "stop",
    glyph: String(i + 1),
    label: stop.place.label,
    position: [stop.place.lon, stop.place.lat],
    side: 1,
  }));
  const beforeShop = stopPins[stopPins.length - 1]?.position ?? bAt;
  const pins: ScenePin[] = [
    { kind: "a", glyph: "A", label: `A · ${pinName(a.place.label)}`, position: aAt, side: aSide },
    { kind: "b", glyph: "B", label: `B · ${pinName(b.place.label)}`, position: bAt, side: aSide === -1 ? 1 : -1 },
    ...stopPins,
    { kind: "shop", glyph: "", label: `Shop · ${pinName(shop.place.label)}`, position: shopAt, side: shopAt[0] >= beforeShop[0] ? 1 : -1 },
  ];
  return { pins, approach: approach.length ? approach : [[aAt, bAt]], bAt, shopAt };
}

/** Main and Fix route: the selected option on top of the others. `ghost` is the same car checked without the person's stops. */
export function routeScene(car: CheckedCar, selected: RouteStrategy, ghost: RouteOption | null): MapScene {
  const option = car.options.find((o) => o.id === selected) ?? car.options[0];
  const { pins, approach } = carMarks(car, option);

  const bounds = new BoundsBuilder();
  for (const o of car.options) for (const leg of o.legs) bounds.addAll(leg.path);
  if (ghost) for (const leg of ghost.legs) bounds.addAll(leg.path);
  for (const path of approach) bounds.addAll(path);
  bounds.addAll(pins.map((pin) => pin.position));

  const selectedRoute = sceneRoute(option, car);
  const alternatives = car.options.filter((o) => o.id !== option.id).map((o) => sceneRoute(o, car));
  spreadCallouts([selectedRoute, ...alternatives]);

  return {
    kind: "route",
    selected: selectedRoute,
    alternatives,
    ghost: ghost ? sceneRoute(ghost, car) : null,
    approach,
    pins,
    turnBacks: option.turnBacks.map((turnBack, index) => ({ index, position: [turnBack.at.lon, turnBack.at.lat], turnBack })),
    bounds: bounds.done(),
  };
}

/** Cars: the whole batch on one map, and the selected car's route, pins and A → B line once its check has loaded. */
export function fleetScene(cars: CarSummary[], selectedRow: number | null, selected: CheckedCar | null): MapScene {
  const marks = selected ? carMarks(selected, selected.options[0]) : null;
  const sceneCars: SceneCar[] = [];
  for (const car of cars) {
    if (car.check.outcome !== "checked") continue;
    sceneCars.push({ row: car.row, carId: car.carId, position: car.check.at, pill: pillsOf(car.check)[0], selected: car.row === selectedRow });
  }
  const bounds = new BoundsBuilder();
  bounds.addAll(sceneCars.map((car) => car.position));
  const route = selected ? sceneRoute(selected.options[0], selected) : null;
  if (route) for (const leg of route.legs) bounds.addAll(leg.path);
  if (marks) {
    bounds.addAll(marks.pins.map((pin) => pin.position));
    for (const path of marks.approach) bounds.addAll(path);
  }
  // The selected car on top, so its marker is never hidden under a neighbour's.
  sceneCars.sort((x, y) => Number(x.selected) - Number(y.selected));
  return {
    kind: "fleet",
    cars: sceneCars,
    selected: route,
    pins: marks?.pins ?? [],
    approach: marks?.approach ?? [],
    // Its label goes on the side away from the shop's, which hangs off the same end of the line.
    straight: marks && selected ? { path: [marks.bAt, marks.shopAt], label: `straight line ${fmtKmShort(selected.straightKm)}`, side: marks.pins[marks.pins.length - 1].side === 1 ? -1 : 1 } : null,
    bounds: bounds.done(),
  };
}

/** Shops: every shop that is on the network, and the place being edited. */
export function shopsScene(shops: ShopView[], editing: Pick<ResolvedPlace, "label" | "lon" | "lat"> | null): MapScene {
  const pins: ScenePin[] = [];
  for (const shop of shops) {
    if (!shop.place.ok) continue;
    pins.push({ kind: "shop", glyph: "", label: shop.name, position: [shop.place.place.lon, shop.place.place.lat], side: 1 });
  }
  if (editing) pins.push({ kind: "stop", glyph: "+", label: editing.label, position: [editing.lon, editing.lat], side: 1 });
  const bounds = new BoundsBuilder();
  bounds.addAll(pins.map((pin) => pin.position));
  return { kind: "shops", pins, bounds: bounds.done() };
}
