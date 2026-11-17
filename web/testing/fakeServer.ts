/**
 * A stand-in for the back end, in memory, behind the browser's own `fetch`: the page under test goes
 * through web/data/hooks.ts and query.ts exactly as it does against the real server, and only the
 * answers are made up. It follows the contract of shared/api.ts and the rules the server documents
 * (names resolve per role, a flagged route is never "ok", a check is derived on every read).
 */
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../../shared/assumptions.ts";
import type {
  Batch,
  BatchCar,
  BatchId,
  BatchView,
  CannotCheck,
  CarCheck,
  CarReport,
  CarSummary,
  CheckedCar,
  CheckProblem,
  ImportProfile,
  ImportReport,
  RowIssue,
  SavedFix,
  StopRef,
} from "../../shared/cars.ts";
import { haversineKm, round5, type LngLat } from "../../shared/geo.ts";
import type { CodeSet, NetworkNode, NodeCode, PlaceRef, PlaceResolution, PlaceRole, PlaceSuggestion, ResolvedPlace, ShopDraft, ShopId, ShopView } from "../../shared/places.ts";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { EtaWindow, Leg, Milestone, RouteFlag, RouteOption, RouteStep, TimingStatus, TriageGroup } from "../../shared/route.ts";
import { addHours, hoursBetween, instant, readTime, type Instant } from "../../shared/time.ts";
import { CITIES, EXAMPLE_CARS, EXAMPLE_SHOPS, NODES, ROUTES, type City, type PathSpec } from "./example.ts";

export interface FakeState {
  assumptions: Assumptions;
  profile: ImportProfile;
  shops: ShopView[];
  codes: NodeCode[];
  codeSets: CodeSet[];
  batches: { batch: Batch; reports: CarReport[] }[];
  fixes: Map<string, SavedFix>;
  /** Reads of a batch that still answer "pending" for every row, to show the list filling in. */
  pendingReads: number;
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

export const FAKE_NOW = new Date("2026-11-17T15:00:00.000Z");

const DEFAULT_PROFILE: ImportProfile = {
  columns: { carId: "car_id", a: "last_node", b: "next_node", shop: "shop", reportedAt: "reported_at", prepEnd: "prep_end" },
  positions: "text",
  zonelessTimes: { zone: "UTC" },
};

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
      match: { method, codeType: ref.kind === "code" ? ref.codeType : null, confidence: fraId !== null ? "exact" : "snapped", snapKm: 0.4 },
      example: false,
    },
  };
}

const problem = (kind: "empty" | "unknown" | "ambiguous" | "off-network" | "removed", message: string): PlaceResolution => ({ ok: false, problem: { kind, message, candidates: [] } });

function resolve(state: FakeState, ref: PlaceRef, role: PlaceRole): PlaceResolution {
  switch (ref.kind) {
    case "text": {
      const text = ref.text.trim();
      if (!text) return problem("empty", "Type a place: a city, one of Your shops, a node code, or lon, lat.");
      const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
      if (coords) return resolve(state, { kind: "coord", lon: Number(coords[1]), lat: Number(coords[2]) }, role);
      if (role === "shop") {
        const shop = state.shops.find((s) => s.name.toLowerCase() === text.toLowerCase() || s.code?.toLowerCase() === text.toLowerCase());
        if (shop && shop.place.ok) return { ok: true, place: { ...shop.place.place, ref, label: shop.name, match: { ...shop.place.place.match, method: "shop" }, example: shop.example } };
      }
      const city = cityByName(text);
      if (city) return resolved(ref, city.name, city.at, "city", city.railroads);
      return problem("unknown", `No place called “${text}”. Try a city, one of Your shops, a node code, or lon, lat.`);
    }
    case "shop": {
      const shop = state.shops.find((s) => s.id === ref.shopId);
      if (!shop) return problem("removed", "This shop was removed from Your shops.");
      return shop.place.ok ? { ok: true, place: { ...shop.place.place, ref, label: shop.name, match: { ...shop.place.place.match, method: "shop" }, example: shop.example } } : shop.place;
    }
    case "code": {
      const code = state.codes.find((c) => c.codeType === ref.codeType && c.code === ref.code);
      if (!code) return problem("unknown", `Code ${ref.code} is not in the code set “${ref.codeType}”.`);
      const at: LngLat = "lon" in code.location ? [code.location.lon, code.location.lat] : [0, 0];
      return resolved(ref, code.name ?? `${ref.codeType} ${ref.code}`, at, "code");
    }
    case "node": {
      const n = NODES.find((x) => x.fraId === ref.fraId);
      if (!n) return problem("unknown", `FRA node ${ref.fraId} is not on this network.`);
      return resolved(ref, n.near, [n.lon, n.lat], "node", n.railroads, n.fraId, ref.railroad);
    }
    case "coord": {
      const city = nearestCity(ref.lon, ref.lat, 60);
      if (!city) return problem("off-network", `${ref.lon}, ${ref.lat} is more than 15 km from any Class I main line.`);
      return resolved(ref, `${round5(ref.lat)}, ${round5(ref.lon)} (near ${city.name})`, [ref.lon, ref.lat], "coordinates", city.railroads);
    }
  }
}

function suggest(state: FakeState, q: string, role: PlaceRole): PlaceSuggestion[] {
  const text = q.trim().toLowerCase();
  if (!text) return [];
  const shops: PlaceSuggestion[] = state.shops
    .filter((s) => s.name.toLowerCase().includes(text) || s.code?.toLowerCase().includes(text))
    .map((s) => ({ ref: { kind: "shop", shopId: s.id }, label: s.name, detail: `Your shop${s.code ? ` · ${s.code}` : ""}`, source: "shop" }));
  const cities: PlaceSuggestion[] = CITIES.filter((c) => c.name.toLowerCase().includes(text)).map((c) => ({ ref: { kind: "text", text: c.name }, label: c.name, detail: "City", source: "city" }));
  return (role === "shop" ? [...shops, ...cities] : [...cities, ...shops]).slice(0, 8);
}

// ---- routes and the check ----

const pathKm = (points: LngLat[]) => points.slice(1).reduce((sum, p, i) => sum + haversineKm(points[i][0], points[i][1], p[0], p[1]), 0);

function bearing([lon1, lat1]: LngLat, [lon2, lat2]: LngLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return Math.round(((Math.atan2(y, x) / r) % 360 + 360) % 360);
}

const near = (p: LngLat) => nearestCity(p[0], p[1], 40)?.name ?? `${Math.round(haversineKm(p[0], p[1], CITIES[0].at[0], CITIES[0].at[1]))} km from ${CITIES[0].name}`;

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

function pathOf(spec: PathSpec, stops: ResolvedPlace[]) {
  const total = spec.legs.reduce((sum, leg) => sum + pathKm(leg.points), 0) || 1;
  const legs: Leg[] = spec.legs.map((leg) => ({
    railroad: leg.railroad,
    km: (spec.km * pathKm(leg.points)) / total,
    from: near(leg.points[0]),
    to: near(leg.points[leg.points.length - 1]),
    headingDeg: bearing(leg.points[0], leg.points[leg.points.length - 1]),
    subdivisions: leg.subdivisions,
    path: leg.points.map(([x, y]) => [round5(x), round5(y)] as LngLat),
  }));
  const steps: Milestone[] = [];
  let km = 0;
  stops.forEach((stop, i) => steps.push({ kind: "stop", kmFromB: 2 + i, stop: i, label: stop.label }));
  legs.forEach((leg, i) => {
    spec.turnBacks.forEach((t, j) => {
      if (t.beforeLeg === i) steps.push({ kind: "turn-back", kmFromB: km, turnBack: j });
    });
    if (i > 0 && legs[i - 1].railroad !== leg.railroad) steps.push({ kind: "interchange", kmFromB: km, from: legs[i - 1].railroad, to: leg.railroad, at: leg.from });
    steps.push({ kind: "leg", kmFromB: km, leg: i });
    km += leg.km;
  });
  steps.push({ kind: "shop", kmFromB: spec.km });
  steps.sort((x, y) => x.kmFromB - y.kmFromB);
  return {
    strategies: spec.strategies,
    km: spec.km,
    interchanges: steps.filter((s) => s.kind === "interchange").length,
    railroads: [...new Set(legs.map((leg) => leg.railroad))],
    legs,
    turnBacks: spec.turnBacks.map((t) => t.turnBack),
    steps,
    passesA: false,
  };
}

const travelHours = (km: number, interchanges: number, timing: Assumptions["timing"]) => (km / timing.speedKmPerDay) * 24 + interchanges * timing.interchangeDelayH;
const classify = (marginH: number, bufferH: number): TimingStatus => (marginH >= bufferH ? "on-time" : marginH >= 0 ? "tight" : "at-risk");
const triage = (timing: TimingStatus, flags: RouteFlag[]): TriageGroup => (timing === "at-risk" ? "act-now" : flags.length || timing === "tight" ? "check-first" : "ok");

function check(state: FakeState, report: CarReport, asOf: Instant): CarCheck {
  const places = {
    a: resolve(state, report.a, "position"),
    b: resolve(state, report.b, "position"),
    shop: resolve(state, report.shop, "shop"),
    stops: report.stops.map((stop) => resolve(state, stop.place, "position")),
  };
  const problems: CheckProblem[] = [];
  for (const field of ["a", "b", "shop"] as const) {
    const place = places[field];
    if (!place.ok) problems.push({ field, message: place.problem.message });
  }
  places.stops.forEach((stop) => !stop.ok && problems.push({ field: "stops", message: stop.problem.message }));
  if (!report.reportedAt) problems.push({ field: "reportedAt", message: "The report time is missing or could not be read." });
  if (!report.prepEnd) problems.push({ field: "prepEnd", message: "The prep end time is missing or could not be read." });
  const { a, b, shop } = places;
  if (problems.length || !a.ok || !b.ok || !shop.ok || !report.reportedAt || !report.prepEnd) {
    const cannot: CannotCheck = { outcome: "cannot-check", report, places, problems: problems as CannotCheck["problems"] };
    return cannot;
  }
  const stops = places.stops.filter((s): s is Extract<PlaceResolution, { ok: true }> => s.ok);
  const assumptions = state.assumptions;
  const approachKm = Math.max(1, Math.round(haversineKm(a.place.lon, a.place.lat, b.place.lon, b.place.lat) * 1.08));
  const straightKm = haversineKm(b.place.lon, b.place.lat, shop.place.lon, shop.place.lat);
  const reportedAt = report.reportedAt;
  const eta = (km: number, interchanges: number): EtaWindow => ({
    ifAtB: addHours(reportedAt, travelHours(km, interchanges, assumptions.timing)),
    ifJustPastA: addHours(reportedAt, travelHours(km + approachKm, interchanges, assumptions.timing)),
  });
  const ageH = hoursBetween(reportedAt, asOf);
  const options = specsFor(b.place, shop.place, stops.length > 0).map((spec): RouteOption => {
    const path = pathOf(spec, stops.map((s) => s.place));
    let before = 0;
    const steps: RouteStep[] = path.steps.map((step) => {
      const at = eta(step.kmFromB, before);
      if (step.kind === "interchange") before++;
      return { ...step, eta: at };
    });
    const arrival = eta(path.km, path.interchanges);
    const marginH = hoursBetween(report.prepEnd!, arrival.ifAtB);
    const flags: RouteFlag[] = [];
    if (path.turnBacks.length) flags.push({ kind: "turn-back", places: path.turnBacks.map((t) => t.at.near) });
    if (straightKm > 0 && path.km / straightKm > assumptions.flags.detourRatio) flags.push({ kind: "detour", ratio: Math.round((path.km / straightKm) * 100) / 100 });
    if (ageH > assumptions.flags.positionAgeH) flags.push({ kind: "stale-position", ageH });
    const timing = classify(marginH, assumptions.timing.bufferH);
    return { ...path, steps, id: path.strategies[0], verdict: { arrival, marginH, timing, flags, group: triage(timing, flags) } };
  });
  const checked: CheckedCar = {
    outcome: "checked",
    report,
    places: { a, b, shop, stops },
    reportedAt,
    prepEnd: report.prepEnd,
    positionAgeH: ageH,
    approach: { onTrack: true, km: approachKm, paths: [[[a.place.lon, a.place.lat], [b.place.lon, b.place.lat]]] },
    straightKm,
    options: options as CheckedCar["options"],
    assumptions,
    graphVersion: "fake",
  };
  return checked;
}

// ---- batches ----

/** Quoted cells may hold commas ("Taylor, TX"); that is all the fake needs of CSV. */
function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => [...line.matchAll(/\s*(?:"((?:[^"]|"")*)"|([^,]*))\s*(?:,|$)/g)].slice(0, -1).map((m) => (m[1] !== undefined ? m[1].replaceAll('""', '"') : (m[2] ?? "").trim())));
}

function readBatch(state: FakeState, text: string): { reports: CarReport[]; issues: RowIssue[] } {
  const [header, ...rows] = parseCsv(text);
  const cols = state.profile.columns;
  const index = (name: string) => header?.findIndex((h) => h.toLowerCase() === name.toLowerCase()) ?? -1;
  const issues: RowIssue[] = [];
  const ref = (cell: string): PlaceRef => (state.profile.positions === "text" ? { kind: "text", text: cell } : { kind: "code", codeType: state.profile.positions.codeType, code: cell });
  const reports = rows.map((cells, row): CarReport => {
    const cell = (field: keyof ImportProfile["columns"]) => cells[index(cols[field])] ?? "";
    const time = (field: "reportedAt" | "prepEnd") => {
      const reading = readTime(cell(field), state.profile.zonelessTimes);
      if (reading.ok) return reading.at;
      issues.push({ row, line: row + 2, field, message: reading.why === "no-zone" ? `Line ${row + 2} has a time with no time zone.` : `Line ${row + 2}: the time “${cell(field)}” could not be read.` });
      return null;
    };
    return { carId: cell("carId"), a: ref(cell("a")), b: ref(cell("b")), shop: { kind: "text", text: cell("shop") }, stops: [], reportedAt: time("reportedAt"), prepEnd: time("prepEnd") };
  });
  return { reports, issues };
}

const fixKey = (batchId: string, row: number) => `${batchId}/${row}`;

function reportWithFix(state: FakeState, batchId: string, row: number, report: CarReport): CarReport {
  const fix = state.fixes.get(fixKey(batchId, row));
  return fix ? { ...report, stops: fix.stops } : report;
}

function batchView(state: FakeState, entry: FakeState["batches"][number]): BatchView {
  const pending = state.pendingReads > 0;
  if (pending) state.pendingReads--;
  const cars: CarSummary[] = entry.reports.map((raw, row) => {
    const report = reportWithFix(state, entry.batch.id, row, raw);
    const shopPlace = resolve(state, report.shop, "shop");
    const base = {
      row,
      carId: report.carId,
      shop: shopPlace.ok ? shopPlace.place.label : report.shop.kind === "text" ? report.shop.text : "Unknown shop",
      shopExample: shopPlace.ok && shopPlace.place.example,
      fixed: state.fixes.has(fixKey(entry.batch.id, row)),
    };
    if (pending) return { ...base, check: { outcome: "pending" }, group: null };
    const result = check(state, report, entry.batch.asOf);
    if (result.outcome === "cannot-check") return { ...base, check: { outcome: "cannot-check", problems: result.problems }, group: "check-first" };
    const pick = result.options[0];
    return {
      ...base,
      check: { outcome: "checked", verdict: pick.verdict, km: pick.km, straightKm: result.straightKm, railroads: pick.railroads, at: [result.places.b.place.lon, result.places.b.place.lat], positionAgeH: result.positionAgeH },
      group: pick.verdict.group,
    };
  });
  const rank = { "act-now": 0, "check-first": 1, ok: 2 } as const;
  const margin = (car: CarSummary) => (car.check.outcome === "checked" ? car.check.verdict.marginH : 0);
  cars.sort((x, y) => (x.group === null ? 3 : rank[x.group]) - (y.group === null ? 3 : rank[y.group]) || margin(x) - margin(y));
  return { batch: entry.batch, progress: { checked: pending ? 0 : cars.length, total: cars.length }, cars };
}

/** The EXAMPLE batch as a CSV in the default columns, times set so each car shows the margin it was made for. */
export function exampleCsv(state: FakeState, asOf: Date): string {
  const reported = instant(new Date(asOf.getTime() - 3 * 3_600_000));
  const lines = ["car_id,last_node,next_node,reported_at,shop,prep_end"];
  for (const car of EXAMPLE_CARS) {
    const report: CarReport = { carId: car.carId, a: { kind: "text", text: car.a }, b: { kind: "text", text: car.b }, shop: { kind: "text", text: car.shop }, stops: [], reportedAt: reported, prepEnd: reported };
    const result = check(state, report, instant(asOf));
    const arrival = result.outcome === "checked" ? result.options[0].verdict.arrival.ifAtB : reported;
    const prepEnd = addHours(arrival, -car.marginH);
    lines.push([car.carId, `"${car.a}"`, `"${car.b}"`, reported, car.shop, prepEnd].join(","));
  }
  return lines.join("\n");
}

// ---- shops and codes ----

function shopView(state: FakeState, id: string, draft: ShopDraft, example: boolean): ShopView | { error: string } {
  const place = resolve(state, draft.location, "shop");
  if (!place.ok) return { error: place.problem.message };
  const location = place.place.fraId !== null ? { fraId: place.place.fraId, railroad: place.place.railroad } : { lon: place.place.lon, lat: place.place.lat };
  return { id: id as ShopId, name: draft.name, code: draft.code, location, example, place: { ok: true, place: { ...place.place, label: draft.name, match: { ...place.place.match, method: "shop" } } } };
}

function readShopCsv(state: FakeState, text: string): ImportReport<ShopView> {
  const [header, ...rows] = parseCsv(text);
  const ready: ShopView[] = [];
  const issues: RowIssue[] = [];
  const h = (name: string) => header?.indexOf(name) ?? -1;
  rows.forEach((cells, row) => {
    const name = cells[h("name")] ?? "";
    const code = h("node_code") >= 0 ? (cells[h("node_code")] ?? "") : "";
    const location: PlaceRef = h("lon") >= 0 ? { kind: "coord", lon: Number(cells[h("lon")]), lat: Number(cells[h("lat")]) } : { kind: "text", text: code };
    const view = shopView(state, `shop-${state.nextId++}`, { name, code: code || null, location }, false);
    if ("error" in view) issues.push({ row, line: row + 2, field: "shop", message: view.error });
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

export function createFakeState(options: { seed?: "example" | "empty"; asOf?: Date } = {}): FakeState {
  const state: FakeState = {
    assumptions: structuredClone(DEFAULT_ASSUMPTIONS),
    profile: structuredClone(DEFAULT_PROFILE),
    shops: [],
    codes: [],
    codeSets: [],
    batches: [],
    fixes: new Map(),
    pendingReads: 0,
    down: false,
    nextId: 1,
  };
  if (options.seed === "empty") return state;
  for (const [i, shop] of EXAMPLE_SHOPS.entries()) {
    const view = shopView(state, `shop-ex-${i + 1}`, { name: shop.name, code: shop.code, location: { kind: "coord", lon: shop.at[0], lat: shop.at[1] } }, true);
    if (!("error" in view)) state.shops.push(view);
  }
  const asOf = options.asOf ?? FAKE_NOW;
  const text = exampleCsv(state, asOf);
  const { reports, issues } = readBatch(state, text);
  state.batches.push({
    batch: { id: "batch-example" as BatchId, name: "EXAMPLE cars-nov17.csv", asOf: instant(asOf), createdAt: instant(asOf), source: { kind: "csv", label: "EXAMPLE cars-nov17.csv" }, rows: reports.length, issues, example: true },
    reports,
  });
  return state;
}

function handle(state: FakeState, method: string, url: URL, body: unknown): unknown {
  const path = url.pathname;
  const q = url.searchParams;
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const route = `${method} ${path}`;
  const anyBody = body as Record<string, unknown>;

  if (route === "GET /api/meta") {
    const exampleOnly = state.shops.every((s) => s.example) && state.batches.every((b) => b.batch.example);
    return { graphVersion: "fake", railroads: RAILROADS, exampleOnly, storage: "~/.visnarn/visnarn.db" };
  }
  if (route === "GET /api/assumptions") return state.assumptions;
  if (route === "PUT /api/assumptions") {
    const next = body as Assumptions;
    if (!(next.timing.speedKmPerDay > 0)) throw new HttpError(400, "invalid", "Speed must be more than 0 km/day.", "timing.speedKmPerDay");
    if (!next.routing.allowed.length) throw new HttpError(400, "invalid", "Allow at least one railroad.", "routing.allowed");
    state.assumptions = next;
    return next;
  }
  if (route === "GET /api/import-profile") return state.profile;
  if (route === "PUT /api/import-profile") return (state.profile = body as ImportProfile);

  if (route === "GET /api/places/suggest") return suggest(state, q.get("q") ?? "", (q.get("role") ?? "position") as PlaceRole);
  if (route === "POST /api/places/resolve") return resolve(state, anyBody.ref as PlaceRef, anyBody.role as PlaceRole);
  if (route === "GET /api/places/nearest") return nearestNode(Number(q.get("lon")), Number(q.get("lat")), Number(q.get("withinKm")));

  if (route === "GET /api/shops") return state.shops;
  if (route === "POST /api/shops/import") {
    const report = readShopCsv(state, (anyBody.source as { text: string }).text);
    if (anyBody.commit) state.shops.push(...report.ready);
    return { ...report, committed: !!anyBody.commit };
  }
  if (route === "POST /api/shops" || (method === "PUT" && parts[1] === "shops" && parts.length === 3)) {
    const draft = body as ShopDraft;
    const id = method === "PUT" ? parts[2] : `shop-${state.nextId++}`;
    const existing = state.shops.find((s) => s.id === id);
    if (method === "PUT" && !existing) throw new HttpError(404, "not-found", "That shop is not in Your shops any more.");
    const holder = draft.code ? state.shops.find((s) => s.code === draft.code && s.id !== id) : undefined;
    if (holder) throw new HttpError(409, "conflict", `The shop "${holder.name}" already has the code ${draft.code}. Give each shop its own code.`, "code");
    const view = shopView(state, id, draft, false);
    if ("error" in view) throw new HttpError(400, "invalid", view.error, "location");
    state.shops = existing ? state.shops.map((s) => (s.id === id ? view : s)) : [...state.shops, view];
    return view;
  }
  if (method === "DELETE" && parts[1] === "shops" && parts.length === 3) {
    state.shops = state.shops.filter((s) => s.id !== parts[2]);
    return null;
  }

  if (route === "GET /api/codes") return state.codeSets;
  if (route === "POST /api/codes/import") {
    const [header, ...rows] = parseCsv((anyBody.source as { text: string }).text);
    const h = (name: string) => header?.indexOf(name) ?? -1;
    const ready: NodeCode[] = [];
    const issues: RowIssue[] = [];
    rows.forEach((cells, row) => {
      const lon = Number(cells[h("lon")]);
      const lat = Number(cells[h("lat")]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !nearestCity(lon, lat, 60)) issues.push({ row, line: row + 2, field: null, message: `Code ${cells[h("code")]} matches no node.` });
      else ready.push({ codeType: anyBody.codeType as string, code: cells[h("code")] ?? "", name: cells[h("name")] || null, location: { lon, lat } });
    });
    if (anyBody.commit) {
      state.codes = [...state.codes.filter((c) => c.codeType !== anyBody.codeType), ...ready];
      state.codeSets = [...state.codeSets.filter((s) => s.codeType !== anyBody.codeType), { codeType: anyBody.codeType as string, label: anyBody.label as string, count: ready.length, importedAt: instant(FAKE_NOW) }];
    }
    return { committed: !!anyBody.commit, ready, issues };
  }
  if (method === "DELETE" && parts[1] === "codes" && parts.length === 3) {
    state.codeSets = state.codeSets.filter((s) => s.codeType !== parts[2]);
    state.codes = state.codes.filter((c) => c.codeType !== parts[2]);
    return null;
  }

  if (route === "GET /api/batches") return [...state.batches].reverse().map((b) => b.batch);
  if (route === "POST /api/batches") {
    const upload = anyBody as { name: string; asOf: Instant; source: { fileName: string; text: string } };
    const { reports, issues } = readBatch(state, upload.source.text);
    const batch: Batch = { id: `batch-${state.nextId++}` as BatchId, name: upload.name, asOf: upload.asOf, createdAt: instant(FAKE_NOW), source: { kind: "csv", label: upload.source.fileName }, rows: reports.length, issues, example: false };
    state.batches.push({ batch, reports });
    return batch;
  }
  if (parts[1] === "batches" && parts.length >= 3) {
    const entry = state.batches.find((b) => b.batch.id === parts[2]);
    if (!entry) throw new HttpError(404, "not-found", "That batch is not on this laptop any more.");
    if (parts.length === 3 && method === "GET") return batchView(state, entry);
    if (parts.length === 3 && method === "DELETE") {
      state.batches = state.batches.filter((b) => b !== entry);
      return null;
    }
    const row = Number(parts[4]);
    const raw = entry.reports[row];
    if (parts[3] !== "cars" || !raw) throw new HttpError(404, "not-found", "That row is not in the batch.");
    if (parts.length === 5 && method === "GET") {
      const car: BatchCar = { batch: entry.batch, row, report: reportWithFix(state, entry.batch.id, row, raw), fix: state.fixes.get(fixKey(entry.batch.id, row)) ?? null };
      return car;
    }
    if (parts[5] === "fix" && method === "PUT") {
      const fix: SavedFix = { stops: (anyBody.stops as StopRef[]) ?? [], savedAt: instant(FAKE_NOW) };
      state.fixes.set(fixKey(entry.batch.id, row), fix);
      return fix;
    }
    if (parts[5] === "fix" && method === "DELETE") {
      state.fixes.delete(fixKey(entry.batch.id, row));
      return null;
    }
  }

  if (route === "POST /api/check") return check(state, anyBody.report as CarReport, anyBody.asOf as Instant);
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
