/**
 * The plan being worked on in the route planner: its places with their undo history, which field ⌖
 * is on, and whether the last map click missed. View state only: it lives in memory, in the browser.
 * The routes come from the server (usePlannedRoute); a plan is kept there only when it is saved.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { haversineKm, type LngLat } from "../../../shared/geo.ts";
import type { PlaceRef } from "../../../shared/places.ts";
import type { FullPlan, Plan, PlanField, PlanPlaces, SavedRoute, SavedRouteId } from "../../../shared/plans.ts";
import { DEFAULT_INCLUDE, type Railroad, type TrackIncluded } from "../../../shared/railroads.ts";
import { snapToNetwork } from "../../data/hooks.ts";
import { PICK_RADIUS_PX } from "../../map/MapStage.tsx";

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
  /** A field whose ⌖ is on; null: clicks go start → destination → stops. */
  pick: PlanField | null;
  /** The last click was too far from any track. */
  missed: boolean;
}

export type PlanAction =
  /** Typed and Enter, a suggestion, a click, or × to clear. */
  | { type: "setPlace"; field: PlanField; ref: PlaceRef | null }
  /** Ignored when the node or shop is already in the plan. */
  | { type: "addStop"; ref: PlaceRef; index: number }
  /** The line chosen at a node stop; null = any. */
  | { type: "setLine"; index: number; railroad: Railroad | null }
  | { type: "removeStop"; index: number }
  | { type: "moveStop"; from: number; to: number }
  /** Which track beyond Class I the route may use. */
  | { type: "setInclude"; include: TrackIncluded }
  /** Undoable. */
  | { type: "clear" }
  /** Destination becomes the start and the stops run the other way. Undoable. */
  | { type: "reverse" }
  | { type: "pick"; field: PlanField | null }
  | { type: "missed" }
  /** Adopt the id after the first save; the history stays. */
  | { type: "saved"; id: SavedRouteId }
  | { type: "undo" }
  | { type: "redo" };

export const EMPTY_PLAN: Plan = { start: null, stops: [], destination: null, include: DEFAULT_INCLUDE };

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
  return (
    samePlace(x.start, y.start) &&
    samePlace(x.destination, y.destination) &&
    x.stops.length === y.stops.length &&
    x.stops.every((stop, i) => samePlace(stop, y.stops[i])) &&
    sameInclude(x.include, y.include)
  );
}

export function isFull(plan: Plan): plan is FullPlan {
  return plan.start !== null && plan.destination !== null;
}

/** The same spot on the ground: a node whatever line was chosen there, one shop, or an equal reference. */
const sameSpot = (x: PlaceRef, y: PlaceRef) => (x.kind === "node" && y.kind === "node" ? x.fraId === y.fraId : samePlace(x, y));

/** True when the place is already the start, a stop or the destination. */
export function inPlan(plan: Plan, ref: PlaceRef): boolean {
  return [plan.start, ...plan.stops, plan.destination].some((place) => place !== null && sameSpot(place, ref));
}

/** A change of plan goes on the history; one that changes nothing does not. */
function push(session: PlanSession, next: Plan): PlanSession {
  const { past, present } = session.plan;
  if (samePlan(present, next)) return session;
  return { ...session, plan: { past: [...past, present], present: next, future: [] } };
}

export function planReducer(session: PlanSession, action: PlanAction): PlanSession {
  const plan = session.plan.present;
  const stops = plan.stops;
  switch (action.type) {
    case "setPlace":
      return { ...push(session, { ...plan, [action.field]: action.ref }), pick: null, missed: false };
    case "addStop": {
      if (inPlan(plan, action.ref)) return session.missed ? { ...session, missed: false } : session;
      const at = Math.max(0, Math.min(action.index, stops.length));
      return { ...push(session, { ...plan, stops: [...stops.slice(0, at), action.ref, ...stops.slice(at)] }), missed: false };
    }
    case "setLine": {
      const stop = stops[action.index];
      if (stop?.kind !== "node") return session;
      return push(session, { ...plan, stops: stops.map((s, i) => (i === action.index ? { ...stop, railroad: action.railroad } : s)) });
    }
    case "removeStop":
      if (action.index < 0 || action.index >= stops.length) return session;
      return push(session, { ...plan, stops: stops.filter((_, i) => i !== action.index) });
    case "moveStop": {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= stops.length || to >= stops.length) return session;
      const next = stops.filter((_, i) => i !== from);
      next.splice(to, 0, stops[from]);
      return push(session, { ...plan, stops: next });
    }
    case "setInclude":
      return push(session, { ...plan, include: action.include });
    case "clear":
      return { ...push(session, EMPTY_PLAN), pick: null, missed: false };
    case "reverse":
      return push(session, { ...plan, start: plan.destination, stops: [...stops].reverse(), destination: plan.start });
    case "pick":
      return { ...session, pick: action.field, missed: false };
    case "missed":
      return { ...session, missed: true };
    case "saved":
      return { ...session, savedId: action.id };
    case "undo": {
      const { past, present, future } = session.plan;
      if (!past.length) return session;
      return { ...session, plan: { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] }, missed: false };
    }
    case "redo": {
      const { past, present, future } = session.plan;
      if (!future.length) return session;
      return { ...session, plan: { past: [...past, present], present: future[0], future: future.slice(1) }, missed: false };
    }
  }
}

/** What the next click on the map fills: the field whose ⌖ is on, else the start, the destination, then a stop. */
export function nextTarget(session: PlanSession): PlanField | "stop" {
  const plan = session.plan.present;
  return session.pick ?? (plan.start === null ? "start" : plan.destination === null ? "destination" : "stop");
}

const km = (p: LonLat, q: LonLat) => haversineKm(p.lon, p.lat, q.lon, q.lat);

/** Where a newly clicked stop belongs among the existing ones: where it adds the least straight-line detour between start and destination. */
export function stopInsertIndex(start: LonLat, stops: LonLat[], destination: LonLat, clicked: LonLat): number {
  const chain = [start, ...stops, destination];
  let best = stops.length;
  let bestCost = Infinity;
  for (let i = 0; i + 1 < chain.length; i++) {
    const cost = km(chain[i], clicked) + km(clicked, chain[i + 1]) - km(chain[i], chain[i + 1]);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}

/** Where a new stop goes: by least detour when every place of the plan is known, else last. */
export function insertIndex(plan: Plan, places: PlanPlaces | null, at: LonLat): number {
  const start = places?.start;
  const destination = places?.destination;
  const stops = places?.stops ?? [];
  if (!start?.ok || !destination?.ok || stops.length !== plan.stops.length) return plan.stops.length;
  const known = stops.flatMap((stop) => (stop.ok ? [stop.place] : []));
  return known.length === stops.length ? stopInsertIndex(start.place, known, destination.place, at) : plan.stops.length;
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
 * else null. Snapping there, not to whatever node is nearest, keeps a stop clicked on the line on
 * the line: a spur node a few km off it would bend the route, or break it. The two ends are left
 * out: they are the start and destination already.
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
   * Snap, then fill nextTarget: to a node of the selected route (its legs' paths) when the click is
   * on it, else to the nearest node. Ignored while a previous snap is in flight. Rejects when the
   * server cannot be reached.
   */
  clickMap: (lon: number, lat: number, toleranceKm: number, places: PlanPlaces | null, route: readonly LngLat[][] | null) => Promise<void>;
  /** A shop square: fill nextTarget with that ref. */
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

  useEffect(() => {
    if (!session.pick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "pick", field: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.pick, dispatch]);

  const place = useCallback(
    (ref: PlaceRef, at: LonLat, places: PlanPlaces | null) => {
      const now = latest.current;
      const plan = now.plan.present;
      // A place already in the plan is not added again (a double click, or a click on a pin's own node).
      if (inPlan(plan, ref)) {
        if (now.pick) dispatch({ type: "pick", field: null });
        return;
      }
      const target = nextTarget(now);
      if (target === "stop") dispatch({ type: "addStop", ref, index: insertIndex(plan, places, at) });
      else dispatch({ type: "setPlace", field: target, ref });
    },
    [dispatch],
  );

  const clickMap = useCallback(
    async (lon: number, lat: number, toleranceKm: number, places: PlanPlaces | null, route: readonly LngLat[][] | null) => {
      if (snapping.current) return;
      snapping.current = true;
      try {
        const vertex = route ? routeNodeNear(route, { lon, lat }, (toleranceKm * ON_ROUTE_PX) / PICK_RADIUS_PX) : null;
        const node = (vertex && (await snapToNetwork(vertex[0], vertex[1], VERTEX_KM))) ?? (await snapToNetwork(lon, lat, toleranceKm));
        if (!node) dispatch({ type: "missed" });
        else place({ kind: "node", fraId: node.fraId, railroad: null }, { lon: node.lon, lat: node.lat }, places);
      } finally {
        snapping.current = false;
      }
    },
    [dispatch, place],
  );

  const clickPlace = useCallback((ref: PlaceRef, at: LngLat, places: PlanPlaces | null) => place(ref, { lon: at[0], lat: at[1] }, places), [place]);

  return { session, dispatch, clickMap, clickPlace };
}
