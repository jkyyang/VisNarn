/**
 * The car being worked on in the Route and Fix route screens: what is typed, what was last checked,
 * and the stops a person has added. View state only: it lives in memory, in the browser. The check
 * itself comes from the server (useCarCheck), and a fix is saved there with saveFix.
 *
 * `draft` is what the inputs show; `submitted` is what the check is computed from. Typing touches
 * the draft only. "Check" copies draft → submitted, and a map pick writes its one field to both.
 * Stops take effect at once and keep their history, which is what Undo, Redo and the delta balloon
 * work on.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { BatchCar, CarReport, CheckedCar, StopRef } from "../../../shared/cars.ts";
import { haversineKm } from "../../../shared/geo.ts";
import type { NetworkNode, PlaceRef } from "../../../shared/places.ts";
import type { Railroad } from "../../../shared/railroads.ts";
import { instant, type Instant } from "../../../shared/time.ts";
import type { CarKey } from "../../app/routes.ts";
import { snapToNetwork, type QueryState } from "../../data/hooks.ts";
import { fromLocalInput, instantToLocalInput, toLocalInput } from "../../format.ts";

type LonLat = { lon: number; lat: number };

/** A place input: the reference that will be checked, and the text shown for it. */
export interface PlaceInput {
  ref: PlaceRef;
  shown: string;
}

export interface CarDraft {
  carId: string;
  a: PlaceInput;
  b: PlaceInput;
  shop: PlaceInput;
  /** <input type="datetime-local"> values, in the browser's zone. */
  reportedAt: string;
  prepEnd: string;
}

export type PickTarget = "a" | "b" | "shop" | "stop";

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface CarSession {
  car: CarKey;
  draft: CarDraft;
  submitted: CarDraft;
  stops: History<StopRef[]>;
  /** When the session began: the "as of" time for a car typed by hand. */
  startedAt: Instant;
  pick: PickTarget | null;
  /** The last map click was too far from any track. */
  pickMissed: boolean;
  /** A stop was clicked where railroads meet: waiting for the answer to "Which line?". */
  lineChoice: NetworkNode | null;
  /** Where the stop waiting for "Which line?" goes among the others. */
  lineChoiceIndex: number;
}

export type SessionAction =
  | { type: "edit"; field: "carId" | "reportedAt" | "prepEnd"; value: string }
  | { type: "editPlace"; field: "a" | "b" | "shop"; value: PlaceInput }
  | { type: "swapAB" }
  | { type: "submit" }
  | { type: "pick"; target: PickTarget | null }
  | { type: "pickMissed" }
  | { type: "picked"; field: "a" | "b" | "shop"; value: PlaceInput }
  | { type: "stopPicked"; node: NetworkNode; index: number }
  | { type: "lineChosen"; railroad: Railroad }
  | { type: "removeStop"; index: number }
  | { type: "undo" }
  | { type: "redo" };

const text = (value: string): PlaceInput => ({ ref: { kind: "text", text: value }, shown: value });

/**
 * The EXAMPLE car of the mockups, reported this hour, prep ending at midnight two days on. Free
 * text, so it resolves through Your shops when the EXAMPLE shop is there and as a city otherwise.
 */
export function exampleDraft(now: Date): CarDraft {
  const reported = new Date(now);
  reported.setMinutes(0, 0, 0);
  const prepEnd = new Date(reported);
  prepEnd.setDate(prepEnd.getDate() + 2);
  prepEnd.setHours(0, 0, 0, 0);
  return {
    carId: "EXAMPLE 104233",
    a: text("Taylor, TX"),
    b: text("Temple, TX"),
    shop: text("North Little Rock, AR"),
    reportedAt: toLocalInput(reported),
    prepEnd: toLocalInput(prepEnd),
  };
}

/** What an input shows for a reference it did not type itself. The check's place label replaces a blank. */
export function shownOf(ref: PlaceRef): string {
  switch (ref.kind) {
    case "text":
      return ref.text;
    case "code":
      return ref.code;
    case "node":
      return `FRA node ${ref.fraId}`;
    case "coord":
      return `${ref.lon}, ${ref.lat}`;
    case "shop":
      return "";
  }
}

const input = (ref: PlaceRef): PlaceInput => ({ ref, shown: shownOf(ref) });

/** A batch row as form values. */
export function draftOf(row: BatchCar): CarDraft {
  const { report } = row;
  return {
    carId: report.carId,
    a: input(report.a),
    b: input(report.b),
    shop: input(report.shop),
    reportedAt: instantToLocalInput(report.reportedAt),
    prepEnd: instantToLocalInput(report.prepEnd),
  };
}

/** `stops`: the fix the batch row has saved, as the starting point; empty for a typed car. */
export function startSession(car: CarKey, draft: CarDraft, stops: StopRef[], startedAt: Instant): CarSession {
  return {
    car,
    draft,
    submitted: draft,
    stops: { past: [], present: stops, future: [] },
    startedAt,
    pick: null,
    pickMissed: false,
    lineChoice: null,
    lineChoiceIndex: 0,
  };
}

const sameNode = (stop: StopRef, fraId: number) => stop.place.kind === "node" && stop.place.fraId === fraId;

function pushStops(session: CarSession, next: StopRef[]): CarSession {
  const { stops } = session;
  return { ...session, stops: { past: [...stops.past, stops.present], present: next, future: [] } };
}

function insertStop(session: CarSession, node: NetworkNode, railroad: Railroad | null, index: number): CarSession {
  const present = session.stops.present;
  const at = Math.max(0, Math.min(index, present.length));
  const stop: StopRef = { place: { kind: "node", fraId: node.fraId, railroad }, note: null };
  return pushStops({ ...session, pick: null, pickMissed: false, lineChoice: null }, [...present.slice(0, at), stop, ...present.slice(at)]);
}

export function sessionReducer(session: CarSession, action: SessionAction): CarSession {
  switch (action.type) {
    case "edit":
      return { ...session, draft: { ...session.draft, [action.field]: action.value } };
    case "editPlace":
      return { ...session, draft: { ...session.draft, [action.field]: action.value } };
    case "swapAB":
      // A mix-up of A and B is a likely cause of "passes A again": the swap applies to what is checked at once.
      return {
        ...session,
        draft: { ...session.draft, a: session.draft.b, b: session.draft.a },
        submitted: { ...session.submitted, a: session.submitted.b, b: session.submitted.a },
      };
    case "submit":
      return { ...session, submitted: session.draft };
    case "pick":
      return { ...session, pick: action.target, pickMissed: false, lineChoice: null };
    case "pickMissed":
      return { ...session, pickMissed: true };
    case "picked":
      return {
        ...session,
        draft: { ...session.draft, [action.field]: action.value },
        submitted: { ...session.submitted, [action.field]: action.value },
        pick: null,
        pickMissed: false,
      };
    case "stopPicked": {
      if (session.stops.present.some((stop) => sameNode(stop, action.node.fraId))) return { ...session, pick: null, pickMissed: false };
      if (action.node.railroads.length > 1) return { ...session, pick: null, pickMissed: false, lineChoice: action.node, lineChoiceIndex: action.index };
      return insertStop(session, action.node, null, action.index);
    }
    case "lineChosen":
      if (!session.lineChoice) return session;
      return insertStop(session, session.lineChoice, action.railroad, session.lineChoiceIndex);
    case "removeStop": {
      const present = session.stops.present;
      if (action.index < 0 || action.index >= present.length) return session;
      return pushStops(session, present.filter((_, i) => i !== action.index));
    }
    case "undo": {
      const { past, present, future } = session.stops;
      if (!past.length) return session;
      return { ...session, stops: { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] } };
    }
    case "redo": {
      const { past, present, future } = session.stops;
      if (!future.length) return session;
      return { ...session, stops: { past: [...past, present], present: future[0], future: future.slice(1) } };
    }
  }
}

/** The report to check: the submitted values and the current stops. Null while a time is not filled in. */
export function reportOf(session: CarSession, stops: StopRef[] = session.stops.present): CarReport | null {
  const { submitted } = session;
  const reportedAt = fromLocalInput(submitted.reportedAt);
  const prepEnd = fromLocalInput(submitted.prepEnd);
  if (!reportedAt || !prepEnd) return null;
  return { carId: submitted.carId.trim(), a: submitted.a.ref, b: submitted.b.ref, shop: submitted.shop.ref, stops, reportedAt, prepEnd };
}

const km = (p: LonLat, q: LonLat) => haversineKm(p.lon, p.lat, q.lon, q.lat);

/** Where a newly clicked stop belongs among the existing ones: where it adds the least straight-line detour between B and the shop. */
export function stopInsertIndex(b: LonLat, stops: LonLat[], shop: LonLat, clicked: LonLat): number {
  const chain = [b, ...stops, shop];
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

export interface CarSessionHandle {
  session: CarSession;
  dispatch: (action: SessionAction) => void;
  /** The report for the current stops, and the same car with no stops (the "Before" column of Fix route). */
  report: CarReport | null;
  baseline: CarReport | null;
  /** The moment positions are judged from: the batch's "as of" for a row, the session's start for a typed car. */
  asOf: Instant;
  /** The form differs from what was last checked. */
  dirty: boolean;
  /**
   * The stops differ from the fix the batch row has saved. Compared against the row as the server
   * last returned it (saving a fix refreshes that), so the session keeps no copy of saved state.
   */
  unsaved: boolean;
  /**
   * A map click while picking: snaps to the network through the server, then dispatches. `places`
   * (the last check's) lets a new stop be put in route order; without them it goes last.
   */
  applyPick: (lon: number, lat: number, toleranceKm: number, places: CheckedCar["places"] | null) => Promise<void>;
}

const keyOf = (car: CarKey) => (car.kind === "typed" ? "typed" : `${car.batchId}/${car.row}`);

/**
 * A car typed by hand survives leaving the Route screen and coming back, for as long as the page is
 * open. Memory only: nothing about a car is written to the browser's storage.
 */
let typedMemory: CarSession | null = null;

/** Starts the next typed car from the EXAMPLE values again (a page test that opens the app afresh). */
export function forgetTypedCar(): void {
  typedMemory = null;
}

type Held = { key: string; session: CarSession } | null;
type HeldAction = { type: "start"; key: string; session: CarSession } | { type: "act"; action: SessionAction };

function heldReducer(held: Held, action: HeldAction): Held {
  if (action.type === "start") return { key: action.key, session: action.session };
  if (!held) return held;
  const session = sessionReducer(held.session, action.action);
  return session === held.session ? held : { ...held, session };
}

function freshTyped(): CarSession {
  const now = new Date();
  return startSession({ kind: "typed" }, exampleDraft(now), [], instant(now));
}

/** A blank session to show while a batch row is still loading. */
function waiting(car: CarKey): CarSession {
  const blank: CarDraft = { carId: "", a: text(""), b: text(""), shop: text(""), reportedAt: "", prepEnd: "" };
  return startSession(car, blank, [], instant(new Date()));
}

/**
 * The session for a car. A typed car starts from the EXAMPLE values; a batch row starts from the
 * row once it has loaded, and starts over when the URL names another row. Esc cancels a pick.
 */
export function useCarSession(car: CarKey, row: QueryState<BatchCar>): CarSessionHandle {
  const key = keyOf(car);
  const [held, send] = useReducer(heldReducer, null, (): Held => (car.kind === "typed" ? { key, session: typedMemory ?? freshTyped() } : null));

  const rowData = row.status === "ready" ? row.data : null;
  const rowMatches = rowData !== null && car.kind === "row" && rowData.batch.id === car.batchId && rowData.row === car.row;

  // Start over when the URL names another car, and start a row once its data is here.
  const current = held?.key === key ? held : null;
  useEffect(() => {
    if (current) return;
    if (car.kind === "typed") send({ type: "start", key, session: typedMemory ?? freshTyped() });
    else if (rowMatches && rowData) send({ type: "start", key, session: startSession(car, draftOf(rowData), rowData.report.stops, rowData.batch.asOf) });
  });

  const session = current?.session ?? waiting(car);
  if (car.kind === "typed" && current) typedMemory = current.session;

  const dispatch = useCallback((action: SessionAction) => send({ type: "act", action }), []);

  const latest = useRef(session);
  latest.current = session;

  useEffect(() => {
    if (!session.pick && !session.lineChoice) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "pick", target: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.pick, session.lineChoice, dispatch]);

  const applyPick = useCallback(
    async (lon: number, lat: number, toleranceKm: number, places: CheckedCar["places"] | null) => {
      const target = latest.current.pick;
      if (!target) return;
      const node = await snapToNetwork(lon, lat, toleranceKm);
      if (latest.current.pick !== target) return;
      if (!node) {
        dispatch({ type: "pickMissed" });
        return;
      }
      if (target !== "stop") {
        dispatch({ type: "picked", field: target, value: { ref: { kind: "node", fraId: node.fraId, railroad: null }, shown: node.near } });
        return;
      }
      const index = places
        ? stopInsertIndex(places.b.place, places.stops.map((stop) => stop.place), places.shop.place, { lon: node.lon, lat: node.lat })
        : latest.current.stops.present.length;
      dispatch({ type: "stopPicked", node, index });
    },
    [dispatch],
  );

  const ready = current !== null;
  const report = useMemo(() => (ready ? reportOf(session) : null), [ready, session]);
  const baseline = useMemo(() => (ready ? reportOf(session, []) : null), [ready, session]);
  const asOf = car.kind === "row" ? (rowMatches && rowData ? rowData.batch.asOf : session.startedAt) : session.startedAt;
  const dirty = JSON.stringify(session.draft) !== JSON.stringify(session.submitted);
  const unsaved = rowMatches && rowData ? JSON.stringify(session.stops.present) !== JSON.stringify(rowData.report.stops) : false;

  return { session, dispatch, report, baseline, asOf, dirty, unsaved, applyPick };
}
