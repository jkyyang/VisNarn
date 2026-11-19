/**
 * The plan being worked on in the route planner: its place list with its undo history, which row's ⌖
 * is on, and whether the last map click missed. View state only: it lives in memory, in the browser.
 * The routes come from the server (usePlannedRoute); a plan is kept there only when it is saved.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { haversineKm, type LngLat } from "../../../shared/geo.ts";
import type { PlaceRef } from "../../../shared/places.ts";
import type { FullPlan, Plan, PlanPlaces, SavedRoute, SavedRouteId } from "../../../shared/plans.ts";
import { DEFAULT_INCLUDE, type Railroad, type TrackIncluded } from "../../../shared/railroads.ts";
import { snapToNetwork } from "../../data/hooks.ts";
import { PICK_RADIUS_PX } from "../../map/config.ts";
import { useEscape } from "../../ui/useEscape.ts";

type LonLat = { lon: number; lat: number };

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface PlanSession {
  /** The saved route this session edits; null for a new plan. */
  savedId: SavedRouteId | null;
  plan: History<Plan>;
  /** The row whose ⌖ is on; null: a click fills the first empty row, else adds a stop. */
  pick: number | null;
  /** The last click was too far from any track. */
  missed: boolean;
}

/** Every change to the place list is undoable and turns ⌖ off. */
export type PlanAction =
  /** Typed and Enter, a suggestion, a click, or emptied. */
  | { type: "setPlace"; at: number; ref: PlaceRef | null }
  /** A new row before `at`. Ignored when the place is already in the plan. An empty row (null) gets ⌖. */
  | { type: "insert"; at: number; ref: PlaceRef | null }
  /** Takes the row out; of the last two, empties it. */
  | { type: "remove"; at: number }
  | { type: "move"; from: number; to: number }
  /** The next carrier chosen at a node; null = the router's pick. */
  | { type: "setLine"; at: number; railroad: Railroad | null }
  /** Which track beyond Class I the route may use. */
  | { type: "setInclude"; include: TrackIncluded }
  | { type: "setTurnAtStops"; turnAtStops: boolean }
  | { type: "clear" }
  | { type: "reverse" }
  | { type: "pick"; at: number | null }
  | { type: "missed" }
  /** Adopt the id after the first save; the history stays. */
  | { type: "saved"; id: SavedRouteId }
  | { type: "undo" }
  | { type: "redo" };

export const EMPTY_PLAN: Plan = { places: [null, null], include: DEFAULT_INCLUDE, turnAtStops: false };

export function startSession(savedId: SavedRouteId | null, plan: Plan): PlanSession {
  return { savedId, plan: { past: [], present: plan, future: [] }, pick: null, missed: false };
}

function samePlace(x: PlaceRef | null, y: PlaceRef | null): boolean {
  if (x === null || y === null) return x === y;
  switch (x.kind) {
    case "text":
      return y.kind === "text" && x.text === y.text;
    case "shop":
      return y.kind === "shop" && x.shopId === y.shopId;
    case "node":
      return y.kind === "node" && x.fraId === y.fraId && x.railroad === y.railroad;
    case "coord":
      return y.kind === "coord" && x.lon === y.lon && x.lat === y.lat;
  }
}

const sameInclude = (x: TrackIncluded, y: TrackIncluded) => x.regional === y.regional && x.shortLine === y.shortLine && x.passenger === y.passenger;

export function samePlan(x: Plan, y: Plan): boolean {
  return x.places.length === y.places.length && x.places.every((place, i) => samePlace(place, y.places[i])) && sameInclude(x.include, y.include) && x.turnAtStops === y.turnAtStops;
}

const isSet = (place: PlaceRef | null): place is PlaceRef => place !== null;

/** The plan as it is routed and saved: its set rows, or null with fewer than two. */
export function fullPlan(plan: Plan): FullPlan | null {
  const places = plan.places.filter(isSet);
  return places.length >= 2 ? { ...plan, places } : null;
}

export const isEmpty = (plan: Plan) => !plan.places.some(isSet);

/** The same spot on the ground: a node whatever line was chosen there, one shop, or an equal reference. */
export const sameSpot = (x: PlaceRef, y: PlaceRef) => (x.kind === "node" && y.kind === "node" ? x.fraId === y.fraId : samePlace(x, y));

export const inPlan = (plan: Plan, ref: PlaceRef): boolean => plan.places.some((place) => place !== null && sameSpot(place, ref));

/** A change of plan goes on the history; one that changes nothing does not. */
function push(session: PlanSession, next: Plan): PlanSession {
  const { past, present } = session.plan;
  if (samePlan(present, next)) return session;
  return { ...session, plan: { past: [...past, present], present: next, future: [] } };
}

export function planReducer(session: PlanSession, action: PlanAction): PlanSession {
  const plan = session.plan.present;
  const { places } = plan;
  const inside = (at: number) => Number.isInteger(at) && at >= 0 && at < places.length;
  const change = (next: (PlaceRef | null)[], pick: number | null = null): PlanSession => ({ ...push(session, { ...plan, places: next }), pick, missed: false });
  switch (action.type) {
    case "setPlace":
      return inside(action.at) ? change(places.with(action.at, action.ref)) : session;
    case "insert": {
      if (action.ref && inPlan(plan, action.ref)) return session.missed ? { ...session, missed: false } : session;
      const at = Math.max(0, Math.min(action.at, places.length));
      return change(places.toSpliced(at, 0, action.ref), action.ref ? null : at);
    }
    case "remove":
      if (!inside(action.at)) return session;
      return change(places.length > 2 ? places.toSpliced(action.at, 1) : places.with(action.at, null));
    case "move": {
      const { from, to } = action;
      if (from === to || !inside(from) || !inside(to)) return session;
      return change(places.toSpliced(from, 1).toSpliced(to, 0, places[from]));
    }
    case "setLine": {
      const place = places[action.at];
      return place?.kind === "node" ? change(places.with(action.at, { ...place, railroad: action.railroad })) : session;
    }
    case "setInclude":
      return push(session, { ...plan, include: action.include });
    case "setTurnAtStops":
      return push(session, { ...plan, turnAtStops: action.turnAtStops });
    case "clear":
      return { ...push(session, EMPTY_PLAN), pick: null, missed: false };
    case "reverse":
      return change(places.toReversed());
    case "pick":
      return { ...session, pick: action.at, missed: false };
    case "missed":
      return { ...session, missed: true };
    case "saved":
      return { ...session, savedId: action.id };
    case "undo": {
      const { past, present, future } = session.plan;
      if (!past.length) return session;
      return { ...session, plan: { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] }, pick: null, missed: false };
    }
    case "redo": {
      const { past, present, future } = session.plan;
      if (!future.length) return session;
      return { ...session, plan: { past: [...past, present], present: future[0], future: future.slice(1) }, pick: null, missed: false };
    }
  }
}

/** The row the next click on the map fills: the one whose ⌖ is on, else the first empty one; null adds a stop. */
export function nextTarget(session: PlanSession): number | null {
  if (session.pick !== null) return session.pick;
  const empty = session.plan.present.places.indexOf(null);
  return empty >= 0 ? empty : null;
}

/** The found place's "Start" or "Destination": that end's row when it is empty, else a new row at that end. */
export function placeAtEnd(plan: Plan, end: "start" | "destination", ref: PlaceRef): PlanAction {
  const at = end === "start" ? 0 : plan.places.length - 1;
  return plan.places[at] === null ? { type: "setPlace", at, ref } : { type: "insert", at: end === "start" ? 0 : plan.places.length, ref };
}

const km = (p: LonLat, q: LonLat) => haversineKm(p.lon, p.lat, q.lon, q.lat);

/** Where a new stop goes in a chain of places: the index of the gap where it adds the least straight-line detour. */
export function stopInsertIndex(chain: LonLat[], clicked: LonLat): number {
  let best = chain.length - 1;
  let bestCost = Infinity;
  for (let i = 0; i + 1 < chain.length; i++) {
    const cost = km(chain[i], clicked) + km(clicked, chain[i + 1]) - km(chain[i], chain[i + 1]);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = i + 1;
    }
  }
  return best;
}

/** Where a new stop goes: by least detour when the answer is for this plan and every row resolved, else before the last row. */
export function insertIndex(plan: Plan, places: PlanPlaces | null, at: LonLat): number {
  const known = (places ?? []).flatMap((place) => (place?.ok ? [place.place] : []));
  return known.length === plan.places.length ? stopInsertIndex(known, at) : plan.places.length - 1;
}

/** A click this close to the selected route, in pixels, is a click on it (the drawn line follows the track, the legs run node to node). */
const ON_ROUTE_PX = 10;
/** Route vertices are node coordinates rounded to about 1 m; this finds that node and no other. */
const VERTEX_KM = 0.01;

/** Distance from p to the segment a–b, on a flat map around p: fine at the few km a click spans. */
function segmentKm(p: LonLat, a: LngLat, b: LngLat): number {
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110.57;
  const ax = (a[0] - p.lon) * kx, ay = (a[1] - p.lat) * ky;
  const bx = (b[0] - p.lon) * kx, by = (b[1] - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * The node of the route nearest a click that lands on the route (within `withinKm` of its legs),
 * else null. This keeps a stop clicked on the line on the line: the nearest node may sit on a spur a
 * few km off and bend or break the route. The two ends are skipped; they are the start and destination already.
 */
export function routeNodeNear(legs: readonly LngLat[][], at: LonLat, withinKm: number): LngLat | null {
  const onRoute = legs.some((path) => path.some((point, i) => i > 0 && segmentKm(at, path[i - 1], point) <= withinKm));
  if (!onRoute) return null;
  const points = legs.flat();
  let best: LngLat | null = null;
  let bestKm = Infinity;
  points.forEach((point, i) => {
    if (i === 0 || i === points.length - 1) return;
    const d = km(at, { lon: point[0], lat: point[1] });
    if (d < bestKm) {
      bestKm = d;
      best = point;
    }
  });
  return best;
}

export interface PlanSessionHandle {
  session: PlanSession;
  dispatch: (action: PlanAction) => void;
  /**
   * Snap, then place it at nextTarget: to a node of `route` (the legs' paths of the line clicked) when
   * the click is on it, else to the nearest node. Ignored while a previous snap is in flight (undefined). Resolves
   * to where it snapped, or null when no track is near; rejects when the server cannot be reached.
   */
  clickMap: (lon: number, lat: number, toleranceKm: number, places: PlanPlaces | null, route: readonly LngLat[][] | null) => Promise<LngLat | null | undefined>;
  /** A shop square: place that ref at nextTarget. */
  clickPlace: (ref: PlaceRef, at: LngLat, places: PlanPlaces | null) => void;
}

type Held = { key: string; session: PlanSession };
type HeldAction = { type: "start"; held: Held | null } | { type: "act"; action: PlanAction };

function heldReducer(held: Held | null, action: HeldAction): Held | null {
  if (action.type === "start") return action.held;
  if (!held) return held;
  const session = planReducer(held.session, action.action);
  return session === held.session ? held : { ...held, session };
}

const NEW = "new";

/**
 * The session the URL asks for: the one held when it fits; for a new plan, an empty one; for a saved
 * route, the plan just saved under that id (keeping its undo history) or else the saved plan, once it
 * has loaded (null until then).
 */
function fitting(held: Held | null, savedId: SavedRouteId | null, saved: SavedRoute | null): Held | null {
  const key = savedId ?? NEW;
  if (held?.key === key) return held;
  if (savedId === null) return { key, session: startSession(null, EMPTY_PLAN) };
  if (held && held.session.savedId === savedId) return { key, session: held.session };
  return saved?.id === savedId ? { key, session: startSession(savedId, saved.plan) } : null;
}

/**
 * One slot for the whole page: the plan survives going to Shops and back, for as long as the page is
 * open. Memory only: nothing about a plan is written to the browser's storage.
 */
let memory: Held | null = null;

/** Starts the next session empty again (a page test that opens the app afresh). */
export function forgetPlan(): void {
  memory = null;
}

/**
 * The session for the planner. Starts over when the URL names another saved route (once it has
 * loaded) or goes from a saved route to a new plan. Esc turns ⌖ off.
 */
export function usePlanSession(savedId: SavedRouteId | null, saved: SavedRoute | null): PlanSessionHandle {
  const [held, send] = useReducer(heldReducer, null, () => fitting(memory, savedId, saved));
  const current = fitting(held, savedId, saved);
  useEffect(() => {
    if (current !== held) send({ type: "start", held: current });
  });
  if (current && current === held) memory = current;

  const session = current?.session ?? startSession(savedId, EMPTY_PLAN);
  const dispatch = useCallback((action: PlanAction) => send({ type: "act", action }), []);

  const latest = useRef(session);
  latest.current = session;
  const snapping = useRef(false);

  useEscape(session.pick !== null, () => dispatch({ type: "pick", at: null }));

  const place = useCallback(
    (ref: PlaceRef, at: LonLat, places: PlanPlaces | null) => {
      const now = latest.current;
      const plan = now.plan.present;
      // A place already in the plan is not added again (a double click, or a click on a pin's own node).
      if (inPlan(plan, ref)) {
        if (now.pick !== null) dispatch({ type: "pick", at: null });
        return;
      }
      const target = nextTarget(now);
      dispatch(target === null ? { type: "insert", at: insertIndex(plan, places, at), ref } : { type: "setPlace", at: target, ref });
    },
    [dispatch],
  );

  const clickMap = useCallback(
    async (lon: number, lat: number, toleranceKm: number, places: PlanPlaces | null, route: readonly LngLat[][] | null) => {
      if (snapping.current) return undefined;
      snapping.current = true;
      try {
        const vertex = route ? routeNodeNear(route, { lon, lat }, (toleranceKm * ON_ROUTE_PX) / PICK_RADIUS_PX) : null;
        const node = (vertex && (await snapToNetwork(vertex[0], vertex[1], VERTEX_KM))) ?? (await snapToNetwork(lon, lat, toleranceKm));
        if (!node) {
          dispatch({ type: "missed" });
          return null;
        }
        place({ kind: "node", fraId: node.fraId, railroad: null }, { lon: node.lon, lat: node.lat }, places);
        return [node.lon, node.lat] as LngLat;
      } finally {
        snapping.current = false;
      }
    },
    [dispatch, place],
  );

  const clickPlace = useCallback((ref: PlaceRef, at: LngLat, places: PlanPlaces | null) => place(ref, { lon: at[0], lat: at[1] }, places), [place]);

  return { session, dispatch, clickMap, clickPlace };
}
