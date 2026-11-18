/**
 * The route planner's panel: the places in travel order, the routes found, the sections of the chosen
 * one, and saving it. Views take props and return markup; PlaceField also fetches its own suggestions.
 */
import { useId, useState, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { resolvedOf, type PlaceRef, type PlaceSuggestion, type ResolvedPlace } from "../../../shared/places.ts";
import { placeKind, type PlaceKind, type Plan, type PlannedRoute, type SavedRoute, type SavedRouteId } from "../../../shared/plans.ts";
import { RAILROADS, type Railroad, type TrackIncluded } from "../../../shared/railroads.ts";
import type { RoutePath, RouteStrategy } from "../../../shared/route.ts";
import { compactRouteString, routeStringOf, shownRouteString, type RouteString } from "../../../shared/routeString.ts";
import { linkTo } from "../../app/routes.ts";
import { fresh, usePlaceSuggestions } from "../../data/hooks.ts";
import { fmtDistance } from "../../format.ts";
import { chosenRoute } from "../../map/scene.ts";
import { lineColor } from "../../theme.ts";
import { PlacePin, RailroadChips, TurnBadge } from "../../ui/badges.tsx";
import { moveActive, SuggestionList } from "../../ui/combobox.tsx";
import { ConfirmDelete } from "../../ui/ConfirmDelete.tsx";
import { Cross, Crosshair } from "../../ui/icons.tsx";
import { useReorder } from "../../ui/reorder.ts";
import type { DistanceUnit } from "../../units.ts";
import { BACK_OUT, clickToSet, errorText, interchangesWord, lineName, NO_TRACK_NEAR, placeProblem, plural, routeName, shortPlace } from "../../words.ts";
import { fullPlan, isEmpty, nextTarget, samePlan, type PlanAction, type PlanSession } from "./session.ts";

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
  /** `routeString`: the compact route string of the chosen route, saved with it. */
  onSave: (name: string, routeString: string) => Promise<void>;
  onRemoveSaved: (id: SavedRouteId) => Promise<void>;
  onNew: () => void;
  unit: DistanceUnit;
}

/** Shorter railroad stretches are left out of the sections. */
const MIN_SECTION_KM = 0.5;

// ---- small marks ----

const Grip = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 4.5h10M2 7h10M2 9.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

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
 * One place input with autocomplete, a pick-on-map button, a remove button, and the one line under it
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
      <div className="input-box place-box">
        <label htmlFor={id} className="visually-hidden">
          {props.label}
        </label>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={props.problem ? true : undefined}
          aria-describedby={props.problem ? problemId : undefined}
          autoComplete="off"
          enterKeyHint="go"
          placeholder={props.label}
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
        <button type="button" className="icon-btn pick-btn" aria-pressed={props.picking} aria-label={`Pick on the map: ${props.label}`} title="Pick on the map" onClick={props.onTogglePick}>
          <Crosshair />
        </button>
        {props.remove && (
          <button type="button" className="icon-btn" aria-label={`${props.remove} ${props.label}`} title={props.remove} onClick={props.onRemove}>
            <Cross />
          </button>
        )}
      </div>
      {open && <SuggestionList id={listId} label={`Suggestions for ${props.label}`} list={list} active={active} onChoose={(suggestion) => done(suggestion.ref)} />}
      {props.problem && (
        <span id={problemId} className="place-problem">
          {props.problem}
        </span>
      )}
    </div>
  );
}

/** "Next carrier: Router's pick | BNSF | UP": the railroad that takes the car on at a place where several meet. */
function LineChips(props: { label: string; railroads: Railroad[]; line: Railroad | null; onChoose: (railroad: Railroad | null) => void }): ReactElement {
  const choices: (Railroad | null)[] = [null, ...RAILROADS.filter((railroad) => props.railroads.includes(railroad))];
  return (
    <span className="chips line-chips" role="radiogroup" aria-label={`Next carrier at ${props.label}`}>
      <span className="line-chips-label" aria-hidden="true">
        Next carrier
      </span>
      {choices.map((railroad) => (
        <button key={railroad ?? "any"} type="button" role="radio" aria-checked={props.line === railroad} className="chip" onClick={() => props.onChoose(railroad)}>
          {railroad && <span className="rr-swatch" style={{ background: lineColor(railroad) }} aria-hidden="true" />}
          {railroad ?? "Router's pick"}
        </button>
      ))}
    </span>
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
      <div className="group place-group">
        <ol className="place-list" ref={reorder.listRef}>
          {places.map((ref, at) => {
            const kind = placeKind(at, count);
            const name = rowName(at, count);
            const place = ref ? (named.get(spotKey(ref)) ?? null) : null;
            const lines = ref?.kind === "node" && kind !== "destination" && place && place.railroads.length > 1 ? place.railroads : null;
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
                {lines && ref?.kind === "node" && <LineChips label={name} railroads={lines} line={ref.railroad} onChoose={(railroad) => dispatch({ type: "setLine", at, railroad })} />}
              </li>
            );
          })}
        </ol>
        {props.onAddStop && (
          <button type="button" className="add-stop" onClick={props.onAddStop}>
            <span className="add-stop-icon" aria-hidden="true">
              +
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

const SMALLER_TRACK: { key: keyof TrackIncluded; label: string; tip: string }[] = [
  { key: "regional", label: "Regional", tip: "Regional: mid-size railroads" },
  { key: "shortLine", label: "Short lines", tip: "Short line: small local railroads, often the last mile to a plant" },
  { key: "passenger", label: "Passenger", tip: "Passenger: lines owned by Amtrak, VIA or commuter agencies; freight runs on some" },
];

/** Which track the route may use (Class I always, the rest when ticked), and whether it may turn at a stop. */
function RouteOptions(props: { plan: Plan; dispatch: (action: PlanAction) => void }): ReactElement {
  const { include, turnAtStops } = props.plan;
  return (
    <div className="chips" role="group" aria-label="Route options">
      <label className="chip" title={`Class I: the ${RAILROADS.length} big railroads`}>
        <input type="checkbox" checked disabled />
        Class I
      </label>
      {SMALLER_TRACK.map(({ key, label, tip }) => (
        <label key={key} className="chip" title={tip}>
          <input type="checkbox" checked={include[key]} onChange={(event) => props.dispatch({ type: "setInclude", include: { ...include, [key]: event.target.checked } })} />
          {label}
        </label>
      ))}
      <label className="chip" title="Turn at stops: the route may leave a stop in either direction">
        <input type="checkbox" checked={turnAtStops} onChange={(event) => props.dispatch({ type: "setTurnAtStops", turnAtStops: event.target.checked })} />
        Turn at stops
      </label>
    </div>
  );
}

// ---- routes ----

/** One row per route: its length over its railroads, then ⇄ interchanges and ↩ turn-backs. Click to select. */
function RouteRows(props: { routes: RoutePath[]; chosen: RoutePath; onSelect: (id: RouteStrategy) => void; unit: DistanceUnit }): ReactElement {
  return (
    <section className="group route-rows" aria-label="Routes">
      {props.routes.map((route) => {
        const selected = route === props.chosen;
        const turns = route.turnBacks.length;
        return (
          <button key={route.strategies[0]} type="button" className={`route-row${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => props.onSelect(route.strategies[0])}>
            <span className="route-row-text">
              <span className="route-row-km">{fmtDistance(route.km, props.unit)}</span>
              <RailroadChips railroads={route.railroads} />
            </span>
            {route.interchanges > 0 && (
              // A short count; the word is for screen readers and the tooltip.
              <span className="ix-chip" title={interchangesWord(route.interchanges)}>
                <span aria-hidden="true">⇄{route.interchanges}</span>
                <span className="visually-hidden">{interchangesWord(route.interchanges)}</span>
              </span>
            )}
            {turns > 0 && (
              <span title={route.turnBacks.map((t) => t.at.near).join(", ")}>
                <TurnBadge count={turns} />
                <span className="visually-hidden">{plural(turns, "turn-back")}</span>
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}

type SectionRow = { key: string; mark: ReactNode; text: ReactNode; kind: "place" | "leg" | "interchange" | "turn-back" | "back-out" };

/** "· you chose" or "· router's pick". */
function JunctionWord({ junction }: { junction: RouteString["junctions"][number] }): ReactElement {
  return (
    <>
      {" · "}
      <span className={`junction${junction.chosen ? " is-chosen" : ""}`}>{junction.chosen ? "you chose" : "router's pick"}</span>
    </>
  );
}

/**
 * The chosen route read top to bottom: start, each railroad's stretch with its km, railroad changes,
 * stops (and backing out of a shop's own track), turn-backs, destination. `rows` are the place rows the route runs through, so a stop shows its row's number.
 */
function Sections(props: { route: RoutePath; string: RouteString; places: ResolvedPlace[]; rows: number[]; unit: DistanceUnit }): ReactElement {
  const { route, places } = props;
  const junctionAt = new Map(props.string.junctions.map((junction) => [junction.step, junction]));
  const rows: SectionRow[] = [{ key: "start", mark: <PlacePin kind="start" n={0} />, text: shortPlace(places[0]?.label ?? ""), kind: "place" }];
  route.steps.forEach((step, i) => {
    const key = `${step.kind}-${i}`;
    switch (step.kind) {
      case "leg": {
        const leg = route.legs[step.leg];
        if (!leg || leg.km < MIN_SECTION_KM) return;
        rows.push({
          key,
          mark: <span className="section-bar" style={{ background: lineColor(leg.railroad) }} />,
          text: (
            <>
              <span className="strong">{lineName(leg.railroad)}</span> <span className="section-km">{fmtDistance(leg.km, props.unit)}</span>
            </>
          ),
          kind: "leg",
        });
        return;
      }
      case "interchange": {
        const junction = junctionAt.get(i);
        rows.push({
          key,
          mark: <span className="section-ring" />,
          text: (
            <>
              {lineName(step.from)} → {lineName(step.to)} · {shortPlace(step.at)}
              {junction && <JunctionWord junction={junction} />}
            </>
          ),
          kind: "interchange",
        });
        return;
      }
      case "stop":
        rows.push({ key, mark: <PlacePin kind="stop" n={props.rows[step.stop + 1] ?? step.stop + 1} />, text: shortPlace(step.label), kind: "place" });
        return;
      case "turn-back": {
        const turnBack = route.turnBacks[step.turnBack];
        rows.push({ key, mark: <TurnBadge />, text: turnBack ? shortPlace(turnBack.at.near) : "Turn-back", kind: "turn-back" });
        return;
      }
      case "back-out":
        rows.push({ key, mark: <span className="section-ring" />, text: BACK_OUT, kind: "back-out" });
        return;
      case "destination":
        rows.push({ key, mark: <PlacePin kind="destination" n={0} />, text: shortPlace(places.at(-1)?.label ?? ""), kind: "place" });
        return;
    }
  });
  return (
    <ol className="sections" aria-label="Sections">
      {rows.map((row) => (
        <li key={row.key} className={`section section--${row.kind}`}>
          <span className="section-mark">{row.mark}</span>
          <span className="section-text">{row.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** "BNSF – [Kansas City, MO] – UP"; on a saved route, also the string it was saved with when the router now gives another. */
function RouteStringRow(props: { string: RouteString; saved: string | null }): ReactElement {
  const compact = compactRouteString(props.string);
  return (
    <section className="group-title route-string" aria-label="Route string">
      <span className="route-string-text">{shownRouteString(props.string)}</span>
      {props.saved && props.saved !== compact && <span className="caption">Saved as {props.saved}</span>}
    </section>
  );
}

// ---- saving ----

function SaveBar(props: { initial: string; canSave: boolean; changed: (name: string) => boolean; onSave: (name: string) => Promise<void> }): ReactElement {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = typed ?? props.initial;
  const dirty = props.changed(name.trim());
  const save = async () => {
    if (!props.canSave || !name.trim() || !dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSave(name.trim());
    } catch (e) {
      setError(errorText(e, "Could not save the route."));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };
  return (
    <form className="save-bar" aria-label="Save route" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        Route name
      </label>
      <input id={id} value={name} onChange={(e) => setTyped(e.target.value)} />
      <button type="submit" className="btn btn--primary" disabled={!props.canSave || !name.trim() || !dirty || busy}>
        {busy ? "Saving…" : dirty ? "Save" : "Saved"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function SavedList(props: { saved: SavedRoute[]; current: SavedRouteId | null; unfolded: boolean; onRemove: (id: SavedRouteId) => Promise<void> }): ReactElement {
  const [shown, setShown] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState<SavedRouteId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = (id: SavedRouteId) =>
    props.onRemove(id).then(
      () => setConfirming(null),
      (e: unknown) => setError(errorText(e, "Could not delete the route.")),
    );
  return (
    // Open while the plan is empty, folded while one is open, until the person opens or folds it.
    // The summary's click is handled here: the toggle event also fires when React sets `open`.
    <details className="saved-list" open={shown ?? props.unfolded}>
      <summary
        className="group-title"
        onClick={(event) => {
          event.preventDefault();
          setShown(!(shown ?? props.unfolded));
        }}
      >
        Saved routes ({props.saved.length})
      </summary>
      <ul className="group" aria-label="Saved routes">
        {props.saved.map((route) => (
          <li key={route.id} className={route.id === props.current ? "is-current" : undefined}>
            {confirming === route.id ? (
              <ConfirmDelete question="Delete this route?" label={`Delete ${route.name}`} onConfirm={() => void remove(route.id)} onKeep={() => setConfirming(null)} />
            ) : (
              <>
                <a className="saved-name" {...linkTo({ name: "route", saved: route.id, option: null })} aria-current={route.id === props.current ? "page" : undefined}>
                  {route.name}
                </a>
                <button type="button" className="icon-btn" aria-label={`Delete ${route.name}`} onClick={() => setConfirming(route.id)}>
                  <Cross />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

// ---- the panel ----

/** Places and what a click does next · routes · sections · save · saved routes. */
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
  const target = nextTarget(session);
  const word = (at: number) => (placeKind(at, plan.places.length) === "stop" ? "" : "the ") + rowName(at, plan.places.length).toLowerCase();
  const hint =
    props.error ??
    (session.missed
      ? `${NO_TRACK_NEAR}.`
      : session.pick !== null
        ? `${clickToSet(word(session.pick))}.`
        : empty
          ? "Click the start on the map, or type it."
          : target !== null
            ? `${clickToSet(word(target))}.`
            : routes
              ? "Click the map to add a stop."
              : "");

  const full = fullPlan(plan);
  const chosen = routes ? chosenRoute(routes, props.selected) : null;
  const string = chosen && full && routeStringOf(chosen, full.places.slice(1, -1));
  const compact = string && compactRouteString(string);
  const resolved = (result?.places ?? []).map(resolvedOf);
  const routedRows = resolved.flatMap((place, at) => (place ? [at] : []));
  const changed = (name: string) =>
    !open || !routes || !full || name !== open.name || !samePlan(full, open.plan) || chosenRoute(routes, open.option) !== chosen || compact !== open.routeString;

  return (
    <div className={`route-panel${planned?.stale ? " is-stale" : ""}`} aria-busy={planned?.stale || undefined}>
      <section className="plan" aria-label="Places">
        <PlaceList
          session={session}
          dispatch={dispatch}
          named={named}
          current={current}
          onAddStop={plan.places.includes(null) ? null : () => dispatch({ type: "insert", at: plan.places.length - 1, ref: null })}
        />
        {!empty && (
          <div className="plan-actions">
            <button type="button" className="link-btn" onClick={() => dispatch({ type: "reverse" })}>
              Reverse route
            </button>
            <button type="button" className="link-btn" onClick={props.onNew}>
              New
            </button>
          </div>
        )}
        <RouteOptions plan={plan} dispatch={dispatch} />
        <p className="hint-line" role="status">
          {hint}
        </p>
      </section>

      {routes && chosen && string && (
        <>
          <RouteRows routes={routes} chosen={chosen} onSelect={props.onSelect} unit={props.unit} />
          <div>
            <RouteStringRow string={string} saved={open?.routeString || null} />
            <div className="group sections-group">
              <Sections route={chosen} string={string} places={resolved.filter((place) => place !== null)} rows={routedRows} unit={props.unit} />
            </div>
          </div>
          {result && (
            <SaveBar
              key={open?.id ?? "new"}
              initial={open?.name ?? routeName(result.places)}
              canSave={full !== null}
              changed={changed}
              onSave={(name) => props.onSave(name, compactRouteString(string))}
            />
          )}
        </>
      )}

      {props.saved.length > 0 && <SavedList saved={props.saved} current={open?.id ?? null} unfolded={empty} onRemove={props.onRemoveSaved} />}
    </div>
  );
}
