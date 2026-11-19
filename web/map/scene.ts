/**
 * What the map draws, as plain data. No map library in here: ./layers.ts and ./RouteMarks.tsx are a
 * direct rendering of a scene, and the screens build scenes from domain values with the functions below.
 */
import { haversineKm, type Bounds, type LngLat } from "../../shared/geo.ts";
import { resolvedOf, type PlaceRef, type ResolvedPlace, type ShopId, type ShopView } from "../../shared/places.ts";
import { placeKind, type PlannedRoute } from "../../shared/plans.ts";
import type { Line } from "../../shared/railroads.ts";
import type { RoutePath, RouteStrategy, TurnBack } from "../../shared/route.ts";
import type { DistanceUnit } from "../units.ts";
import { pillText } from "../words.ts";

export type PinKind = "start" | "stop" | "destination" | "shop";

export interface ScenePin {
  kind: PinKind;
  /** Drawn inside the pin: the stop number. */
  glyph: string;
  label: string;
  position: LngLat;
  /** A shop square: clicking it puts that shop in the plan. */
  shopId: ShopId | null;
}

/** One route as drawn: a path per leg with its line colour, and chevrons along it for the direction of travel. */
export interface SceneRoute {
  id: RouteStrategy;
  /** `index`: the leg's place in the route's own legs, which the panel's rows go by. */
  legs: { railroad: Line; path: LngLat[]; index: number }[];
  /** Arrowheads at a few zoom spacings: position and bearing. */
  chevrons: { position: LngLat; bearingDeg: number; minZoom: number }[];
  /** `leg`: the leg (by `index`) that leaves the interchange. */
  interchanges: { position: LngLat; from: Line; to: Line; place: string; leg: number }[];
}

/** A small rounded label on the map for one route: click to select it. */
export interface ScenePill {
  id: RouteStrategy;
  /** "828 km" on the selected route; "+180 km · 1 more interchange" on another. */
  text: string;
  selected: boolean;
  turnBacks: number;
  /** Where it may sit, best first: on a stretch only this route runs. */
  anchors: LngLat[];
}

export type MapScene =
  | {
      kind: "route";
      selected: SceneRoute | null;
      /** The leg of the selected route picked in the panel or on the map (its `index`), drawn over the rest. */
      leg: number | null;
      /** The other routes, drawn thin and grey underneath; a click on one adds a stop on it. */
      alternatives: SceneRoute[];
      /** Empty unless there are two or more routes. */
      pills: ScenePill[];
      /** The selected route's turn-backs. */
      turnBacks: { position: LngLat; turnBack: TurnBack }[];
      pins: ScenePin[];
      /** Null until a route exists: no camera jump after the first click. */
      bounds: Bounds | null;
    }
  | {
      kind: "shops";
      pins: ScenePin[];
      /** The edited shop's own track to each node it joins. */
      links: SceneLink[];
      bounds: Bounds;
    };

/**
 * A shop's link as drawn, shop first: straight to its yard (dashed), then along the track to the node it joins (solid).
 * "offered": the suggestion a shop with no links may take; "ghost": where a drag would set it; "refused": where a drop
 * would set nothing, straight to the pointer.
 */
export interface SceneLink {
  path: LngLat[];
  look: "set" | "offered" | "ghost" | "refused";
}

/** The shop being edited on Shops, and its links. Its pin and its links' rings are handles on the map (./MapHandles.tsx), so the scene leaves them out. */
export interface EditedShop {
  /** Null for a new shop. */
  shopId: ShopId | null;
  at: LngLat;
  links: SceneLink[];
}

/** Something in the scene the user clicked: a route to select, a leg of the selected one (by its `index`), or a place to put in the plan. */
export type SceneTarget = { kind: "option"; id: RouteStrategy } | { kind: "leg"; index: number } | { kind: "place"; ref: PlaceRef; position: LngLat };

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

const kmBetween = (p: LngLat, q: LngLat) => haversineKm(p[0], p[1], q[0], q[1]);

/** Points every CHEVRON_KM along a path, each with the bearing of the segment it is on. */
function chevronsAlong(path: LngLat[]): SceneRoute["chevrons"] {
  const out: SceneRoute["chevrons"] = [];
  let next = CHEVRON_KM / 2;
  let walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const [p, q] = [path[i], path[i + 1]];
    const length = kmBetween(p, q);
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

function sceneRoute(route: RoutePath): SceneRoute {
  const legs = route.legs.flatMap((leg, index) => (leg.path.length >= 2 ? [{ railroad: leg.railroad, path: leg.path, index }] : []));
  const interchanges: SceneRoute["interchanges"] = [];
  const changes = route.steps.filter((step) => step.kind === "interchange");
  for (let i = 1, c = 0; i < legs.length; i++) {
    if (legs[i].railroad === legs[i - 1].railroad) continue;
    const step = changes[c++];
    interchanges.push({ position: legs[i].path[0], from: legs[i - 1].railroad, to: legs[i].railroad, place: step && step.kind === "interchange" ? step.at : "", leg: legs[i].index });
  }
  return { id: route.strategies[0], legs, chevrons: legs.flatMap((leg) => chevronsAlong(leg.path)), interchanges };
}

/** A route scene's routes in a fixed order (by id), whichever one is selected. */
function routesOf(scene: MapScene): SceneRoute[] {
  if (scene.kind !== "route") return [];
  const routes = scene.selected ? [scene.selected, ...scene.alternatives] : scene.alternatives;
  return [...routes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** A link of the shop or its suggestion, with track to follow: its foot in the yard and at least the node it joins. */
const onTrack = (link: SceneLink) => (link.look === "set" || link.look === "offered") && link.path.length > 2;

/**
 * What runs on track, in a fixed order: every leg's path, route by route (selecting another route asks for the same
 * paths again); on Shops, the piece of each link from its foot to the node it joins.
 */
export function routePaths(scene: MapScene): LngLat[][] {
  if (scene.kind === "shops") return scene.links.filter(onTrack).map((link) => link.path.slice(1));
  return routesOf(scene).flatMap((route) => route.legs.map((leg) => leg.path));
}

/**
 * The scene with its legs drawn along `paths`, given in routePaths order (the same legs on the real
 * track), and the chevrons placed along them again; on Shops, each link's piece on track. Paths that do
 * not fit leave the scene as it was.
 */
export function withRoutePaths(scene: MapScene, paths: LngLat[][]): MapScene {
  if (paths.length !== routePaths(scene).length) return scene;
  if (scene.kind === "shops") {
    let next = 0;
    return { ...scene, links: scene.links.map((link) => (onTrack(link) ? { ...link, path: [link.path[0], ...paths[next++]] } : link)) };
  }
  let next = 0;
  const redrawn = new Map(
    routesOf(scene).map((route) => {
      const legs = route.legs.map((leg) => ({ ...leg, path: paths[next++] }));
      return [route, { ...route, legs, chevrons: legs.flatMap((leg) => chevronsAlong(leg.path)) }];
    }),
  );
  return { ...scene, selected: scene.selected && redrawn.get(scene.selected)!, alternatives: scene.alternatives.map((route) => redrawn.get(route)!) };
}

/** The route whose strategies include `option`, else the router's own (the first). */
export function chosenRoute(routes: readonly RoutePath[], option: RouteStrategy | null): RoutePath {
  return (option ? routes.find((route) => route.strategies.includes(option)) : undefined) ?? routes[0];
}

/** Points on a route, at most this many, to compare it with the others. */
const SAMPLES = 200;
/** A sample this close to another route's is on a stretch they share. */
const SHARED_KM = 2;

function samplesOf(route: SceneRoute): LngLat[] {
  const points = route.legs.flatMap((leg) => leg.path);
  const step = Math.max(1, Math.ceil(points.length / SAMPLES));
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

/** The points at these shares of a run's length. */
function alongRun(run: LngLat[], shares: number[]): LngLat[] {
  if (run.length < 2) return run.length ? shares.map(() => run[0]) : [];
  const walked = [0];
  for (let i = 1; i < run.length; i++) walked.push(walked[i - 1] + kmBetween(run[i - 1], run[i]));
  const total = walked[walked.length - 1];
  return shares.map((share) => run[Math.max(0, walked.findIndex((km) => km >= share * total))]);
}

/**
 * Where a route's pill may sit, best first: the points at 50 %, 30 % and 70 % of the longest stretch
 * no other route runs within 2 km of (sampled at most 200 points a route), which is where routes part
 * and what the pill tells apart; then the same shares of the whole route, for when the stretch has no
 * room on screen (it is often short, and near a pin).
 */
export function pillAnchors(route: SceneRoute, others: SceneRoute[]): LngLat[] {
  const own = samplesOf(route);
  const theirs = others.flatMap(samplesOf);
  let best: [number, number] = [0, 0];
  let from = -1;
  own.forEach((point, i) => {
    const shared = theirs.some((other) => kmBetween(point, other) <= SHARED_KM);
    if (!shared && from < 0) from = i;
    const end = shared ? i : i === own.length - 1 ? i + 1 : -1;
    if (from >= 0 && end >= 0) {
      if (end - from > best[1] - best[0]) best = [from, end];
      from = -1;
    }
  });
  const shares = [0.5, 0.3, 0.7];
  const whole = alongRun(own, shares);
  if (best[1] <= best[0]) return whole;
  const apart = alongRun(own.slice(best[0], best[1]), shares);
  return [...apart, ...whole.filter((p) => !apart.some((q) => q[0] === p[0] && q[1] === p[1]))];
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

const at = (place: ResolvedPlace): LngLat => [place.lon, place.lat];

/** A shop that is a place of the plan already: its pin marks it. */
const inPlaces = (shop: ResolvedPlace, places: (ResolvedPlace | null)[]) => places.some((place) => place?.match.method === "shop" && place.lon === shop.lon && place.lat === shop.lat);

/**
 * The planner's map: the chosen route on top of the others, the pills that tell them apart, the
 * turn-backs, a pin for each place as soon as it resolves, and every other saved shop as a small square
 * to click.
 */
export function planScene(input: { planned: PlannedRoute | null; option: RouteStrategy | null; leg?: number | null; shops: ShopView[]; unit: DistanceUnit }): MapScene {
  const { planned, option, shops, unit } = input;
  const routes = planned?.outcome === "routed" ? planned.routes : null;
  const chosen = routes ? chosenRoute(routes, option) : null;
  const places = (planned?.places ?? []).map(resolvedOf);

  // The first and last places sit where the chosen route starts and ends on the track.
  const firstLeg = chosen?.legs.find((leg) => leg.path.length);
  const lastLeg = chosen?.legs.findLast((leg) => leg.path.length);
  const first = places.findIndex(Boolean);
  const last = places.findLastIndex(Boolean);

  const pins: ScenePin[] = [];
  for (const shop of shops) {
    const place = resolvedOf(shop.place);
    if (!place || inPlaces(place, places)) continue;
    pins.push({ kind: "shop", glyph: "", label: shop.name, position: at(place), shopId: shop.id });
  }
  places.forEach((place, i) => {
    if (!place) return;
    const kind = placeKind(i, places.length);
    const position = (i === first ? firstLeg?.path[0] : i === last ? lastLeg?.path.at(-1) : undefined) ?? at(place);
    // A stop's number is its row: the start is row 0.
    pins.push({ kind, glyph: kind === "stop" ? String(i) : "", label: place.label, position, shopId: null });
  });

  if (!routes || !chosen) return { kind: "route", selected: null, leg: null, alternatives: [], pills: [], turnBacks: [], pins, bounds: null };

  const selected = sceneRoute(chosen);
  const others = routes.filter((route) => route !== chosen);
  const alternatives = others.map(sceneRoute);
  const all = [selected, ...alternatives];
  const pills: ScenePill[] =
    routes.length < 2
      ? []
      : [chosen, ...others].map((route, i) => ({
          id: route.strategies[0],
          text: pillText(route, chosen, unit),
          selected: i === 0,
          turnBacks: route.turnBacks.length,
          anchors: pillAnchors(all[i], all.filter((_, j) => j !== i)),
        }));

  const bounds = new BoundsBuilder();
  for (const route of all) for (const leg of route.legs) bounds.addAll(leg.path);
  bounds.addAll(pins.filter((pin) => pin.kind !== "shop").map((pin) => pin.position));

  return {
    kind: "route",
    selected,
    leg: input.leg ?? null,
    alternatives,
    pills,
    turnBacks: chosen.turnBacks.map((turnBack) => ({ position: [turnBack.at.lon, turnBack.at.lat], turnBack })),
    pins,
    bounds: bounds.done(),
  };
}

/** Shops: every other shop that is on the network, and the links of the one being edited. */
export function shopsScene(shops: ShopView[], editing: EditedShop | null): MapScene {
  const pins: ScenePin[] = [];
  for (const shop of shops) {
    if (!shop.place.ok || shop.id === editing?.shopId) continue;
    pins.push({ kind: "shop", glyph: "", label: shop.name, position: at(shop.place.place), shopId: shop.id });
  }
  const links = editing?.links ?? [];
  const bounds = new BoundsBuilder();
  bounds.addAll(pins.map((pin) => pin.position));
  if (editing) bounds.add(editing.at);
  for (const link of links) bounds.addAll(link.path);
  return { kind: "shops", pins, links, bounds: bounds.done() };
}
