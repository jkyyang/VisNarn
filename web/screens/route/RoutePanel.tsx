/**
 * The route planner's panel: the places in travel order, the routes found, the sections of the chosen
 * one, and saving it. Views take props and return markup; PlaceField also fetches its own suggestions.
 */
import { useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { LngLat } from "../../../shared/geo.ts";
import { resolvedOf, type PlaceRef, type PlaceSuggestion, type ResolvedPlace } from "../../../shared/places.ts";
import { placeKind, type PlaceKind, type Plan, type PlannedRoute, type SavedRoute, type SavedRouteId } from "../../../shared/plans.ts";
import { RAILROADS, type Line, type Railroad, type TrackIncluded } from "../../../shared/railroads.ts";
import type { RoutePath, RouteStrategy } from "../../../shared/route.ts";
import { compactRouteString, routeStringOf, shownRouteString, type RouteString } from "../../../shared/routeString.ts";
import { linkTo } from "../../app/routes.ts";
import { fresh, usePlaceSuggestions } from "../../data/hooks.ts";
import { fmtDistance } from "../../format.ts";
import { chosenRoute, type Picked } from "../../map/scene.ts";
import { lineColor } from "../../theme.ts";
import { PlacePin, TurnBadge } from "../../ui/badges.tsx";
import { moveActive, SuggestionList } from "../../ui/combobox.tsx";
import { ConfirmDelete } from "../../ui/ConfirmDelete.tsx";
import { HistoryButtons, type History } from "../../ui/history.tsx";
import { Accordion } from "../../ui/Accordion.tsx";
import { Cross, Crosshair, Grip, Plus } from "../../ui/icons.tsx";
import { Menu, MenuItem } from "../../ui/Menu.tsx";
import { useReorder } from "../../ui/reorder.ts";
import { Switch } from "../../ui/Switch.tsx";
import type { DistanceUnit } from "../../units.ts";
import { BACK_OUT, clickToSet, errorText, interchangesWord, lineName, nearPlace, NO_TRACK_NEAR, placeProblem, plural, routeName, shortPlace } from "../../words.ts";
import { fullPlan, isEmpty, samePlan, type PlanAction, type PlanSession } from "./session.ts";

export interface RoutePanelProps {
  session: PlanSession;
  dispatch: (action: PlanAction) => void;
  /** Null until the first answer. `stale` while a newer answer is on its way; the panel dims until it lands. */
  planned: { result: PlannedRoute; stale: boolean } | null;
  error: string | null;
  selected: RouteStrategy | null;
  onSelect: (id: RouteStrategy) => void;
  saved: SavedRoute[];
  /** The saved route this plan is, when it is one. */
  open: SavedRoute | null;
  /** `routeString`: the compact route string of the chosen route, saved with it. Null on the public site, as is `onRemoveSaved`. */
  onSave: ((name: string, routeString: string) => Promise<void>) | null;
  onRemoveSaved: ((id: SavedRouteId) => Promise<void>) | null;
  onNew: () => void;
  unit: DistanceUnit;
  /** Undo and redo of the plan's changes. */
  history: History;
  /** The leg, stop or turn-back of the chosen route picked here or on the map. */
  picked: Picked | null;
  /** `at`: where a stop or turn-back picked here is, for the camera to fly to. */
  onPick: (picked: Picked | null, at?: LngLat) => void;
}

/** How long ⋯ shows ✓ after Copy route string. */
const COPIED_MS = 1000;

/** Shorter railroad stretches are left out of the sections. */
const MIN_SECTION_KM = 0.5;

// ---- places ----

/**
 * What a reference shows before the server has named it. A shop or node the server could not
 * resolve (a deleted shop) shows nothing: "…" would read as still loading next to its problem line.
 */
function givenText(ref: PlaceRef, failed: boolean): string {
  switch (ref.kind) {
    case "text":
      return ref.text;
    case "coord":
      return `${ref.lon}, ${ref.lat}`;
    case "node":
    case "shop":
      return failed ? "" : "…";
  }
}

/** The same spot on the ground, for finding a place's label in an answer to an earlier plan. */
const spotKey = (ref: PlaceRef) => (ref.kind === "node" ? `node:${ref.fraId}` : JSON.stringify(ref));

/** "Start", "Stop 2", "Destination": a row's name, its placeholder and the start of its button labels. */
const rowName = (at: number, count: number) => {
  const kind = placeKind(at, count);
  return kind === "stop" ? `Stop ${at}` : kind === "start" ? "Start" : "Destination";
};

/**
 * One place input with autocomplete, a remove button, a pick-on-map button, and the one line under it
 * when the place did not resolve. The typed text is its own while focused: Enter takes the highlighted
 * suggestion, else the first one, else the text as typed; leaving the box puts back what is set.
 */
function PlaceField(props: {
  label: string;
  kind: PlaceKind;
  committed: { ref: PlaceRef | null; label: string };
  problem: string | null;
  picking: boolean;
  /** "Remove" takes the row out; "Clear" empties one of the last two. Null: nothing to clear. */
  remove: "Remove" | "Clear" | null;
  onCommit: (ref: PlaceRef | null) => void;
  onTogglePick: () => void;
  onRemove: () => void;
}): ReactElement {
  const id = useId();
  const listId = useId();
  const problemId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const typing = draft !== null;
  // The ends look in Your shops first; a stop is a position on the track (as the server resolves them).
  const suggestions = usePlaceSuggestions(draft ?? "", props.kind === "stop" ? "position" : "shop");
  // A stale list belongs to the text before the last keystroke.
  const list: PlaceSuggestion[] = (typing && fresh(suggestions)) || [];
  const open = list.length > 0;

  const done = (ref: PlaceRef | null) => {
    setDraft(null);
    setActive(-1);
    props.onCommit(ref);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive(moveActive(active, event.key, list.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!typing) return;
      // The highlighted suggestion, else the first one listed, else the text as typed.
      const suggestion = list[Math.max(active, 0)];
      const text = (draft ?? "").trim();
      done(suggestion ? suggestion.ref : text ? { kind: "text", text } : null);
    } else if (event.key === "Escape") {
      setDraft(null);
      setActive(-1);
    }
  };

  return (
    <div className={`place-field${props.picking ? " is-picking" : ""}`}>
      <div className="input-box place-box" title={props.problem ?? undefined}>
        <span className="place-value">
          <span className="place-label" aria-hidden="true">
            {props.label}
          </span>
          <input
          id={id}
          aria-label={props.label}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={props.problem ? true : undefined}
          aria-describedby={props.problem ? problemId : undefined}
          autoComplete="off"
          enterKeyHint="go"
          placeholder="Shop or city, or click the map"
          value={draft ?? props.committed.label}
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setDraft(null);
            setActive(-1);
          }}
          />
        </span>
        {props.remove && (
          <button type="button" className="icon-btn remove-btn" aria-label={`${props.remove} ${props.label}`} title={props.remove} onClick={props.onRemove}>
            <Cross />
          </button>
        )}
        <button type="button" className="icon-btn pick-btn" aria-pressed={props.picking} aria-label={`Pick on the map: ${props.label}`} title="Pick on the map" onClick={props.onTogglePick}>
          <Crosshair />
        </button>
      </div>
      {open && <SuggestionList id={listId} label={`Suggestions for ${props.label}`} list={list} active={active} onChoose={(suggestion) => done(suggestion.ref)} />}
      {props.problem && (
        <span id={problemId} className="visually-hidden">
          {props.problem}
        </span>
      )}
    </div>
  );
}

/** A place where several railroads meet, and which of them takes the car on there (null: the router's pick). */
export interface CarrierChoice {
  at: number;
  place: string;
  railroads: Railroad[];
  line: Railroad | null;
}

/**
 * "Carrier from Temple · Router's pick": the railroad that takes the car on at a place where several meet. A click moves
 * to the next choice, round to the router's pick again.
 */
function CarrierRow(props: { choice: CarrierChoice; onChoose: (railroad: Railroad | null) => void }): ReactElement {
  const { choice } = props;
  const choices: (Railroad | null)[] = [null, ...RAILROADS.filter((railroad) => choice.railroads.includes(railroad))];
  const next = choices[(choices.indexOf(choice.line) + 1) % choices.length] ?? null;
  const word = choice.line ?? "Router's pick";
  return (
    <button type="button" className="switch-row" aria-label={`Carrier from ${choice.place}: ${word}`} title={`Next: ${next ?? "Router's pick"}`} onClick={() => props.onChoose(next)}>
      <span>Carrier from {choice.place}</span>
      <span className={choice.line ? "carrier-value" : "muted"}>
        {choice.line && <span className="rr-swatch" style={{ background: lineColor(choice.line) }} aria-hidden="true" />}
        {word}
      </span>
    </button>
  );
}

/** The place list: one row per place, in travel order, each with the same input, buttons and drag handle; then Add stop. */
function PlaceList(props: {
  session: PlanSession;
  dispatch: (action: PlanAction) => void;
  /** The answer the labels come from: matched by spot, so they survive a reorder. */
  named: Map<string, ResolvedPlace>;
  /** The answer to the plan as it is now: its places line up with the rows. */
  current: PlannedRoute | null;
  /** Null while a row is still empty: that row is where the next stop goes. */
  onAddStop: (() => void) | null;
  /** Why the plan went nowhere: the card's edge turns red, and says why on hover. */
  notice: string | null;
}): ReactElement {
  const { session, dispatch, named, current } = props;
  const { places } = session.plan.present;
  const count = places.length;
  const hintId = useId();
  const labelOf = (at: number) => {
    const ref = places[at];
    return ref ? (named.get(spotKey(ref))?.label ?? givenText(ref, current?.places[at]?.ok === false)) : "";
  };
  // Keyed by spot, so a row slides from where its place was; empty rows by their order among the empty.
  const keys = places.map((ref, at) => (ref ? spotKey(ref) : `empty-${places.slice(0, at).filter((p) => p === null).length}`));
  const reorder = useReorder(keys, (from, to) => dispatch({ type: "move", from, to }), (at) => [rowName(at, count), labelOf(at)].filter(Boolean).join(", "));
  const problemAt = (at: number): string | null => {
    if (!current) return null;
    return placeProblem(current.places[at] ?? null) ?? (current.outcome === "no-route" && current.problem.at === at ? current.problem.message : null);
  };

  return (
    <>
      <div className={`group place-group${props.notice ? " is-wrong" : ""}`} title={props.notice ?? undefined}>
        <ol className="place-list" ref={reorder.listRef}>
          {places.map((ref, at) => {
            const kind = placeKind(at, count);
            const name = rowName(at, count);
            const problem = problemAt(at);
            return (
              // By position: a row keeps its typed draft while the place in it changes.
              <li key={at} className={`place-row${reorder.grabbed === at ? " is-grabbed" : ""}`}>
                <span className="place-pin">
                  <PlacePin kind={kind} n={at} />
                </span>
                <PlaceField
                  label={name}
                  kind={kind}
                  committed={{ ref, label: labelOf(at) }}
                  problem={problem}
                  picking={session.pick === at}
                  remove={count > 2 ? "Remove" : ref ? "Clear" : null}
                  onCommit={(next) => dispatch({ type: "setPlace", at, ref: next })}
                  onTogglePick={() => dispatch({ type: "pick", at: session.pick === at ? null : at })}
                  onRemove={() => dispatch({ type: "remove", at })}
                />
                <button type="button" className="icon-btn drag-handle" aria-label={`Move ${name}`} aria-describedby={hintId} {...reorder.handleProps(at)}>
                  <Grip />
                </button>
              </li>
            );
          })}
        </ol>
        {props.onAddStop && (
          <button type="button" className="add-stop" onClick={props.onAddStop}>
            <span className="add-stop-icon" aria-hidden="true">
              <Plus size={14} />
            </span>
            Add stop
          </button>
        )}
      </div>
      <span id={hintId} className="visually-hidden">
        Space grabs, arrows move, Space drops, Escape puts back.
      </span>
      <span className="visually-hidden" aria-live="polite">
        {reorder.announcement}
      </span>
    </>
  );
}

// ---- track ----

const SMALLER_TRACK: { key: keyof TrackIncluded; label: string; short: string; tip: string }[] = [
  { key: "regional", label: "Regional lines", short: "Regional", tip: "Mid-size railroads" },
  { key: "shortLine", label: "Short lines", short: "Short lines", tip: "Small local railroads, often the last mile to a plant" },
  { key: "passenger", label: "Passenger lines", short: "Passenger", tip: "Lines owned by Amtrak, VIA or commuter agencies; freight runs on some" },
];

/** What is on, folded into one line: "Class I · Regional", or "Class I only"; a carrier chosen at a place, after it. */
export function optionsSummary(plan: Pick<Plan, "include" | "turnAtStops">, carriers: readonly CarrierChoice[] = []): string {
  const on = [...SMALLER_TRACK.filter(({ key }) => plan.include[key]).map(({ short }) => short), ...(plan.turnAtStops ? ["Turn at stops"] : [])];
  const chosen = carriers.flatMap((choice) => (choice.line ? [`${choice.line} from ${choice.place}`] : []));
  return [on.length ? ["Class I", ...on].join(" · ") : "Class I only", ...chosen].join(" · ");
}

/** "Route options", folded to what is on: which track the route may use (Class I always, the rest when on), and whether it may turn at a stop. */
function RouteOptions(props: { plan: Plan; carriers: CarrierChoice[]; dispatch: (action: PlanAction) => void }): ReactElement {
  const { include, turnAtStops } = props.plan;
  return (
    <Accordion title="Route options" summary={optionsSummary(props.plan, props.carriers)}>
      <div className="switch-row" title={`The ${RAILROADS.length} big railroads`}>
        <span>Class I lines</span>
        <span className="muted">Always on</span>
      </div>
      {SMALLER_TRACK.map(({ key, label, tip }) => (
        <Switch key={key} label={label} title={tip} on={include[key]} onChange={(on) => props.dispatch({ type: "setInclude", include: { ...include, [key]: on } })} />
      ))}
      <Switch label="Turn at stops" title="The route may leave a stop in either direction" on={turnAtStops} onChange={(on) => props.dispatch({ type: "setTurnAtStops", turnAtStops: on })} />
      {props.carriers.map((choice) => (
        <CarrierRow key={choice.at} choice={choice} onChoose={(railroad) => props.dispatch({ type: "setLine", at: choice.at, railroad })} />
      ))}
    </Accordion>
  );
}

// ---- routes ----

/** Why the router offers a route, where the row's own counts do not already say it. */
const STRATEGY_WORDS: Partial<Record<RouteStrategy, string>> = { pick: "recommended", shortest: "shortest" };

/**
 * The routes found, when there are two or more: a row each, as in the Shops list (its carriers; its interchanges and
 * turn-backs, and why it is offered; its length). Click to select; the map's pills do the same.
 */
function RouteRows(props: { routes: RoutePath[]; chosen: RoutePath; onSelect: (id: RouteStrategy) => void; unit: DistanceUnit }): ReactElement {
  return (
    <section className="group route-rows" aria-label="Routes">
      {props.routes.map((route) => {
        const turns = route.turnBacks.length;
        return (
          <button key={route.strategies[0]} type="button" className="route-row" aria-pressed={route === props.chosen} onClick={() => props.onSelect(route.strategies[0])}>
            <span className="shop-text">
              <span className="shop-name">{route.railroads.map(lineName).join(" · ")}</span>
              <span className="shop-sub">{[interchangesWord(route.interchanges), ...(turns ? [plural(turns, "turn-back")] : []), ...route.strategies.flatMap((id) => STRATEGY_WORDS[id] ?? [])].join(" · ")}</span>
            </span>
            <span className="leg-km">{fmtDistance(route.km, props.unit)}</span>
          </button>
        );
      })}
    </section>
  );
}

/** What a stop's or turn-back's row picks, where that is (for the camera), and the row's name for screen readers. */
type RowPick = { what: Picked; at: LngLat; label: string };

type CardRow =
  | { kind: "leg"; key: string; leg: number; railroad: Railroad | Line; km: number; from: string; to: string }
  | { kind: "stop" | "turn-back" | "back-out"; key: string; mark: ReactNode; text: string; pick: RowPick | null };

/**
 * The chosen route as rows: one per carrier leg (from where to where, how far), and between them, smaller, each stop,
 * turn-back and backing out of a shop's own track; a stop and a turn-back, like a leg, to pick.
 * `rows` are the place rows the route runs through, so a stop shows its row's number.
 */
function cardRows(props: { route: RoutePath; places: ResolvedPlace[]; rows: number[] }): CardRow[] {
  const { route, places } = props;
  const rows: CardRow[] = [];
  let here = nearPlace(places[0]?.label ?? "");
  // A leg's end is the next place the route names after it.
  const arrive = (place: string) => {
    for (const row of rows) if (row.kind === "leg" && !row.to) row.to = place;
    here = place;
  };
  route.steps.forEach((step, i) => {
    const key = `${step.kind}-${i}`;
    switch (step.kind) {
      case "leg": {
        const leg = route.legs[step.leg];
        if (leg && leg.km >= MIN_SECTION_KM) rows.push({ kind: "leg", key, leg: step.leg, railroad: leg.railroad, km: leg.km, from: here, to: "" });
        return;
      }
      case "interchange":
        arrive(nearPlace(step.at));
        return;
      case "stop": {
        const n = props.rows[step.stop + 1] ?? step.stop + 1;
        const place = places[step.stop + 1];
        const text = nearPlace(step.label);
        arrive(text);
        const pick: RowPick | null = place ? { what: { kind: "stop", index: n }, at: [place.lon, place.lat], label: `Stop ${n}: ${text}` } : null;
        rows.push({ kind: "stop", key, mark: <PlacePin kind="stop" n={n} />, text, pick });
        return;
      }
      case "turn-back": {
        const turnBack = route.turnBacks[step.turnBack];
        if (turnBack) arrive(nearPlace(turnBack.at.near));
        const pick: RowPick | null = turnBack ? { what: { kind: "turn-back", index: step.turnBack }, at: [turnBack.at.lon, turnBack.at.lat], label: `Turn-back at ${turnBack.at.near}` } : null;
        rows.push({ kind: "turn-back", key, mark: <TurnBadge />, text: turnBack ? nearPlace(turnBack.at.near) : "Turn-back", pick });
        return;
      }
      case "back-out":
        rows.push({ kind: "back-out", key, mark: null, text: BACK_OUT, pick: null });
        return;
      case "destination":
        arrive(nearPlace(places.at(-1)?.label ?? ""));
        return;
    }
  });
  return rows;
}

/**
 * The result: the chosen route's length, its carriers and interchanges (and turn-backs), then a row per carrier leg
 * with the stops and turn-backs between them; "Saved as" when the route string it was saved with differs from today's.
 * A leg's, stop's or turn-back's row and the same thing on the map pick each other; a stop or turn-back picked here is flown to.
 */
function ResultCard(props: {
  route: RoutePath;
  string: RouteString;
  places: ResolvedPlace[];
  rows: number[];
  unit: DistanceUnit;
  /** The route string it was saved with, when the router now gives another. */
  saved: string | null;
  picked: Picked | null;
  onPick: (picked: Picked | null, at?: LngLat) => void;
}): ReactElement {
  const { route } = props;
  const isPicked = (what: Picked) => props.picked?.kind === what.kind && props.picked.index === what.index;
  // A second press lets go.
  const press = (what: Picked, at?: LngLat) => (isPicked(what) ? props.onPick(null) : props.onPick(what, at));
  const carriers = new Set(route.legs.map((leg) => leg.railroad)).size;
  const turns = route.turnBacks.length;
  const compact = compactRouteString(props.string);
  return (
    <section className="group result" aria-label="Route">
      <div className="result-head">
        <span className="result-km">{fmtDistance(route.km, props.unit)}</span>
        <span className="muted">{[plural(carriers, "carrier"), interchangesWord(route.interchanges), ...(turns ? [plural(turns, "turn-back")] : [])].join(" · ")}</span>
      </div>
      <ol className="sections" aria-label="Sections">
        {cardRows(props).map((row) => {
          if (row.kind === "leg") {
            return (
              <li key={row.key} className="section section--leg">
                <button type="button" className="section-row" aria-pressed={isPicked({ kind: "leg", index: row.leg })} onClick={() => press({ kind: "leg", index: row.leg })}>
                  <span className="section-bar" style={{ background: lineColor(row.railroad) }} aria-hidden="true" />
                  <span className="leg-carrier">{lineName(row.railroad)}</span>
                  <span className="leg-way">
                    {row.from} → {row.to}
                  </span>
                  <span className="leg-km">{fmtDistance(row.km, props.unit)}</span>
                </button>
              </li>
            );
          }
          const { pick } = row;
          const face = (
            <>
              <span className="section-mark">{row.mark}</span>
              <span className="section-text">{row.text}</span>
            </>
          );
          return (
            <li key={row.key} className={`section section--${row.kind}`}>
              {pick ? (
                <button type="button" className="section-row" aria-label={pick.label} aria-pressed={isPicked(pick.what)} onClick={() => press(pick.what, pick.at)}>
                  {face}
                </button>
              ) : (
                face
              )}
            </li>
          );
        })}
      </ol>
      {props.saved && props.saved !== compact && <p className="saved-as">Saved as {props.saved}</p>}
    </section>
  );
}

// ---- saving ----

/** The open route's name, to rename it: Enter or leaving the box saves a changed name; Esc puts it back. */
function RouteName(props: { name: string; onRename: (name: string) => Promise<void>; onError: (message: string | null) => void }): ReactElement {
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    const name = typed?.trim();
    setTyped(null);
    if (name && name !== props.name) props.onRename(name).then(() => props.onError(null), (e: unknown) => props.onError(errorText(e, "Could not save the route.")));
  };
  return (
    <input
      className="saved-name"
      aria-label="Route name"
      value={typed ?? props.name}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setTyped(null);
      }}
    />
  );
}

/**
 * Saved routes: folded to how many; open, a row each to open it (the open one renamed in place), with a delete on the hovered row.
 * A rename or delete the server refuses turns that row's edge red, with why in its tooltip. On the public site (no
 * `onRename`, `onRemove`) every row only opens its route.
 * `justSaved`: opens unfolded, with the open route's row in view and lit once.
 */
function SavedList(props: {
  saved: SavedRoute[];
  current: SavedRouteId | null;
  unfolded: boolean;
  justSaved: boolean;
  onRename: ((name: string) => Promise<void>) | null;
  onRemove: ((id: SavedRouteId) => Promise<void>) | null;
}): ReactElement {
  const { onRename, onRemove } = props;
  const [lit, setLit] = useState(props.justSaved);
  const [confirming, setConfirming] = useState<SavedRouteId | null>(null);
  // The row whose rename or delete the server refused: its edge is red, and why is its tooltip.
  const [wrong, setWrong] = useState<{ id: SavedRouteId; why: string } | null>(null);
  const remove = (id: SavedRouteId) =>
    onRemove?.(id).then(
      () => setConfirming(null),
      (e: unknown) => setWrong({ id, why: errorText(e, "Could not delete the route.") }),
    );
  return (
    <Accordion title="Saved routes" summary={`${props.saved.length} saved`} initiallyOpen={props.unfolded || props.justSaved}>
      <ul className="saved-list" aria-label="Saved routes">
        {props.saved.map((route) => (
          <li
            key={route.id}
            className={`saved-row${route.id === props.current ? ` is-current${lit ? " is-lit" : ""}` : ""}${route.id === wrong?.id ? " is-wrong" : ""}`}
            title={route.id === wrong?.id ? wrong.why : undefined}
            ref={lit && route.id === props.current ? (row) => row?.scrollIntoView?.({ block: "nearest" }) : undefined}
            onAnimationEnd={() => setLit(false)}
          >
            {confirming === route.id ? (
              <ConfirmDelete question="Delete this route?" label={`Delete ${route.name}`} onConfirm={() => void remove(route.id)} onKeep={() => setConfirming(null)} />
            ) : (
              <>
                {route.id === props.current && onRename ? (
                  <RouteName name={route.name} onRename={onRename} onError={(why) => setWrong(why ? { id: route.id, why } : null)} />
                ) : (
                  <a className="saved-name" {...linkTo({ name: "route", saved: route.id, option: null })}>
                    {route.name}
                  </a>
                )}
                {onRemove && (
                  <button type="button" className="icon-btn remove-btn" aria-label={`Delete ${route.name}`} onClick={() => setConfirming(route.id)}>
                    <Cross />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {wrong && (
        <span className="visually-hidden" role="alert">
          {wrong.why}
        </span>
      )}
    </Accordion>
  );
}

// ---- the panel ----

/** Route with Undo / Redo · the places and which row a click on the map sets · options · the result · the other routes · saved routes. */
export function RoutePanel(props: RoutePanelProps): ReactElement {
  const { session, dispatch, planned, open } = props;
  const plan = session.plan.present;
  const result = planned?.result ?? null;
  const current = planned && !planned.stale ? planned.result : null;
  const empty = isEmpty(plan);

  const named = new Map<string, ResolvedPlace>();
  for (const resolution of result?.places ?? []) {
    const place = resolvedOf(resolution);
    if (place) named.set(spotKey(place.ref), place);
  }

  const routes = result?.outcome === "routed" ? result.routes : null;
  const hint =
    props.error ?? (session.missed ? `${NO_TRACK_NEAR}.` : session.pick !== null ? `${clickToSet(rowName(session.pick, plan.places.length))} · Esc to cancel` : "");

  const full = fullPlan(plan);
  const chosen = routes ? chosenRoute(routes, props.selected) : null;
  const string = chosen && full && routeStringOf(chosen, full.places.slice(1, -1));
  const compact = string && compactRouteString(string);
  const resolved = (result?.places ?? []).map(resolvedOf);
  const routedRows = resolved.flatMap((place, at) => (place ? [at] : []));
  const changed = (name: string) =>
    !open || !routes || !full || name !== open.name || !samePlan(full, open.plan) || chosenRoute(routes, open.option) !== chosen || compact !== open.routeString;

  const name = open?.name ?? (result ? routeName(result.places) : "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  // Each Save route counts up, so Saved routes opens afresh on the row saved.
  const [saves, setSaves] = useState(0);
  const { onSave } = props;
  const save = onSave && ((as: string) => (string ? onSave(as, compactRouteString(string)) : Promise.resolve()));
  const saveNow = () => {
    setSaveError(null);
    save?.(name).then(
      () => setSaves((n) => n + 1),
      (e: unknown) => setSaveError(errorText(e, "Could not save the route.")),
    );
  };
  const placesSet = plan.places.filter(Boolean).length;
  const dirty = !!routes && !!string && !!full && changed(name);
  // A place where several railroads meet (not the destination): which one takes the car on there.
  const carriers: CarrierChoice[] = plan.places.flatMap((ref, at) => {
    const place = ref?.kind === "node" ? named.get(spotKey(ref)) : undefined;
    return ref?.kind === "node" && place && place.railroads.length > 1 && placeKind(at, plan.places.length) !== "destination"
      ? [{ at, place: shortPlace(place.label), railroads: place.railroads, line: ref.railroad }]
      : [];
  });

  return (
    <div className={`route-panel${planned?.stale ? " is-stale" : ""}`} aria-busy={planned?.stale || undefined}>
      <div className="list-bar">
        <h2 className="list-count">Route</h2>
        <HistoryButtons history={props.history} />
        <Menu
          label="Route actions"
          done={copied}
          items={(close) => (
            <>
              <MenuItem label="Reverse route" disabled={placesSet < 2} onSelect={() => (close(), dispatch({ type: "reverse" }))} />
              {save && <MenuItem label={dirty || !routes ? "Save route" : "Saved"} disabled={!dirty} onSelect={() => (close(), saveNow())} />}
              <MenuItem label="Copy route string" disabled={!string} onSelect={() => (close(), string && void copy(shownRouteString(string)))} />
              <MenuItem label="New route" disabled={empty} onSelect={() => (close(), props.onNew())} />
            </>
          )}
        />
      </div>
      <section className="plan" aria-label="Places">
        <PlaceList
          session={session}
          dispatch={dispatch}
          named={named}
          current={current}
          onAddStop={plan.places.includes(null) ? null : () => dispatch({ type: "insert", at: plan.places.length - 1, ref: null })}
          notice={saveError ?? props.error}
        />
        <RouteOptions plan={plan} carriers={carriers} dispatch={dispatch} />
        <p className="visually-hidden" role="status">
          {hint}
        </p>
      </section>

      {routes && chosen && string && (
        <ResultCard
          route={chosen}
          string={string}
          places={resolved.filter((place) => place !== null)}
          rows={routedRows}
          unit={props.unit}
          saved={open?.routeString || null}
          picked={props.picked}
          onPick={props.onPick}
        />
      )}
      {routes && chosen && routes.length > 1 && <RouteRows routes={routes} chosen={chosen} onSelect={props.onSelect} unit={props.unit} />}

      {props.saved.length > 0 && (
        <SavedList key={saves} saved={props.saved} current={open?.id ?? null} unfolded={empty} justSaved={saves > 0} onRename={save} onRemove={props.onRemoveSaved} />
      )}
    </div>
  );
}
