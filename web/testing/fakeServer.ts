/**
 * A stand-in for the back end, in memory, behind the browser's own `fetch`: the page under test goes
 * through web/data/hooks.ts and query.ts exactly as it does against the real server, and only the
 * answers are made up. It follows the contract of shared/api.ts and the rules the server documents
 * (names resolve per role, a plan's places resolve before it is routed, a route is derived on every read).
 */
import { haversineKm, pathKm, round5, roundLngLat, type LngLat } from "../../shared/geo.ts";
import {
  SHOP_LINK_MAX_KM, type ImportReport, type LinkEnd, type NetworkNode, type PlaceRef, type PlaceResolution, type PlaceRole, type PlaceSuggestion, type ResolvedPlace,
  type RowIssue, type ShopDraft, type ShopId, type ShopLink, type ShopView,
} from "../../shared/places.ts";
import { placeKind, type Plan, type PlannedRoute, type PlanPlaces, type SavedRoute, type SavedRouteDraft, type SavedRouteId } from "../../shared/plans.ts";
import type { Railroad } from "../../shared/railroads.ts";
import type { Leg, Milestone, RoutePath } from "../../shared/route.ts";
import { CITIES, EXAMPLE_SHOPS, NODES, ROUTES, type City, type PathSpec } from "./example.ts";

export interface FakeState {
  shops: ShopView[];
  savedRoutes: SavedRoute[];
  /** The last plan the page asked to route, for tests that check what was sent. */
  lastPlan: Plan | null;
  /** Answer every request with this error instead (the server is down). */
  down: boolean;
  nextId: number;
}

export interface FakeServer {
  state: FakeState;
  /** Every request, in order, for tests that check what the page asked. */
  calls: { method: string; path: string; body: unknown }[];
  restore(): void;
}

// ---- places ----

const cityByName = (name: string) => CITIES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

function nearestCity(lon: number, lat: number, withinKm: number): (City & { km: number }) | null {
  let best: (City & { km: number }) | null = null;
  for (const city of CITIES) {
    const km = haversineKm(lon, lat, city.at[0], city.at[1]);
    if (km <= withinKm && (!best || km < best.km)) best = { ...city, km };
  }
  return best;
}

function nearestNode(lon: number, lat: number, withinKm: number): NetworkNode | null {
  let best: NetworkNode | null = null;
  for (const n of NODES) {
    const km = haversineKm(lon, lat, n.lon, n.lat);
    if (km <= withinKm && (!best || km < best.km)) best = { ...n, km: Math.round(km * 10) / 10 };
  }
  return best;
}

/** A shop's links as the server finds them, made simple: each straight from the shop to a node, a spot taking the nearest node within a link's reach. */
function links(body: { lon: number; lat: number; ends: LinkEnd[] }): (ShopLink | null)[] {
  const shop = roundLngLat(body.lon, body.lat);
  return body.ends.map((end) => {
    const node = "fraId" in end ? NODES.find((n) => n.fraId === end.fraId) : nearestNode(end.lon, end.lat, SHOP_LINK_MAX_KM);
    const km = node ? haversineKm(shop[0], shop[1], node.lon, node.lat) : Infinity;
    return node && km <= SHOP_LINK_MAX_KM ? { ...node, km, path: [shop, [node.lon, node.lat]] } : null;
  });
}

const servedAt = (lon: number, lat: number): Railroad[] => nearestCity(lon, lat, 80)?.railroads ?? ["BNSF"];

function resolved(ref: PlaceRef, label: string, at: LngLat, method: ResolvedPlace["match"]["method"], railroads?: Railroad[], fraId: number | null = null, railroad: Railroad | null = null): PlaceResolution {
  return {
    ok: true,
    place: {
      ref,
      label,
      lon: round5(at[0]),
      lat: round5(at[1]),
      fraId: fraId as ResolvedPlace["fraId"],
      railroad,
      railroads: railroads ?? servedAt(at[0], at[1]),
      match: { method, confidence: fraId !== null ? "exact" : "snapped", snapKm: 0.4 },
    },
  };
}

const problem = (kind: "empty" | "unknown" | "ambiguous" | "off-network" | "removed", message: string): PlaceResolution => ({ ok: false, problem: { kind, message, candidates: [] } });

function resolve(state: FakeState, ref: PlaceRef, role: PlaceRole): PlaceResolution {
  switch (ref.kind) {
    case "text": {
      const text = ref.text.trim();
      if (!text) return problem("empty", "Type a place: a city, one of Your shops, or lon, lat.");
      const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
      if (coords) return resolve(state, { kind: "coord", lon: Number(coords[1]), lat: Number(coords[2]) }, role);
      if (role === "shop") {
        const shop = state.shops.find((s) => s.name.toLowerCase() === text.toLowerCase() || s.code?.toLowerCase() === text.toLowerCase());
        if (shop && shop.place.ok) return { ok: true, place: { ...shop.place.place, ref, label: shop.name, match: { ...shop.place.place.match, method: "shop" } } };
      }
      const city = cityByName(text);
      if (city) return resolved(ref, city.name, city.at, "city", city.railroads);
      return problem("unknown", `No place called “${text}”. Try a city, one of Your shops, or lon, lat.`);
    }
    case "shop": {
      const shop = state.shops.find((s) => s.id === ref.shopId);
      if (!shop) return problem("removed", "This shop was removed from Your shops.");
      return shop.place.ok ? { ok: true, place: { ...shop.place.place, ref, label: shop.name, match: { ...shop.place.place.match, method: "shop" } } } : shop.place;
    }
    case "node": {
      const n = NODES.find((x) => x.fraId === ref.fraId);
      if (!n) return problem("unknown", "No track found for that code.");
      return resolved(ref, n.near, [n.lon, n.lat], "node", n.railroads, n.fraId, ref.railroad);
    }
    case "coord": {
      const city = nearestCity(ref.lon, ref.lat, 60);
      if (!city) return problem("off-network", `No track near ${ref.lon}, ${ref.lat}.`);
      return resolved(ref, `${round5(ref.lat)}, ${round5(ref.lon)} (near ${city.name})`, [ref.lon, ref.lat], "coordinates", city.railroads);
    }
  }
}

function suggest(state: FakeState, q: string, role: PlaceRole): PlaceSuggestion[] {
  const text = q.trim().toLowerCase();
  if (!text) return [];
  const shops: PlaceSuggestion[] = state.shops
    .filter((s) => s.name.toLowerCase().includes(text) || s.code?.toLowerCase().includes(text))
    .map((s) => ({ ref: { kind: "shop", shopId: s.id }, label: s.name, detail: `Your shop${s.code ? ` · ${s.code}` : ""}`, source: "shop", railroads: s.place.ok ? s.place.place.railroads : [] }));
  const cities: PlaceSuggestion[] = CITIES.filter((c) => c.name.toLowerCase().includes(text)).map((c) => ({ ref: { kind: "text", text: c.name }, label: c.name, detail: "City", source: "city", railroads: c.railroads }));
  return (role === "shop" ? [...shops, ...cities] : [...cities, ...shops]).slice(0, 8);
}

// ---- routes ----


function bearing([lon1, lat1]: LngLat, [lon2, lat2]: LngLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return Math.round(((Math.atan2(y, x) / r) % 360 + 360) % 360);
}

const near = (p: LngLat) => nearestCity(p[0], p[1], 40)?.name ?? `${Math.round(haversineKm(p[0], p[1], CITIES[0].at[0], CITIES[0].at[1]))} km from ${CITIES[0].name}`;

/** Routes by "start > destination" city names, as example.ts has them; anything else gets one straight-ish leg. */
function specsFor(b: ResolvedPlace, shop: ResolvedPlace, hasStops: boolean): PathSpec[] {
  const bCity = nearestCity(b.lon, b.lat, 30)?.name;
  const shopCity = nearestCity(shop.lon, shop.lat, 30)?.name;
  const known = bCity && shopCity ? ROUTES[`${bCity} > ${shopCity}`] : undefined;
  if (known) {
    const fitting = known.filter((spec) => !spec.when || spec.when === (hasStops ? "stops" : "no-stops"));
    if (fitting.length) return fitting;
  }
  const from: LngLat = [b.lon, b.lat];
  const to: LngLat = [shop.lon, shop.lat];
  const mid: LngLat = [(from[0] + to[0]) / 2 + 0.3, (from[1] + to[1]) / 2 - 0.2];
  const railroad = b.railroads.find((r) => shop.railroads.includes(r)) ?? b.railroads[0] ?? "BNSF";
  return [{ strategies: ["pick", "shortest", "fewest-interchanges", "no-turn-backs"], km: Math.round(haversineKm(from[0], from[1], to[0], to[1]) * 1.25), legs: [{ railroad, points: [from, mid, to] }].map((leg) => ({ ...leg, subdivisions: ["MAIN"] })), turnBacks: [] }];
}

function pathOf(spec: PathSpec, stops: ResolvedPlace[]): RoutePath {
  const total = spec.legs.reduce((sum, leg) => sum + pathKm(leg.points), 0) || 1;
  const legs: Leg[] = spec.legs.map((leg) => ({
    railroad: leg.railroad,
    km: (spec.km * pathKm(leg.points)) / total,
    from: near(leg.points[0]),
    to: near(leg.points[leg.points.length - 1]),
    headingDeg: bearing(leg.points[0], leg.points[leg.points.length - 1]),
    subdivisions: leg.subdivisions,
    path: leg.points.map(([x, y]) => roundLngLat(x, y)),
  }));
  const steps: Milestone[] = [];
  let km = 0;
  stops.forEach((stop, i) => steps.push({ kind: "stop", kmFromStart: 2 + i, stop: i, label: stop.label }));
  legs.forEach((leg, i) => {
    spec.turnBacks.forEach((t, j) => {
      if (t.beforeLeg === i) steps.push({ kind: "turn-back", kmFromStart: km, turnBack: j });
    });
    if (i > 0 && legs[i - 1].railroad !== leg.railroad) steps.push({ kind: "interchange", kmFromStart: km, from: legs[i - 1].railroad, to: leg.railroad, at: leg.from });
    steps.push({ kind: "leg", kmFromStart: km, leg: i });
    km += leg.km;
  });
  steps.push({ kind: "destination", kmFromStart: spec.km });
  steps.sort((x, y) => x.kmFromStart - y.kmFromStart);
  return {
    strategies: spec.strategies,
    km: spec.km,
    interchanges: steps.filter((s) => s.kind === "interchange").length,
    railroads: [...new Set(legs.map((leg) => leg.railroad))],
    legs,
    turnBacks: spec.turnBacks.map((t) => t.turnBack),
    steps,
  };
}

function plan(state: FakeState, body: Plan): PlannedRoute {
  state.lastPlan = body;
  const places: PlanPlaces = body.places.map((ref, at) => ref && resolve(state, ref, placeKind(at, body.places.length) === "stop" ? "position" : "shop"));
  const set = places.filter((place) => place !== null);
  const resolved = set.flatMap((place) => (place.ok ? [place.place] : []));
  if (set.length < 2 || resolved.length < set.length) return { outcome: "incomplete", places };
  const stops = resolved.slice(1, -1);
  const [first, ...rest] = specsFor(resolved[0], resolved.at(-1)!, stops.length > 0).map((spec) => pathOf(spec, stops));
  return { outcome: "routed", places, routes: [first, ...rest] };
}

// ---- shops ----

/** Quoted cells may hold commas ("Taylor, TX"); that is all the fake needs of CSV. */
function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => [...line.matchAll(/\s*(?:"((?:[^"]|"")*)"|([^,]*))\s*(?:,|$)/g)].slice(0, -1).map((m) => (m[1] !== undefined ? m[1].replaceAll('""', '"') : (m[2] ?? "").trim())));
}

function shopView(state: FakeState, id: string, draft: ShopDraft): ShopView | { error: string; field?: string } {
  const place = resolve(state, draft.location, "shop");
  if (!place.ok) return { error: place.problem.message };
  const location = place.place.fraId !== null ? { fraId: place.place.fraId, railroad: place.place.railroad } : { lon: place.place.lon, lat: place.place.lat };
  // As the server: a linked shop stays where it is and joins the network at its links' nodes.
  const links: NetworkNode[] = [];
  for (const [i, fraId] of draft.links.entries()) {
    const node = NODES.find((n) => n.fraId === fraId);
    if (!node) return { error: `The shop ${draft.name}: link ${i + 1} is gone from this network.`, field: "links" };
    links.push({ ...node, km: haversineKm(place.place.lon, place.place.lat, node.lon, node.lat) });
  }
  const wired = links.length ? { fraId: null, railroad: null, railroads: [...new Set(links.flatMap((link) => link.railroads))], links } : {};
  return {
    id: id as ShopId,
    name: draft.name,
    code: draft.code,
    location,
    links: draft.links,
    place: { ok: true, place: { ...place.place, ...wired, label: draft.name, match: { ...place.place.match, method: "shop" } } },
  };
}

function readShopCsv(state: FakeState, text: string): ImportReport<ShopView> {
  const [header, ...rows] = parseCsv(text);
  const ready: ShopView[] = [];
  const issues: RowIssue[] = [];
  const h = (name: string) => header?.indexOf(name) ?? -1;
  rows.forEach((cells, row) => {
    const name = cells[h("name")] ?? "";
    const code = h("code") >= 0 ? (cells[h("code")] ?? "") : "";
    const location: PlaceRef = { kind: "coord", lon: Number(cells[h("lon")]), lat: Number(cells[h("lat")]) };
    const view = shopView(state, `shop-${state.nextId++}`, { name, code: code || null, location, links: [] });
    if ("error" in view) issues.push({ row, line: row + 2, message: view.error });
    else ready.push(view);
  });
  return { committed: false, ready, issues };
}

// ---- HTTP ----

class HttpError extends Error {
  readonly status: number;
  readonly kind: string;
  readonly field: string | null;
  constructor(status: number, kind: string, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.field = field;
  }
}

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeState(options: { seed?: "example" | "empty" } = {}): FakeState {
  const state: FakeState = { shops: [], savedRoutes: [], lastPlan: null, down: false, nextId: 1 };
  if (options.seed === "empty") return state;
  for (const [i, shop] of EXAMPLE_SHOPS.entries()) {
    const view = shopView(state, `shop-ex-${i + 1}`, { name: shop.name, code: shop.code, location: { kind: "coord", lon: shop.at[0], lat: shop.at[1] }, links: [] });
    if (!("error" in view)) state.shops.push(view);
  }
  return state;
}

/** By name ignoring case; ties in the order saved (sort is stable). */
const byName = (routes: SavedRoute[]) => [...routes].sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase()));

function handle(state: FakeState, method: string, url: URL, body: unknown): unknown {
  const path = url.pathname;
  const q = url.searchParams;
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const route = `${method} ${path}`;
  const anyBody = body as Record<string, unknown>;

  if (route === "GET /api/places/suggest") return suggest(state, q.get("q") ?? "", (q.get("role") ?? "position") as PlaceRole);
  if (route === "POST /api/places/resolve") return resolve(state, anyBody.ref as PlaceRef, anyBody.role as PlaceRole);
  if (route === "GET /api/places/nearest") return nearestNode(Number(q.get("lon")), Number(q.get("lat")), Number(q.get("withinKm")));
  if (route === "POST /api/places/links") return links(anyBody as { lon: number; lat: number; ends: LinkEnd[] });

  if (route === "GET /api/shops") return state.shops;
  if (route === "POST /api/shops/import") {
    const source = anyBody.source as { fileName: string; text: string };
    // As the real server: an empty file is refused with a message.
    if (!source.text.trim()) throw new HttpError(400, "invalid", `${source.fileName} is empty.`, "source");
    const report = readShopCsv(state, source.text);
    if (anyBody.commit) state.shops.push(...report.ready);
    return { ...report, committed: !!anyBody.commit };
  }
  if (route === "POST /api/shops" || (method === "PUT" && parts[1] === "shops" && parts.length === 3)) {
    const draft = body as ShopDraft;
    const id = method === "PUT" ? parts[2] : `shop-${state.nextId++}`;
    const existing = state.shops.find((s) => s.id === id);
    if (method === "PUT" && !existing) throw new HttpError(404, "not-found", "This shop no longer exists.");
    const holder = draft.code ? state.shops.find((s) => s.code === draft.code && s.id !== id) : undefined;
    if (holder) throw new HttpError(409, "conflict", `The shop "${holder.name}" already has the code ${draft.code}. Give each shop its own code.`, "code");
    const view = shopView(state, id, draft);
    if ("error" in view) throw new HttpError(400, "invalid", view.error, view.field ?? "location");
    state.shops = existing ? state.shops.map((s) => (s.id === id ? view : s)) : [...state.shops, view];
    return view;
  }
  if (method === "DELETE" && parts[1] === "shops" && parts.length === 3) {
    state.shops = state.shops.filter((s) => s.id !== parts[2]);
    return null;
  }

  if (route === "POST /api/route") return plan(state, body as Plan);

  if (route === "GET /api/saved-routes") return byName(state.savedRoutes);
  if (route === "POST /api/saved-routes" || (method === "PUT" && parts[1] === "saved-routes" && parts.length === 3)) {
    const draft = body as SavedRouteDraft;
    const name = draft.name.trim();
    if (!name) throw new HttpError(400, "invalid", "Give the route a name.", "name");
    const id = (method === "PUT" ? parts[2] : `route-${state.nextId++}`) as SavedRouteId;
    const existing = state.savedRoutes.find((r) => r.id === id);
    if (method === "PUT" && !existing) throw new HttpError(404, "not-found", "This saved route no longer exists.");
    const saved: SavedRoute = { id, name, plan: draft.plan, option: draft.option, routeString: draft.routeString };
    state.savedRoutes = existing ? state.savedRoutes.map((r) => (r.id === id ? saved : r)) : [...state.savedRoutes, saved];
    return saved;
  }
  if (method === "DELETE" && parts[1] === "saved-routes" && parts.length === 3) {
    if (!state.savedRoutes.some((r) => r.id === parts[2])) throw new HttpError(404, "not-found", "This saved route no longer exists.");
    state.savedRoutes = state.savedRoutes.filter((r) => r.id !== parts[2]);
    return null;
  }

  throw new HttpError(404, "not-found", `No such route: ${method} ${path}`);
}

/** Puts the fake behind `fetch` until `restore()`. Every answer arrives on a later tick, like a real one. */
export function installFakeServer(options: { state?: FakeState; seed?: "example" | "empty" } = {}): FakeServer {
  const state = options.state ?? createFakeState({ seed: options.seed });
  const calls: FakeServer["calls"] = [];
  const original = globalThis.fetch;
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://127.0.0.1");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (init?.signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
    if (!url.pathname.startsWith("/api/")) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    if (state.down) throw new TypeError("fetch failed");
    try {
      return json(200, structuredClone(handle(state, method, url, body)));
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: { kind: error.kind, message: error.message, field: error.field } });
      return json(500, { error: { kind: "internal", message: error instanceof Error ? error.message : "Fake server failed.", field: null } });
    }
  };
  globalThis.fetch = fake as typeof fetch;
  return { state, calls, restore: () => void (globalThis.fetch = original) };
}
