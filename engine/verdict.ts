/**
 * From a routed trip and the car's times to a verdict. Pure arithmetic and policy: no routing, no
 * clock of its own (the "as of" time is an input), so re-timing a whole batch after a speed change
 * costs nothing.
 */
import type { Assumptions } from "../shared/assumptions.ts";
import type { EtaWindow, RouteFlag, RouteOption, RoutePath, RouteStep, TimingStatus, TriageGroup } from "../shared/route.ts";
import { addHours, hoursBetween, type Instant } from "../shared/time.ts";
import type { RoutedTrip } from "./trip.ts";

export interface CarClock {
  reportedAt: Instant;
  prepEnd: Instant;
  /** The moment the position is judged from: the batch's "as of", or now for a car typed by hand. */
  asOf: Instant;
}

export function travelHours(km: number, interchanges: number, timing: Assumptions["timing"]): number {
  return (km / timing.speedKmPerDay) * 24 + interchanges * timing.interchangeDelayH;
}

export function classifyTiming(marginH: number, bufferH: number): TimingStatus {
  return marginH >= bufferH ? "on-time" : marginH >= 0 ? "tight" : "at-risk";
}

/**
 * Which pile a car goes on. The one place this policy lives:
 *   at-risk                       → act-now      (even with route flags: the shop must hear about it)
 *   any flag, timing not at-risk  → check-first  (a route problem comes before a timing verdict)
 *   tight, no flags               → check-first  (open question 1 in docs/RATIONALE.md)
 *   on-time, no flags             → ok
 */
export function triage(timing: TimingStatus, flags: RouteFlag[]): TriageGroup {
  if (timing === "at-risk") return "act-now";
  if (flags.length || timing === "tight") return "check-first";
  return "ok";
}

/** Why these assumptions cannot produce a result, or null when they can. */
export function assumptionsProblem(assumptions: Assumptions): string | null {
  const { routing, timing, flags } = assumptions;
  const bad = (n: number) => !Number.isFinite(n);
  if (!routing.allowed.length) return "Allow at least one railroad.";
  if (bad(routing.interchangePenaltyKm) || routing.interchangePenaltyKm < 0) return "The interchange penalty cannot be negative.";
  if (bad(timing.speedKmPerDay) || timing.speedKmPerDay <= 0) return "Speed must be more than 0 km/day.";
  if (bad(timing.interchangeDelayH) || timing.interchangeDelayH < 0) return "The delay per interchange cannot be negative.";
  if (bad(timing.bufferH) || timing.bufferH < 0) return "The buffer cannot be negative.";
  if (bad(flags.detourRatio) || flags.detourRatio < 1) return "The detour ratio must be 1 or more.";
  if (bad(flags.positionAgeH) || flags.positionAgeH < 0) return "The position age limit cannot be negative.";
  return null;
}

/** Every path of the trip under these assumptions and times, pick first. */
export function judge(trip: RoutedTrip, clock: CarClock, assumptions: Assumptions): [RouteOption, ...RouteOption[]] {
  const { timing } = assumptions;
  const etaAt = (km: number, interchanges: number): EtaWindow => ({
    ifAtB: addHours(clock.reportedAt, travelHours(km, interchanges, timing)),
    ifJustPastA: addHours(clock.reportedAt, travelHours(km + trip.approach.km, interchanges, timing)),
  });
  const ageH = hoursBetween(clock.reportedAt, clock.asOf);

  const option = (path: RoutePath): RouteOption => {
    let interchangesBefore = 0;
    const steps: RouteStep[] = path.steps.map((step) => {
      const eta = etaAt(step.kmFromB, interchangesBefore);
      if (step.kind === "interchange") interchangesBefore++;
      return { ...step, eta };
    });
    const arrival = etaAt(path.km, path.interchanges);
    const marginH = hoursBetween(clock.prepEnd, arrival.ifAtB);
    const flags: RouteFlag[] = [];
    if (path.turnBacks.length) flags.push({ kind: "turn-back", places: path.turnBacks.map((t) => t.at.near) });
    if (trip.straightKm > 0 && path.km / trip.straightKm > assumptions.flags.detourRatio) {
      flags.push({ kind: "detour", ratio: Math.round((path.km / trip.straightKm) * 100) / 100 });
    }
    if (!trip.approach.onTrack) flags.push({ kind: "approach-not-on-track" });
    if (trip.approach.km <= 0) flags.push({ kind: "direction-unknown" });
    if (path.passesA) flags.push({ kind: "passes-a-again" });
    if (ageH > assumptions.flags.positionAgeH) flags.push({ kind: "stale-position", ageH });
    const status = classifyTiming(marginH, timing.bufferH);
    return { ...path, steps, id: path.strategies[0], verdict: { arrival, marginH, timing: status, flags, group: triage(status, flags) } };
  };

  const [pick, ...others] = trip.paths;
  return [option(pick), ...others.map(option)];
}
