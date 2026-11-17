import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS } from "../shared/assumptions.ts";
import type { BatchView, CarSummary, CheckSummary } from "../shared/cars.ts";
import type { RouteFlag, RouteOption, TimingStatus, Verdict } from "../shared/route.ts";
import { addHours, type Instant } from "../shared/time.ts";
import { atRiskText, flagSentence, headline, optionDiff, optionName, pillsOf, placeHint, reasonLine, stepWords } from "./words.ts";

const T0 = "2026-11-19T06:00:00.000Z" as Instant;

function verdict(timing: TimingStatus, marginH: number, flags: RouteFlag[] = []): Verdict {
  return { arrival: { ifAtB: addHours(T0, marginH), ifJustPastA: addHours(T0, marginH + 4) }, marginH, timing, flags, group: timing === "at-risk" ? "act-now" : flags.length || timing === "tight" ? "check-first" : "ok" };
}
const checked = (v: Verdict): CheckSummary => ({ outcome: "checked", verdict: v, km: 900, straightKm: 600, railroads: ["BNSF"], at: [-97, 31], positionAgeH: 0 });
const turnBack = (...places: string[]): RouteFlag => ({ kind: "turn-back", places });

function option(id: RouteOption["id"], km: number, legs: { railroad: "BNSF" | "UP"; km: number; subs: string[] }[], v: Verdict, at = "Fort Worth, TX"): RouteOption {
  const steps: RouteOption["steps"] = [];
  let from = 0;
  legs.forEach((leg, i) => {
    if (i > 0 && legs[i - 1].railroad !== leg.railroad) steps.push({ kind: "interchange", kmFromB: from, from: legs[i - 1].railroad, to: leg.railroad, at, eta: v.arrival });
    steps.push({ kind: "leg", kmFromB: from, leg: i, eta: v.arrival });
    from += leg.km;
  });
  return {
    id,
    strategies: [id],
    km,
    interchanges: steps.filter((s) => s.kind === "interchange").length,
    railroads: [...new Set(legs.map((l) => l.railroad))],
    legs: legs.map((l) => ({ railroad: l.railroad, km: l.km, from: "Temple, TX", to: "North Little Rock, AR", headingDeg: 45, subdivisions: l.subs, path: [] })),
    turnBacks: [],
    steps,
    passesA: false,
    verdict: v,
  };
}

describe("words", () => {
  it("pillsOf: check-route with the timing pill; at-risk first when the car is at risk; cannot-check alone", () => {
    expect(pillsOf(checked(verdict("tight", 23, [turnBack("Temple, TX")])))).toEqual(["check-route", "tight"]);
    expect(pillsOf(checked(verdict("at-risk", -13, [turnBack("Jacksonville, FL")])))).toEqual(["at-risk", "check-route"]);
    expect(pillsOf({ outcome: "cannot-check", problems: [{ field: "b", message: "No place called “X”." }] })).toEqual(["cannot-check"]);
    expect(pillsOf(checked(verdict("on-time", 37)))).toEqual(["on-time"]);
  });

  it("a flagged route is never shown as On time", () => {
    for (const flag of [turnBack("Hamilton, ON"), { kind: "detour", ratio: 1.9 }, { kind: "passes-a-again" }, { kind: "approach-not-on-track" }] as RouteFlag[]) {
      expect(pillsOf(checked(verdict("on-time", 40, [flag])))).toEqual(["check-route"]);
    }
  });

  it("headline says to check the route first whenever a flag is set", () => {
    expect(headline(verdict("tight", 23, [turnBack("Temple, TX")]))).toBe("Check the route before using this result");
    expect(headline(verdict("at-risk", -2, [{ kind: "stale-position", ageH: 72 }]))).toBe("Check the route before using this result");
    expect(headline(verdict("on-time", 34))).toBe("Arrives after prep ends, with room to spare");
    expect(headline(verdict("at-risk", -14))).toBe("Prep may end too late");
  });

  it("reasonLine reads 'Can arrive about 14 h before prep ends.' and adds the route problem", () => {
    expect(reasonLine(checked(verdict("at-risk", -14)))).toBe("Can arrive about 14 h before prep ends.");
    expect(reasonLine(checked(verdict("at-risk", -13, [turnBack("72 km from Jacksonville, FL")])))).toBe("Can arrive about 13 h before prep ends. Route turns back 72 km from Jacksonville, FL.");
    expect(reasonLine(checked(verdict("tight", 23, [turnBack("Temple, TX")])))).toBe("Turns back at Temple, TX (yard track). Check the route first.");
    expect(reasonLine(checked(verdict("on-time", 40, [turnBack("Hamilton, ON", "Chicago, IL")])))).toBe("Timing looks fine, but 2 turn-backs: Hamilton, ON and Chicago, IL.");
    expect(reasonLine({ outcome: "pending" })).toMatch(/checked/);
  });

  it("names flags in plain words", () => {
    expect(flagSentence(turnBack("Temple, TX"))).toBe("Turns back at Temple, TX (yard track).");
    expect(flagSentence({ kind: "passes-a-again" })).toMatch(/A and B may be the wrong way round/);
  });

  it("optionDiff reads '−207 km, 1 more interchange, about 11 h later'", () => {
    const pick = option("pick", 1046, [{ railroad: "BNSF", km: 1046, subs: ["LAMPASAS", "LITTLE ROCK"] }], verdict("tight", 23));
    const up = option("shortest", 839, [{ railroad: "BNSF", km: 212, subs: ["FORT WORTH"] }, { railroad: "UP", km: 627, subs: ["DALLAS"] }], verdict("on-time", 34));
    expect(optionDiff(up, pick)).toBe("−207 km, 1 more interchange, about 11 h later");
    expect(optionDiff(pick, pick)).toBeNull();
  });

  it("names an option by its main railroad and what sets it apart", () => {
    const pick = option("pick", 1046, [{ railroad: "BNSF", km: 1046, subs: ["LAMPASAS", "GALVESTON", "LITTLE ROCK"] }], verdict("tight", 23));
    const up = option("shortest", 839, [{ railroad: "BNSF", km: 212, subs: ["FORT WORTH"] }, { railroad: "UP", km: 627, subs: ["DALLAS"] }], verdict("on-time", 34));
    expect(optionName(pick, [pick, up])).toBe("BNSF via Lampasas and Little Rock subs");
    expect(optionName(up, [pick, up])).toBe("UP via Fort Worth");
    expect(stepWords(up.steps[1], up).title).toBe("Change railroad BNSF → UP at Fort Worth, TX");
    expect(stepWords(pick.steps[0], pick).title).toBe("BNSF toward North Little Rock (heading NE)");
  });

  it("says where a place was found, or what is wrong with it", () => {
    expect(placeHint({ ok: false, problem: { kind: "unknown", message: "No place called “Tmple”.", candidates: [] } })).toEqual({ ok: false, text: "No place called “Tmple”." });
    const place = {
      ref: { kind: "text" as const, text: "Temple, TX" },
      label: "Temple, TX",
      lon: -97.3,
      lat: 31.1,
      fraId: null,
      railroad: null,
      railroads: ["BNSF" as const, "UP" as const],
      match: { method: "city" as const, codeType: null, confidence: "snapped" as const, snapKm: 0.3 },
      example: false,
    };
    expect(placeHint({ ok: true, place })).toEqual({ ok: true, text: "Found on the network · served by BNSF and UP" });
  });

  it("atRiskText groups act-now cars by shop and states the assumptions and that the estimate is rough", () => {
    const car = (row: number, carId: string, shop: string, v: Verdict): CarSummary => ({ row, carId, shop, shopExample: shop === "Kansas City, MO", fixed: false, check: checked(v), group: v.group });
    const cars = [
      car(1, "551930", "Kansas City, MO", verdict("at-risk", -14)),
      car(2, "402196", "Birmingham, AL", verdict("at-risk", -13, [turnBack("72 km from Jacksonville, FL")])),
      car(0, "104233", "North Little Rock, AR", verdict("tight", 23, [turnBack("Temple, TX")])),
    ];
    const view: BatchView = {
      batch: { id: "b" as BatchView["batch"]["id"], name: "EXAMPLE", asOf: "2026-11-17T15:00:00.000Z" as Instant, createdAt: T0, source: { kind: "csv", label: "x" }, rows: 3, issues: [], example: true },
      progress: { checked: 3, total: 3 },
      cars,
    };
    const text = atRiskText(view, cars, DEFAULT_ASSUMPTIONS);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^At-risk cars, Tue Nov 17 \(rough estimate, EXAMPLE\)$/);
    // A shop that is an EXAMPLE location says so in the list the planner reads; a real one does not.
    expect(lines).toContain("Kansas City, MO (EXAMPLE shop)");
    expect(lines).toContain("Birmingham, AL");
    expect(lines).toContain("  551930  can arrive ~14 h before prep ends");
    expect(text).toContain("also check route: a turn-back 72 km from Jacksonville, FL");
    expect(text).not.toContain("104233");
    expect(lines[lines.length - 1]).toBe("Assumes 400 km/day placeholder · +24 h per interchange · buffer 24 h");
  });
});
