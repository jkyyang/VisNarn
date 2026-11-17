/**
 * Checks: from a car report to a verdict. The composition of the three things that can each say
 * "no": the Directory (does every place resolve?), the route planner (is there a route?), and the
 * engine's judge (what does the clock say?).
 *
 * Nothing here is stored. A check is a function of the report, the stored shops and codes, the
 * assumptions, the network version and the "as of" time; ask again and you get the same answer.
 */
import { assumptionsProblem, judge, tripKey, type NoRoute, type RailNetwork, type Routed, type Trip } from "../../engine/index.ts";
import { AppError } from "../../shared/app.ts";
import type { Assumptions } from "../../shared/assumptions.ts";
import type {
  BatchId, BatchView, CannotCheck, CarCheck, CarReport, CarSummary, CheckedCar, CheckProblem, PlaceResolutions, RowIssue,
} from "../../shared/cars.ts";
import { round5 } from "../../shared/geo.ts";
import type { PlaceRef, PlaceResolution, ResolvedPlace, Waypoint } from "../../shared/places.ts";
import { hoursBetween, type Instant } from "../../shared/time.ts";
import type { Directory } from "../places/directory.ts";
import type { RoutePlanner } from "../routing/planner.ts";
import type { Store } from "../store/store.ts";
import type { Batches } from "./batches.ts";

export interface Checks {
  /** One car in full: places, every route option with steps and times, the verdict. Waits for routing. */
  car(report: CarReport, asOf: Instant, signal?: AbortSignal): Promise<CarCheck>;
  /**
   * A batch as far as it is checked, without waiting. Rows whose route is not known yet are
   * "pending", and are queued for routing as background work; a later call finds them done.
   * Calling it again is free, and it is the only way batch checking starts: there is no job to
   * create, poll or cancel.
   */
  batch(id: BatchId): BatchView;
}

/** A row whose places all resolved, still waiting for its route. It has what a list line needs. */
export interface PendingCheck {
  outcome: "pending";
  report: CarReport;
  places: PlaceResolutions;
}

type Resolved = Extract<PlaceResolution, { ok: true }>;

/** Everything a route request needs, once every place has resolved and both times are known. */
interface Ready {
  places: PlaceResolutions<Resolved>;
  reportedAt: Instant;
  prepEnd: Instant;
  trip: Trip;
}

/** A report this far after the "as of" time is a typo or a wrong zone, not a clock that runs a little fast. */
const FUTURE_REPORT_TOLERANCE_H = 1;

const ROUTE_FAILED = "The route could not be worked out (the routing worker stopped). It is tried again in a moment; if this stays, restart the app.";
/** A batch row whose routing failed is tried again after this long, so one crash does not stick to the list. */
const RETRY_MS = 30_000;

/** One per batch: replaced when stored data changes, which aborts the routing queued under the old inputs. */
interface Generation {
  revision: number;
  controller: AbortController;
  /** Trip keys asked for and not answered yet. */
  queued: Set<string>;
  /** Trip keys whose routing failed, and when: such a row is "Cannot check" for a while, so the list always settles. */
  failed: Map<string, number>;
}

export function createChecks(parts: {
  network: RailNetwork;
  store: Store;
  directory: Directory;
  planner: RoutePlanner;
  batches: Batches;
}): Checks {
  const { network, store, directory, planner, batches } = parts;
  const generations = new Map<BatchId, Generation>();

  /** The places, the times and the assumptions: the first two "no"s. `issues` (a batch row's import issues) speak first. */
  const prepare = (report: CarReport, asOf: Instant, assumptions: Assumptions, issues: RowIssue[] = []): { cannot: CannotCheck } | { ready: Ready } => {
    // B is optional, as on a trip planner: with no next node the car starts at A, its direction unknown
    // (the route is flagged "direction-unknown", so it is never shown as a plain OK).
    const a = directory.resolve(report.a, "position");
    const places: PlaceResolutions = {
      a,
      b: isBlank(report.b) ? a : directory.resolve(report.b, "position"),
      shop: directory.resolve(report.shop, "shop"),
      stops: report.stops.map((stop) => directory.resolve(stop.place, "position")),
    };
    const problems: CheckProblem[] = issues.map((issue) => ({ field: issue.field ?? "carId", message: issue.message }));
    const add = (problem: CheckProblem) => {
      if (!problems.some((p) => p.field === problem.field)) problems.push(problem);
    };
    for (const field of ["a", "b", "shop"] as const) {
      const place = places[field];
      if (!place.ok) add({ field, message: place.problem.message });
    }
    places.stops.forEach((place, i) => {
      if (!place.ok) add({ field: "stops", message: `Stop ${i + 1}: ${place.problem.message}` });
    });
    if (!report.reportedAt) add({ field: "reportedAt", message: "The report time is missing, so the position cannot be timed." });
    // Counting the trip from a time still to come would push the arrival later and hide a car that is at risk.
    else if (hoursBetween(asOf, report.reportedAt) > FUTURE_REPORT_TOLERANCE_H) {
      add({
        field: "reportedAt",
        message: `The report time is ${fmtAhead(hoursBetween(asOf, report.reportedAt))} after the "as of" time, so it cannot be right. Check the year, the date and the time zone.`,
      });
    }
    if (!report.prepEnd) add({ field: "prepEnd", message: "The prep end time is missing, so there is nothing to compare the arrival with." });
    const bad = assumptionsProblem(assumptions);
    if (bad) add({ field: "assumptions", message: bad });

    if (problems.length || !report.reportedAt || !report.prepEnd) return { cannot: cannotCheck(report, places, problems) };
    const ok = places as PlaceResolutions<Resolved>;
    const trip: Trip = {
      a: waypoint(ok.a.place),
      b: waypoint(ok.b.place),
      stops: ok.stops.map((s) => waypoint(s.place)),
      shop: waypoint(ok.shop.place),
      rules: assumptions.routing,
    };
    return { ready: { places: ok, reportedAt: report.reportedAt, prepEnd: report.prepEnd, trip } };
  };

  /** The third "no", or the verdict. */
  const finish = (report: CarReport, ready: Ready, routed: Routed, asOf: Instant, assumptions: Assumptions): CarCheck => {
    if (!routed.ok) return cannotCheck(report, ready.places, [{ field: fieldOf(routed.noRoute), message: routed.noRoute.message }]);
    const checked: CheckedCar = {
      outcome: "checked",
      report,
      places: ready.places,
      reportedAt: ready.reportedAt,
      prepEnd: ready.prepEnd,
      positionAgeH: hoursBetween(ready.reportedAt, asOf),
      approach: routed.trip.approach,
      straightKm: routed.trip.straightKm,
      options: judge(routed.trip, { reportedAt: ready.reportedAt, prepEnd: ready.prepEnd, asOf }, assumptions),
      assumptions,
      graphVersion: network.version,
    };
    return checked;
  };

  const generationOf = (id: BatchId): Generation => {
    const current = generations.get(id);
    if (current && current.revision === store.revision) return current;
    current?.controller.abort(new Error("The batch's inputs changed, so its routes are asked for again."));
    // Nobody reads a deleted batch again, so its queued routing is dropped here, at the next change.
    for (const [other, generation] of generations) {
      if (other !== id && !store.batches.get(other)) {
        generation.controller.abort(new Error("The batch was deleted."));
        generations.delete(other);
      }
    }
    const next: Generation = { revision: store.revision, controller: new AbortController(), queued: new Set(), failed: new Map() };
    generations.set(id, next);
    return next;
  };

  const queue = (generation: Generation, key: string, trip: Trip) => {
    generation.queued.add(key);
    const { signal } = generation.controller;
    planner.plan(trip, "pick", { background: true, signal }).then(
      () => generation.queued.delete(key),
      () => {
        generation.queued.delete(key);
        if (!signal.aborted) generation.failed.set(key, Date.now());
      },
    );
  };

  return {
    async car(report, asOf, signal) {
      const assumptions = store.settings.assumptions();
      const prepared = prepare(report, asOf, assumptions);
      if ("cannot" in prepared) return prepared.cannot;
      let routed: Routed;
      try {
        routed = await planner.plan(prepared.ready.trip, "all", { signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        return cannotCheck(report, prepared.ready.places, [{ field: "route", message: ROUTE_FAILED }]);
      }
      return finish(report, prepared.ready, routed, asOf, assumptions);
    },

    batch(id) {
      const batch = store.batches.get(id);
      if (!batch) {
        generations.get(id)?.controller.abort(new Error("The batch was deleted."));
        generations.delete(id);
        throw new AppError("not-found", "This batch does not exist any more. It may have been deleted.");
      }
      const { reports, fixed } = batches.reports(id);
      const assumptions = store.settings.assumptions();
      const generation = generationOf(id);
      const issues = new Map<number, RowIssue[]>();
      for (const issue of batch.issues) issues.set(issue.row, [...(issues.get(issue.row) ?? []), issue]);

      const cars = reports.map((report, row) => {
        const isFixed = fixed.has(row);
        const prepared = prepare(report, batch.asOf, assumptions, issues.get(row));
        if ("cannot" in prepared) return summarize(row, prepared.cannot, isFixed);
        const { ready } = prepared;
        const routed = planner.peek(ready.trip, "pick");
        if (routed) return summarize(row, finish(report, ready, routed, batch.asOf, assumptions), isFixed);
        const key = tripKey(network.version, ready.trip);
        const failedAt = generation.failed.get(key);
        if (failedAt !== undefined && Date.now() - failedAt < RETRY_MS) {
          return summarize(row, cannotCheck(report, ready.places, [{ field: "route", message: ROUTE_FAILED }]), isFixed);
        }
        generation.failed.delete(key);
        if (!generation.queued.has(key)) queue(generation, key, ready.trip);
        return summarize(row, { outcome: "pending", report, places: ready.places }, isFixed);
      });
      cars.sort(urgency);
      return { batch, progress: { checked: cars.filter((c) => c.check.outcome !== "pending").length, total: cars.length }, cars };
    },
  };
}

/**
 * A full check cut down to one list line, with its group: the verdict's for a checked car,
 * check-first for one that cannot be checked, null while pending. The list and the detail screen
 * therefore cannot disagree.
 */
export function summarize(row: number, check: CarCheck | PendingCheck, fixed: boolean): CarSummary {
  const shop = check.places.shop;
  const base = { row, carId: check.report.carId, shop: shopLabel(check.report.shop, shop), shopExample: shop.ok && shop.place.example, fixed };
  switch (check.outcome) {
    case "pending":
      return { ...base, check: { outcome: "pending" }, group: null };
    case "cannot-check":
      return { ...base, check: { outcome: "cannot-check", problems: check.problems }, group: "check-first" };
    case "checked": {
      const [pick] = check.options;
      const b = check.places.b.place;
      return {
        ...base,
        check: { outcome: "checked", verdict: pick.verdict, km: pick.km, straightKm: check.straightKm, railroads: pick.railroads, at: [round5(b.lon), round5(b.lat)], positionAgeH: check.positionAgeH },
        group: pick.verdict.group,
      };
    }
  }
}

const GROUP_ORDER = { "act-now": 0, "check-first": 1, ok: 2 } as const;

/** List order: act-now (least margin first), check-first (cannot-check first, then least margin), ok, pending; file order breaks ties. */
export function urgency(x: CarSummary, y: CarSummary): number {
  const rank = (s: CarSummary) => (s.group === null ? 3 : GROUP_ORDER[s.group]);
  const margin = (s: CarSummary) => (s.check.outcome === "checked" ? s.check.verdict.marginH : -Infinity);
  return rank(x) - rank(y) || compare(margin(x), margin(y)) || x.row - y.row;
}

function compare(x: number, y: number): number {
  return x === y ? 0 : x < y ? -1 : 1;
}

function fmtAhead(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)} days`;
  const years = days / 365;
  return years < 1.5 ? "about 1 year" : `about ${Math.round(years)} years`;
}

function cannotCheck(report: CarReport, places: PlaceResolutions, problems: CheckProblem[]): CannotCheck {
  const [first, ...rest] = problems;
  return { outcome: "cannot-check", report, places, problems: [first, ...rest] };
}

function waypoint(place: ResolvedPlace): Waypoint {
  return { label: place.label, lon: place.lon, lat: place.lat, fraId: place.fraId, railroad: place.railroad };
}

/** "Not served" names a waypoint, which is that field's fault; "no path" is the route's. */
function fieldOf(noRoute: NoRoute): CheckProblem["field"] {
  if (noRoute.kind === "no-path") return "route";
  return typeof noRoute.at === "number" ? "stops" : noRoute.at;
}

/** The shop as the list names it: its resolved name, or what was given when it did not resolve. */
function shopLabel(ref: PlaceRef, place: PlaceResolution): string {
  if (place.ok) return place.place.label;
  switch (ref.kind) {
    case "text":
      return ref.text.trim() || "(no shop given)";
    case "shop":
      return "(deleted shop)";
    case "code":
      return `${ref.codeType} ${ref.code}`;
    case "node":
      return `FRA node ${ref.fraId}`;
    case "coord":
      return `${ref.lon}, ${ref.lat}`;
  }
}

/** A place left empty: typed text with nothing in it. */
function isBlank(ref: PlaceRef): boolean {
  return ref.kind === "text" && ref.text.trim() === "";
}
