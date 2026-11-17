import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../shared/assumptions.ts";
import type { FraId } from "../shared/places.ts";
import type { RouteFlag, RoutePath, TurnBack } from "../shared/route.ts";
import { addHours, type Instant } from "../shared/time.ts";
import type { RoutedTrip } from "./trip.ts";
import { assumptionsProblem, classifyTiming, judge, travelHours, triage, type CarClock } from "./verdict.ts";

const T0 = "2026-11-17T12:00:00.000Z" as Instant;
const later = (hours: number) => addHours(T0, hours);

/** 800 km from B to the shop: BNSF for 400 km, an interchange, then UP. Nothing about it is suspicious. */
const cleanPath = (over: Partial<RoutePath> = {}): RoutePath => ({
  strategies: ["pick"],
  km: 800,
  interchanges: 1,
  railroads: ["BNSF", "UP"],
  legs: [],
  turnBacks: [],
  steps: [
    { kind: "leg", kmFromB: 0, leg: 0 },
    { kind: "interchange", kmFromB: 400, from: "BNSF", to: "UP", at: "Fort Worth, TX" },
    { kind: "leg", kmFromB: 400, leg: 1 },
    { kind: "shop", kmFromB: 800 },
  ],
  passesA: false,
  ...over,
});

const tripOf = (paths: [RoutePath, ...RoutePath[]], over: Partial<RoutedTrip> = {}): RoutedTrip => ({
  approach: { onTrack: true, km: 100, paths: [] },
  straightKm: 700,
  paths,
  ...over,
});

/** Prep ends 40 h after the report; at 400 km/day the clean path arrives at 72 h, 32 h after prep ends. */
const clock = (over: Partial<CarClock> = {}): CarClock => ({ reportedAt: T0, prepEnd: later(40), asOf: later(3), ...over });

const turnBack: TurnBack = {
  at: { fraId: 357961 as FraId, lon: -97.34607, lat: 31.09534, near: "Temple, TX" },
  railroad: "BNSF",
  arrives: { subdivision: "GALVESTON", headingDeg: 295 },
  leaves: { subdivision: "GALVESTON", headingDeg: 115 },
  turnDeg: 180,
  track: "stub-end",
};

describe("timing", () => {
  it("adds the interchange delay to the running time", () => {
    expect(travelHours(800, 1, DEFAULT_ASSUMPTIONS.timing)).toBe(48 + 24);
  });
  it("classifies the margin against the buffer", () => {
    expect(classifyTiming(30, 24)).toBe("on-time");
    expect(classifyTiming(5, 24)).toBe("tight");
    expect(classifyTiming(-1, 24)).toBe("at-risk");
  });
});

describe("judge", () => {
  it("ifAtB ≤ ifJustPastA, and they differ by exactly the approach km at the assumed speed", () => {
    const [option] = judge(tripOf([cleanPath()]), clock(), DEFAULT_ASSUMPTIONS);
    expect(option.verdict.arrival).toEqual({ ifAtB: later(72), ifJustPastA: later(72 + 6) });
    for (const step of option.steps) expect(Date.parse(step.eta.ifJustPastA) - Date.parse(step.eta.ifAtB)).toBe(6 * 3_600_000);
  });

  it("gives every step a time, counting only the interchanges before it", () => {
    const [option] = judge(tripOf([cleanPath()]), clock(), DEFAULT_ASSUMPTIONS);
    expect(option.steps.map((s) => [s.kind, s.eta.ifAtB])).toEqual([
      ["leg", later(0)],
      ["interchange", later(24)],
      ["leg", later(48)],
      ["shop", later(72)],
    ]);
  });

  it("measures the margin from the earliest arrival to prep end, against the buffer", () => {
    const at = (prepEndH: number) => judge(tripOf([cleanPath()]), clock({ prepEnd: later(prepEndH) }), DEFAULT_ASSUMPTIONS)[0].verdict;
    expect(at(40)).toMatchObject({ marginH: 32, timing: "on-time", group: "ok" });
    expect(at(60)).toMatchObject({ marginH: 12, timing: "tight", group: "check-first" });
    expect(at(80)).toMatchObject({ marginH: -8, timing: "at-risk", group: "act-now" });
  });

  it("flags any turn-back, a detour over the ratio, an approach that is not on track, passing A again, a stale position", () => {
    expect(judge(tripOf([cleanPath()]), clock(), DEFAULT_ASSUMPTIONS)[0].verdict.flags).toEqual([]);
    const flagged = judge(
      tripOf([cleanPath({ km: 1100, turnBacks: [turnBack], passesA: true })], { approach: { onTrack: false, km: 75, paths: [] } }),
      clock({ prepEnd: later(-100), asOf: later(60) }),
      DEFAULT_ASSUMPTIONS,
    )[0].verdict;
    expect(flagged.flags).toEqual([
      { kind: "turn-back", places: ["Temple, TX"] },
      { kind: "detour", ratio: 1.57 },
      { kind: "approach-not-on-track" },
      { kind: "passes-a-again" },
      { kind: "stale-position", ageH: 60 },
    ]);
    // Each flag on its own keeps an otherwise on-time car out of OK.
    const one = (path: RoutePath, over: Partial<RoutedTrip> = {}, c = clock()) => judge(tripOf([path], over), c, DEFAULT_ASSUMPTIONS)[0].verdict;
    for (const verdict of [
      one(cleanPath({ turnBacks: [turnBack] })),
      one(cleanPath({ km: 1100, steps: [{ kind: "shop", kmFromB: 1100 }], interchanges: 0 }), {}, clock({ prepEnd: later(-100) })),
      one(cleanPath(), { approach: { onTrack: false, km: 100, paths: [] } }),
      one(cleanPath({ passesA: true })),
      one(cleanPath(), {}, clock({ asOf: later(49) })),
      one(cleanPath(), { approach: { onTrack: true, km: 0, paths: [] } }),
    ]) {
      expect(verdict.flags.length).toBe(1);
      expect(verdict.group).toBe("check-first");
    }
  });

  it("A and B at the same place (no movement between them) is never OK: the direction is unknown", () => {
    const verdict = judge(tripOf([cleanPath()], { approach: { onTrack: true, km: 0, paths: [] } }), clock({ prepEnd: later(-500) }), DEFAULT_ASSUMPTIONS)[0].verdict;
    expect(verdict.timing).toBe("on-time");
    expect(verdict.flags).toEqual([{ kind: "direction-unknown" }]);
    expect(verdict.group).toBe("check-first");
  });

  it("changing timing or flags changes verdicts but needs no new RoutedTrip", () => {
    const trip = tripOf([cleanPath()]);
    const before = JSON.stringify(trip);
    const fast: Assumptions = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: 800 } };
    const strict: Assumptions = { ...DEFAULT_ASSUMPTIONS, flags: { ...DEFAULT_ASSUMPTIONS.flags, detourRatio: 1.1 } };
    const base = judge(trip, clock(), DEFAULT_ASSUMPTIONS)[0].verdict;
    const faster = judge(trip, clock(), fast)[0].verdict;
    const stricter = judge(trip, clock(), strict)[0].verdict;
    expect(base).toMatchObject({ marginH: 32, timing: "on-time" });
    expect(faster).toMatchObject({ arrival: { ifAtB: later(24 + 24) }, marginH: 8, timing: "tight" });
    expect(stricter.flags).toEqual([{ kind: "detour", ratio: 1.14 }]);
    expect(JSON.stringify(trip)).toBe(before);
  });

  it("keeps the paths in order (pick first) and names each option by the first strategy that found it", () => {
    const options = judge(
      tripOf([cleanPath({ strategies: ["pick", "fewest-interchanges"] }), cleanPath({ strategies: ["shortest"], km: 750 }), cleanPath({ strategies: ["no-turn-backs"], km: 900 })]),
      clock(),
      DEFAULT_ASSUMPTIONS,
    );
    expect(options.map((o) => o.id)).toEqual(["pick", "shortest", "no-turn-backs"]);
    expect(options[0].strategies).toEqual(["pick", "fewest-interchanges"]);
  });
});

describe("triage", () => {
  it("at-risk is act-now even with route flags", () => {
    expect(triage("at-risk", [])).toBe("act-now");
    expect(triage("at-risk", [{ kind: "turn-back", places: ["Temple, TX"] }])).toBe("act-now");
  });
  it("a flagged route is check-first, never ok, whatever its margin", () => {
    const flags: RouteFlag[] = [
      { kind: "turn-back", places: ["Temple, TX"] },
      { kind: "detour", ratio: 2 },
      { kind: "approach-not-on-track" },
      { kind: "passes-a-again" },
      { kind: "stale-position", ageH: 72 },
      { kind: "direction-unknown" },
    ];
    for (const flag of flags) {
      expect(triage("on-time", [flag])).toBe("check-first");
      expect(triage("tight", [flag])).toBe("check-first");
    }
  });
  it("tight without flags is check-first; on-time without flags is ok", () => {
    expect(triage("tight", [])).toBe("check-first");
    expect(triage("on-time", [])).toBe("ok");
  });
});

describe("assumptionsProblem", () => {
  const withNumbers = (change: (a: Assumptions) => void) => {
    const copy = structuredClone(DEFAULT_ASSUMPTIONS);
    change(copy);
    return assumptionsProblem(copy);
  };
  it("accepts the defaults", () => {
    expect(assumptionsProblem(DEFAULT_ASSUMPTIONS)).toBeNull();
  });
  it("names the bad number: speed ≤ 0, negative delay / buffer / penalty, no railroad allowed, ratio < 1", () => {
    expect(withNumbers((a) => (a.timing.speedKmPerDay = 0))).toMatch(/speed/i);
    expect(withNumbers((a) => (a.timing.speedKmPerDay = Number.NaN))).toMatch(/speed/i);
    expect(withNumbers((a) => (a.timing.interchangeDelayH = -1))).toMatch(/delay/i);
    expect(withNumbers((a) => (a.timing.bufferH = -1))).toMatch(/buffer/i);
    expect(withNumbers((a) => (a.routing.interchangePenaltyKm = -5))).toMatch(/penalty/i);
    expect(withNumbers((a) => (a.routing.allowed = []))).toMatch(/railroad/i);
    expect(withNumbers((a) => (a.flags.detourRatio = 0.9))).toMatch(/detour/i);
    expect(withNumbers((a) => (a.flags.positionAgeH = -1))).toMatch(/age/i);
  });
});
