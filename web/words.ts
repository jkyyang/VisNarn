/**
 * Every sentence the app says about a car, built from domain values. The server sends facts
 * (a status, flags, hours, places); the words for them are chosen here, in one file, so the list,
 * the verdict card, the map labels and the copied text cannot drift apart.
 */
import type { Assumptions } from "../shared/assumptions.ts";
import type { BatchView, CarCheck, CarField, CarSummary, CheckedCar, CheckSummary } from "../shared/cars.ts";
import type { PlaceResolution } from "../shared/places.ts";
import type { Railroad } from "../shared/railroads.ts";
import type { RouteFlag, RouteOption, RouteStep, RouteStrategy, TimingStatus, TriageGroup, TurnBack, Verdict } from "../shared/route.ts";
import { fmtCompass, fmtHours, fmtKmShort, fmtLongDay, fmtSub } from "./format.ts";

/** A status is always a word and a shape as well as a colour. */
export type Pill = TimingStatus | "check-route" | "cannot-check";

export const PILL_LABELS: Record<Pill, string> = {
  "at-risk": "At risk",
  tight: "Tight",
  "on-time": "On time",
  "check-route": "Check route",
  "cannot-check": "Cannot check",
};
export const GROUP_LABELS: Record<TriageGroup, string> = { "act-now": "Act now", "check-first": "Check first", ok: "OK" };
/** The tags on a route card: one per strategy that found the path. */
export const STRATEGY_LABELS: Record<RouteStrategy, string> = {
  pick: "Router’s pick",
  shortest: "Shortest",
  "fewest-interchanges": "Fewest interchanges",
  "no-turn-backs": "No turn-backs",
};

export const FIELD_LABELS: Record<CarField | "assumptions" | "route", string> = {
  carId: "Car",
  a: "A (last passed)",
  b: "B (next node)",
  shop: "Shop",
  stops: "Stops",
  reportedAt: "Reported at",
  prepEnd: "Prep ends",
  assumptions: "Assumptions",
  route: "Route",
};

/** Rows of the steps chain for time the estimate leaves out. */
export const TURN_BACK_NOT_COUNTED = "Yard turn-back time: not counted";
export const INTERCHANGE_ASSUMED = "Interchange yard time: assumed, not measured";

/**
 * The pills of one verdict. A route flag always shows, and a flagged route is never "On time":
 * a timing word next to "Check route" only appears when it is a warning in its own right.
 */
export function verdictPills(verdict: Verdict): Pill[] {
  if (!verdict.flags.length) return [verdict.timing];
  if (verdict.timing === "at-risk") return ["at-risk", "check-route"];
  if (verdict.timing === "tight") return ["check-route", "tight"];
  return ["check-route"];
}

/** The one pill a route card or a map marker has room for. */
export function mainPill(verdict: Verdict): Pill {
  return verdict.flags.length && verdict.timing === "on-time" ? "check-route" : verdict.timing;
}

/** The pills for a car, most important first: [check-route, tight], [at-risk, check-route], [cannot-check] … */
export function pillsOf(check: CheckSummary | CarCheck): Pill[] {
  if (check.outcome === "pending") return [];
  if (check.outcome === "cannot-check") return ["cannot-check"];
  return verdictPills("verdict" in check ? check.verdict : check.options[0].verdict);
}

/** "Check the route before using this result" / "Arrives after prep ends, with room to spare" / … */
export function headline(verdict: Verdict): string {
  if (verdict.flags.length) return "Check the route before using this result";
  switch (verdict.timing) {
    case "at-risk":
      return "Prep may end too late";
    case "tight":
      return "Arrives after prep ends, with little room to spare";
    case "on-time":
      return "Arrives after prep ends, with room to spare";
  }
}

/** "Temple, TX" → "at Temple, TX"; "72 km from Jacksonville, FL" stays as it is. */
const atPlace = (near: string) => (/^\d/.test(near) ? near : `at ${near}`);
/** "Temple, TX" → "Temple"; "72 km from Jacksonville, FL" → "72 km from Jacksonville". */
export const shortPlace = (near: string) => near.replace(/,\s*[A-Z]{2}$/, "");

const listWords = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** One flag in plain words: "Turns back at Temple, TX (yard track)." */
export function flagSentence(flag: RouteFlag): string {
  switch (flag.kind) {
    case "turn-back":
      return flag.places.length === 1
        ? `Turns back ${atPlace(flag.places[0])} (yard track).`
        : `Turns back ${flag.places.length} times: ${listWords(flag.places)}.`;
    case "detour":
      return `The route is ${flag.ratio.toFixed(1)}× the straight line: a big detour.`;
    case "approach-not-on-track":
      return "No allowed track joins A and B, so where the car is between them is a straight-line guess.";
    case "passes-a-again":
      return "The route runs back through A. A and B may be the wrong way round.";
    case "stale-position":
      return `The position report is ${fmtHours(flag.ageH)} old.`;
    case "direction-unknown":
      return "No next node (B) was given, or B is the same place as A, so the direction the car is moving is not known. The route may need a turn-back it does not show.";
  }
}

/** The flag as the second half of a sentence: "a turn-back at Temple, TX", "2 turn-backs: X and Y". */
function flagPhrase(flag: RouteFlag): string {
  switch (flag.kind) {
    case "turn-back":
      return flag.places.length === 1 ? `a turn-back ${atPlace(flag.places[0])}` : `${flag.places.length} turn-backs: ${listWords(flag.places)}`;
    case "detour":
      return `a big detour (${flag.ratio.toFixed(1)}× the straight line)`;
    case "approach-not-on-track":
      return "A and B are not joined by allowed track";
    case "passes-a-again":
      return "the route runs back through A";
    case "stale-position":
      return `the position is ${fmtHours(flag.ageH)} old`;
    case "direction-unknown":
      return "the direction the car is moving is not known (no next node B)";
  }
}

/** "Route turns back 72 km from Jacksonville, FL." as a short add-on to a timing sentence. */
function flagAddOn(flag: RouteFlag): string {
  if (flag.kind === "turn-back") {
    return flag.places.length === 1 ? `Route turns back ${atPlace(flag.places[0])}.` : `Route turns back ${flag.places.length} times.`;
  }
  return flagSentence(flag);
}

/** "Can arrive about 14 h before prep ends." */
function timingSentence(verdict: Verdict): string {
  const h = fmtHours(verdict.marginH);
  if (verdict.timing === "at-risk") return `Can arrive about ${h} before prep ends.`;
  if (verdict.timing === "tight") return `Arrives only about ${h} after prep ends.`;
  return `Arrives about ${h} after prep ends.`;
}

/** The one-line reason under a list row: "Can arrive about 14 h before prep ends. Route turns back 72 km from Jacksonville." */
export function reasonLine(check: CheckSummary): string {
  if (check.outcome === "pending") return "Still being checked…";
  if (check.outcome === "cannot-check") return check.problems[0].message;
  const { verdict } = check;
  const [flag] = verdict.flags;
  if (!flag) return timingSentence(verdict);
  if (verdict.timing === "at-risk") return `${timingSentence(verdict)} ${flagAddOn(flag)}`;
  if (verdict.timing === "tight") return `${flagSentence(flag)} Check the route first.`;
  return `Timing looks fine, but ${flagPhrase(flag)}.`;
}

/** The railroad that carries the car farthest on this option. */
function mainRailroad(option: RouteOption): Railroad | null {
  const km = new Map<Railroad, number>();
  for (const leg of option.legs) km.set(leg.railroad, (km.get(leg.railroad) ?? 0) + leg.km);
  let best: Railroad | null = null;
  for (const [railroad, total] of km) if (best === null || total > (km.get(best) ?? 0)) best = railroad;
  return best ?? option.railroads[0] ?? null;
}

function baseName(option: RouteOption): string {
  const main = mainRailroad(option) ?? "Route";
  const change = option.steps.find((step) => step.kind === "interchange");
  if (change && change.kind === "interchange") return /^\d/.test(change.at) ? `${main}, changing ${shortPlace(change.at)}` : `${main} via ${shortPlace(change.at)}`;
  const subs = [...new Set(option.legs.filter((leg) => leg.km >= 0.5).flatMap((leg) => leg.subdivisions))];
  if (subs.length >= 2) {
    const strip = (s: string) => fmtSub(s).replace(/ Sub\b/, "");
    return `${main} via ${strip(subs[0])} and ${strip(subs[subs.length - 1])} subs`;
  }
  if (subs.length === 1) return `${main} via ${fmtSub(subs[0])}`;
  return main;
}

/** "BNSF via Lampasas and Little Rock subs" / "UP via Fort Worth": railroads, then what tells this option from the others. */
export function optionName(option: RouteOption, others: RouteOption[]): string {
  const name = baseName(option);
  const clash = others.some((other) => other.id !== option.id && baseName(other) === name);
  return clash ? `${name} · ${fmtKmShort(option.km)}` : name;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "−207 km, 1 more interchange, about 11 h later", against the router's pick. Null for the pick itself. */
export function optionDiff(option: RouteOption, pick: RouteOption): string | null {
  if (option.id === pick.id) return null;
  const parts: string[] = [];
  const km = Math.round(option.km - pick.km);
  parts.push(km === 0 ? "same length" : `${km < 0 ? "−" : "+"}${Math.abs(km).toLocaleString("en-US")} km`);
  const changes = option.interchanges - pick.interchanges;
  if (changes > 0) parts.push(`${plural(changes, "more interchange", "more interchanges")}`);
  if (changes < 0) parts.push(`${plural(-changes, "fewer interchange", "fewer interchanges")}`);
  const hours = (Date.parse(option.verdict.arrival.ifAtB) - Date.parse(pick.verdict.arrival.ifAtB)) / 3_600_000;
  parts.push(Math.abs(hours) < 1 ? "about the same time" : `about ${fmtHours(hours)} ${hours > 0 ? "later" : "earlier"}`);
  return parts.join(", ");
}

/** "on Lampasas Sub heading S" */
const onSub = (subdivision: string | null, headingDeg: number) =>
  subdivision ? `on ${fmtSub(subdivision)} heading ${fmtCompass(headingDeg)}` : `heading ${fmtCompass(headingDeg)}`;

/** "Arrives on Lampasas Sub heading S, leaves heading N". */
export function turnBackMove(turnBack: TurnBack): { arrives: string; leaves: string } {
  const sameSub = turnBack.leaves.subdivision === turnBack.arrives.subdivision;
  return {
    arrives: onSub(turnBack.arrives.subdivision, turnBack.arrives.headingDeg),
    leaves: sameSub ? `heading ${fmtCompass(turnBack.leaves.headingDeg)}` : onSub(turnBack.leaves.subdivision, turnBack.leaves.headingDeg),
  };
}

export const trackWords = (track: TurnBack["track"]) => (track === "stub-end" ? "yard track (stub end)" : "yard track");

/** "toward North Little Rock", or "toward a point 28 km from Little Rock, AR". */
const toward = (place: string) => (/^\d/.test(place) ? `toward a point ${place}` : `toward ${shortPlace(place)}`);

/** Title and second line of one step row: "Turns back at Temple, TX (yard track): check" / "Arrives on Lampasas Sub heading S, leaves heading N". */
export function stepWords(step: RouteStep, option: RouteOption): { title: string; sub: string | null } {
  switch (step.kind) {
    case "turn-back": {
      const turnBack = option.turnBacks[step.turnBack];
      if (!turnBack) return { title: "Turns back: check", sub: null };
      const move = turnBackMove(turnBack);
      return { title: `Turns back ${atPlace(turnBack.at.near)} (yard track): check`, sub: `Arrives ${move.arrives}, leaves ${move.leaves}` };
    }
    case "leg": {
      const leg = option.legs[step.leg];
      if (!leg) return { title: "Track", sub: null };
      return { title: `${leg.railroad} ${toward(leg.to)} (heading ${fmtCompass(leg.headingDeg)})`, sub: fmtKmShort(leg.km) };
    }
    case "interchange":
      return { title: `Change railroad ${step.from} → ${step.to} ${atPlace(step.at)}`, sub: null };
    case "stop":
      return { title: `Via ${step.label}`, sub: "Stop added by you" };
    case "shop":
      return { title: "Shop", sub: null };
  }
}

/** The grey rows for time the estimate does not count, and the detour line: "Route 1,046 km vs straight line 631 km (1.7×)". */
export function notCounted(option: RouteOption, car: CheckedCar): string[] {
  const rows = ["Serving yard to shop placement: not counted"];
  if (car.straightKm > 0) {
    rows.push(`Route ${fmtKmShort(option.km)} vs straight line ${fmtKmShort(car.straightKm)} (${(option.km / car.straightKm).toFixed(1)}×)`);
  }
  return rows;
}

/** "Found on the network · served by BNSF and UP", or the problem in words. */
export function placeHint(resolution: PlaceResolution): { ok: boolean; text: string } {
  if (!resolution.ok) return { ok: false, text: resolution.problem.message };
  const { place } = resolution;
  const served = `${place.railroads.length ? ` · served by ${listWords(place.railroads)}` : ""}${place.example ? " · EXAMPLE shop, not a real location" : ""}`;
  if (place.match.confidence === "snapped" && place.match.snapKm >= 1) {
    return { ok: true, text: `Nearest track is ${Math.round(place.match.snapKm)} km away${served}` };
  }
  return { ok: true, text: `Found on the network${served}` };
}

/** "400 km/day placeholder", "+24 h per interchange", "buffer 24 h". */
export function assumptionChips(assumptions: Assumptions): string[] {
  const { timing } = assumptions;
  const speed = `${timing.speedKmPerDay.toLocaleString("en-US")} km/day${timing.basis.kind === "placeholder" ? " placeholder" : ""}`;
  return [speed, `+${timing.interchangeDelayH} h per interchange`, `buffer ${timing.bufferH} h`];
}

/** "Rough estimate" / "calibrated on 40 trips". */
export function basisWords(basis: Assumptions["timing"]["basis"]): string {
  return basis.kind === "placeholder" ? "Rough estimate" : `Calibrated on ${basis.trips} trips`;
}

/** What "C" copies for one car: a line a shop planner can read on its own. */
export function carNote(car: CarSummary, assumptions: Assumptions | null): string {
  const rough = !assumptions || assumptions.timing.basis.kind === "placeholder" ? " (rough estimate)" : "";
  return `${car.carId} → ${car.shop}: ${reasonLine(car.check)}${car.check.outcome === "checked" ? rough : ""}`;
}

/**
 * What "Copy at-risk list" puts on the clipboard: plain text grouped by shop, the act-now cars only,
 * with the rough-estimate wording and one line of assumptions.
 */
export function atRiskText(view: BatchView, cars: CarSummary[], assumptions: Assumptions): string {
  const rough = assumptions.timing.basis.kind === "placeholder" ? "rough estimate" : basisWords(assumptions.timing.basis).toLowerCase();
  const tag = [rough, ...(view.batch.example ? ["EXAMPLE"] : [])].join(", ");
  const day = fmtLongDay(view.batch.asOf);
  const atRisk = cars.filter((car) => car.group === "act-now");
  const lines: string[] = [];
  if (!atRisk.length) {
    lines.push(`No at-risk cars, ${day} (${tag})`);
  } else {
    lines.push(`At-risk cars, ${day} (${tag})`);
    const byShop = new Map<string, CarSummary[]>();
    for (const car of atRisk) byShop.set(car.shop, [...(byShop.get(car.shop) ?? []), car]);
    const width = Math.max(...atRisk.map((car) => car.carId.length));
    for (const [shop, shopCars] of byShop) {
      lines.push(shopCars[0].shopExample ? `${shop} (EXAMPLE shop)` : shop);
      for (const car of shopCars) {
        const id = car.carId.padEnd(width);
        if (car.check.outcome !== "checked") {
          lines.push(`  ${id}  ${reasonLine(car.check)}`);
          continue;
        }
        const { verdict } = car.check;
        lines.push(`  ${id}  can arrive ~${fmtHours(verdict.marginH)} before prep ends`);
        for (const flag of verdict.flags) lines.push(`  ${" ".repeat(width)}  also check route: ${flagPhrase(flag)}`);
      }
    }
  }
  lines.push(`Assumes ${assumptionChips(assumptions).join(" · ")}`);
  return lines.join("\n");
}
