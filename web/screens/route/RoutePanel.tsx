/**
 * The route planner's panel: the places in travel order, the routes found, the sections of the chosen
 * one, and saving it. One short hint line is the only sentence; everything else is rows, chips and
 * pins. Views: props in, markup out (PlaceField aside).
 */
import { useId, useState, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { PlaceRef, PlaceResolution, PlaceRole, PlaceSuggestion, ResolvedPlace } from "../../../shared/places.ts";
import type { PlanField, PlannedRoute, SavedRoute, SavedRouteId } from "../../../shared/plans.ts";
import { RAILROADS, type Railroad, type TrackIncluded } from "../../../shared/railroads.ts";
import type { RoutePath, RouteStrategy } from "../../../shared/route.ts";
import { linkTo } from "../../app/routes.ts";
import { usePlaceSuggestions } from "../../data/hooks.ts";
import { fmtKmShort } from "../../format.ts";
import { chosenRoute } from "../../map/scene.ts";
import { lineColor } from "../../theme.ts";
import { RailroadChip } from "../../ui/badges.tsx";
import { interchangesWord, lineName, placeProblem, routeName, shortPlace } from "../../words.ts";
import { samePlan, type PlanAction, type PlanSession } from "./session.ts";

export interface RoutePanelProps {
  session: PlanSession;
  dispatch: (action: PlanAction) => void;
  /** Null until the first answer; `stale` while a newer one is on its way (the panel dims, it does not blank). */
  planned: { result: PlannedRoute; stale: boolean } | null;
  error: string | null;
  selected: RouteStrategy | null;
  onSelect: (id: RouteStrategy) => void;
  saved: SavedRoute[];
  /** The saved route this plan is, when it is one. */
  open: SavedRoute | null;
  onSave: (name: string) => Promise<void>;
  onRemoveSaved: (id: SavedRouteId) => Promise<void>;
  onNew: () => void;
}

// ---- small marks ----

const StartPin = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="var(--panel)" stroke="var(--pin-a)" strokeWidth="2.5" />
  </svg>
);
const DestinationPin = () => (
  <svg width="16" height="20" viewBox="0 0 18 22" aria-hidden="true">
    <path d="M9 21c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z" fill="var(--shop)" />
    <circle cx="9" cy="9" r="2.8" fill="#fff" />
  </svg>
);
const StopPin = ({ n }: { n: number }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="7" fill="var(--panel)" stroke="var(--route)" strokeWidth="2.2" />
    <text x="9" y="12.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--route)">
      {n}
    </text>
  </svg>
);
const Crosshair = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const Cross = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const Arrow = ({ up }: { up: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d={up ? "M7 11V3M3.5 6.5L7 3l3.5 3.5" : "M7 3v8M3.5 7.5L7 11l3.5-3.5"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FoundMark = () => (
  <svg className="found-mark" width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r="6.2" fill="var(--ok)" />
    <path d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke="var(--panel)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The one line that says what a click does next, or what went wrong; empty when a field's own line already says it. */
function HintLine(props: { text: string; children?: ReactNode }): ReactElement {
  return (
    <div className="hint-row">
      <p className="hint-line" role="status">
        {props.text}
      </p>
      {props.children}
    </div>
  );
}

// ---- places ----

/** What a reference shows before the server has named it. */
function givenText(ref: PlaceRef): string {
  switch (ref.kind) {
    case "text":
      return ref.text;
    case "code":
      return ref.code;
    case "coord":
      return `${ref.lon}, ${ref.lat}`;
    case "node":
    case "shop":
      return "…";
  }
}

/** The same spot on the ground, for finding a place's label in an answer to an earlier plan. */
const spotKey = (ref: PlaceRef) => (ref.kind === "node" ? `node:${ref.fraId}` : JSON.stringify(ref));

/**
 * One place input with autocomplete, a pick-on-map button, and the one line under it when the place
 * did not resolve. The typed text is its own while focused: Enter takes the highlighted suggestion,
 * else the first one, else the text as typed; leaving the box puts back what is set.
 *
 * A self-contained input widget: it asks the server for suggestions itself (usePlaceSuggestions).
 */
export function PlaceField(props: {
  label: string;
  role: PlaceRole;
  committed: { ref: PlaceRef | null; label: string };
  problem: string | null;
  found: boolean;
  picking: boolean;
  onCommit: (ref: PlaceRef | null) => void;
  onTogglePick: () => void;
}): ReactElement {
  const id = useId();
  const listId = useId();
  const problemId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  // -1: nothing highlighted yet.
  const [active, setActive] = useState(-1);
  const typing = draft !== null;
  const suggestions = usePlaceSuggestions(draft ?? "", props.role);
  // A stale list belongs to the text before the last keystroke.
  const list: PlaceSuggestion[] = typing && suggestions.status === "ready" && !suggestions.stale ? suggestions.data : [];
  const open = list.length > 0;

  const done = (ref: PlaceRef | null) => {
    setDraft(null);
    setActive(-1);
    props.onCommit(ref);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length));
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
    <div className={`place-field${props.picking ? " is-picking" : ""}${props.problem ? " is-wrong" : ""}`}>
      <div className="place-box">
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
        {props.found && !typing && <FoundMark />}
        <button type="button" className="icon-btn small pick-btn" aria-pressed={props.picking} aria-label={`Pick on the map: ${props.label}`} title="Pick on the map" onClick={props.onTogglePick}>
          <Crosshair />
        </button>
        {props.committed.ref && (
          <button type="button" className="icon-btn small" aria-label={`Clear ${props.label}`} title="Clear" onClick={() => done(null)}>
            <Cross />
          </button>
        )}
      </div>
      {open && (
        <ul className="suggestions" role="listbox" id={listId} aria-label={`Suggestions for ${props.label}`}>
          {list.map((suggestion, i) => (
            <li
              key={`${suggestion.source}-${suggestion.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                done(suggestion.ref);
              }}
            >
              <span>{suggestion.label}</span>
              <span className="muted small">{suggestion.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {props.problem && (
        <span id={problemId} className="place-problem">
          {props.problem}
        </span>
      )}
    </div>
  );
}

/** "Any | BNSF | UP": which line the route takes at a stop where several meet. */
function LineChips(props: { stop: number; railroads: Railroad[]; line: Railroad | null; onChoose: (railroad: Railroad | null) => void }): ReactElement {
  const choices: (Railroad | null)[] = [null, ...RAILROADS.filter((railroad) => props.railroads.includes(railroad))];
  return (
    <span className="line-chips" role="radiogroup" aria-label={`Line at stop ${props.stop}`}>
      {choices.map((railroad) => (
        <button key={railroad ?? "any"} type="button" role="radio" aria-checked={props.line === railroad} className="line-chip" onClick={() => props.onChoose(railroad)}>
          {railroad && <span className="rr-swatch" style={{ background: `var(--rr-${railroad})` }} aria-hidden="true" />}
          {railroad ?? "Any"}
        </button>
      ))}
    </span>
  );
}

function StopRow(props: { index: number; count: number; stop: PlaceRef; place: ResolvedPlace | null; problem: string | null; dispatch: (action: PlanAction) => void }): ReactElement {
  const { index, stop, place, dispatch } = props;
  const n = index + 1;
  const label = place?.label ?? givenText(stop);
  const lines = stop.kind === "node" && place && place.railroads.length > 1 ? place.railroads : null;
  return (
    <li className={`stop-row${props.problem ? " is-wrong" : ""}`}>
      <span className="place-pin">
        <StopPin n={n} />
      </span>
      <span className="stop-name">{label}</span>
      {lines && stop.kind === "node" && <LineChips stop={n} railroads={lines} line={stop.railroad} onChoose={(railroad) => dispatch({ type: "setLine", index, railroad })} />}
      <span className="stop-actions">
        <button type="button" className="icon-btn small" aria-label={`Move stop ${n} up`} disabled={index === 0} onClick={() => dispatch({ type: "moveStop", from: index, to: index - 1 })}>
          <Arrow up />
        </button>
        <button type="button" className="icon-btn small" aria-label={`Move stop ${n} down`} disabled={index === props.count - 1} onClick={() => dispatch({ type: "moveStop", from: index, to: index + 1 })}>
          <Arrow up={false} />
        </button>
        <button type="button" className="icon-btn small" aria-label={`Remove stop ${n}`} onClick={() => dispatch({ type: "removeStop", index })}>
          <Cross />
        </button>
      </span>
      {props.problem && <span className="place-problem">{props.problem}</span>}
    </li>
  );
}

// ---- track ----

const SMALLER_TRACK: { key: keyof TrackIncluded; label: string; tip: string }[] = [
  { key: "regional", label: "Regional", tip: "Regional: mid-size railroads" },
  { key: "shortLine", label: "Short lines", tip: "Short line: small local railroads, often the last mile to a plant" },
  { key: "passenger", label: "Passenger / commuter lines", tip: "Passenger: lines owned by Amtrak, VIA or commuter agencies; freight runs on some" },
];

/** Which track the route may use: Class I always, the rest when ticked. */
function TrackChoice(props: { include: TrackIncluded; onChange: (include: TrackIncluded) => void }): ReactElement {
  return (
    <div className="track-choice" role="group" aria-label="Track">
      <label title="Class I: the 6 big railroads">
        <input type="checkbox" checked disabled />
        Class I
      </label>
      {SMALLER_TRACK.map(({ key, label, tip }) => (
        <label key={key} title={tip}>
          <input type="checkbox" checked={props.include[key]} onChange={(event) => props.onChange({ ...props.include, [key]: event.target.checked })} />
          {label}
        </label>
      ))}
    </div>
  );
}

// ---- routes ----

/** One row per route: its railroads, km and interchanges, and ↩ when it turns back. Click to select. */
function RouteRows(props: { routes: RoutePath[]; chosen: RoutePath; onSelect: (id: RouteStrategy) => void }): ReactElement {
  return (
    <section className="route-rows" aria-label="Routes">
      {props.routes.map((route) => {
        const selected = route === props.chosen;
        const turns = route.turnBacks.length;
        return (
          <button key={route.strategies[0]} type="button" className={`route-row${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => props.onSelect(route.strategies[0])}>
            <span className="route-row-rr">
              {route.railroads.map((railroad) => (
                <RailroadChip key={railroad} railroad={railroad} />
              ))}
            </span>
            <span className="route-row-km">
              {fmtKmShort(route.km)}
              {route.interchanges > 0 && ` · ${interchangesWord(route.interchanges)}`}
            </span>
            {turns > 0 && (
              <span className="turn-chip" title={route.turnBacks.map((t) => t.at.near).join(", ")}>
                <span aria-hidden="true">↩{turns > 1 ? turns : ""}</span>
                <span className="visually-hidden">{turns === 1 ? "1 turn-back" : `${turns} turn-backs`}</span>
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}

type SectionRow = { key: string; mark: ReactNode; text: ReactNode; kind: "place" | "leg" | "interchange" | "turn-back" };

/** The chosen route read top to bottom: start, each railroad's stretch with its km, interchanges, stops, turn-backs, destination. */
function Sections(props: { route: RoutePath; start: string; destination: string }): ReactElement {
  const { route } = props;
  const rows: SectionRow[] = [{ key: "start", mark: <StartPin />, text: shortPlace(props.start), kind: "place" }];
  route.steps.forEach((step, i) => {
    const key = `${step.kind}-${i}`;
    switch (step.kind) {
      case "leg": {
        const leg = route.legs[step.leg];
        if (!leg || leg.km < 0.5) return;
        rows.push({
          key,
          mark: <span className="section-bar" style={{ background: lineColor(leg.railroad) }} />,
          text: (
            <>
              <span className="strong">{lineName(leg.railroad)}</span> {fmtKmShort(leg.km)}
            </>
          ),
          kind: "leg",
        });
        return;
      }
      case "interchange":
        rows.push({ key, mark: <span className="section-ring" />, text: `${lineName(step.from)} → ${lineName(step.to)} · ${shortPlace(step.at)}`, kind: "interchange" });
        return;
      case "stop":
        rows.push({ key, mark: <StopPin n={step.stop + 1} />, text: shortPlace(step.label), kind: "place" });
        return;
      case "turn-back": {
        const turnBack = route.turnBacks[step.turnBack];
        rows.push({ key, mark: <span className="section-turn">↩</span>, text: turnBack ? shortPlace(turnBack.at.near) : "Turn-back", kind: "turn-back" });
        return;
      }
      case "shop":
        rows.push({ key, mark: <DestinationPin />, text: shortPlace(props.destination), kind: "place" });
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

// ---- saving ----

function SaveBar(props: { initial: string; canSave: boolean; changed: (name: string) => boolean; onSave: (name: string) => Promise<void> }): ReactElement {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = typed ?? props.initial;
  const dirty = props.changed(name.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!props.canSave || !name.trim() || !dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSave(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the route.");
    } finally {
      setBusy(false);
    }
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
      (e: unknown) => setError(e instanceof Error ? e.message : "Could not delete the route."),
    );
  return (
    // Open while the plan is empty, folded while one is open, until the person opens or folds it.
    // The summary's click is handled here: the toggle event also fires when React sets `open`.
    <details className="saved-list" open={shown ?? props.unfolded}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          setShown(!(shown ?? props.unfolded));
        }}
      >
        Saved routes ({props.saved.length})
      </summary>
      <ul aria-label="Saved routes">
        {props.saved.map((route) => (
          <li key={route.id} className={route.id === props.current ? "is-current" : undefined}>
            {confirming === route.id ? (
              <span className="confirm-inline" role="group" aria-label={`Delete ${route.name}`}>
                <span>Delete?</span>
                <button type="button" className="btn btn--small btn--danger" onClick={() => void remove(route.id)}>
                  Delete
                </button>
                <button type="button" className="btn btn--small" onClick={() => setConfirming(null)} autoFocus>
                  Keep
                </button>
              </span>
            ) : (
              <>
                <a className="saved-name" {...linkTo({ name: "route", saved: route.id, option: null })} aria-current={route.id === props.current ? "page" : undefined}>
                  {route.name}
                </a>
                <button type="button" className="icon-btn small" aria-label={`Delete ${route.name}`} onClick={() => setConfirming(route.id)}>
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

const resolvedOf = (resolution: PlaceResolution | null | undefined): ResolvedPlace | null => (resolution?.ok ? resolution.place : null);

/** Places / hint · routes · sections · save · saved routes. */
export function RoutePanel(props: RoutePanelProps): ReactElement {
  const { session, dispatch, planned, open } = props;
  const plan = session.plan.present;
  const result = planned?.result ?? null;
  // An answer to the plan as it is now: its places line up with the rows by position.
  const current = planned && !planned.stale ? planned.result : null;
  const empty = plan.start === null && plan.destination === null && plan.stops.length === 0;

  // Labels can come from an earlier answer while the next is on its way, matched by the spot, not the row.
  const named = new Map<string, ResolvedPlace>();
  if (result) for (const resolution of [result.places.start, ...result.places.stops, result.places.destination]) {
    const place = resolvedOf(resolution);
    if (place) named.set(spotKey(place.ref), place);
  }
  const placeOf = (ref: PlaceRef | null) => (ref ? (named.get(spotKey(ref)) ?? null) : null);
  const problemAt = (at: PlanField | number, resolution: PlaceResolution | null | undefined): string | null => {
    if (!current) return null;
    const own = placeProblem(resolution ?? null);
    if (own) return own;
    return current.outcome === "no-route" && current.problem.at === at ? current.problem.message : null;
  };

  const end = (field: PlanField, label: string) => {
    const ref = plan[field];
    const place = placeOf(ref);
    return (
      <div className="plan-row">
        <span className="place-pin">{field === "start" ? <StartPin /> : <DestinationPin />}</span>
        <PlaceField
          label={label}
          role="shop"
          committed={{ ref, label: ref ? (place?.label ?? givenText(ref)) : "" }}
          problem={problemAt(field, current?.places[field])}
          found={!!current && !!resolvedOf(current.places[field])}
          picking={session.pick === field}
          onCommit={(next) => dispatch({ type: "setPlace", field, ref: next })}
          onTogglePick={() => dispatch({ type: "pick", field: session.pick === field ? null : field })}
        />
      </div>
    );
  };

  const routes = result?.outcome === "routed" ? result.routes : null;
  const hint =
    props.error ??
    (session.missed
      ? "No track near there."
      : session.pick === "start"
        ? "Click the map to set the start."
        : session.pick === "destination"
          ? "Click the map to set the destination."
          : plan.start === null
            ? "Click the start on the map, or type it."
            : plan.destination === null
              ? "Click the destination."
              : routes
                ? "Click the map to add a stop."
                : "");

  const chosen = routes ? chosenRoute(routes, props.selected) : null;
  const start = resolvedOf(result?.places.start);
  const destination = resolvedOf(result?.places.destination);
  const changed = (name: string) => !open || !routes || name !== open.name || !samePlan(plan, open.plan) || chosenRoute(routes, open.option) !== chosen;

  return (
    <div className={`route-panel${planned?.stale ? " is-stale" : ""}`} aria-busy={planned?.stale || undefined}>
      <section className="plan" aria-label="Places">
        {end("start", "Start")}
        {plan.stops.length > 0 && (
          <ol className="stop-list" aria-label="Stops">
            {plan.stops.map((stop, index) => (
              <StopRow
                key={`${spotKey(stop)}-${index}`}
                index={index}
                count={plan.stops.length}
                stop={stop}
                place={placeOf(stop)}
                problem={problemAt(index, current?.places.stops[index])}
                dispatch={dispatch}
              />
            ))}
          </ol>
        )}
        {end("destination", "Destination")}
        <TrackChoice include={plan.include} onChange={(include) => dispatch({ type: "setInclude", include })} />
        <HintLine text={hint}>
          {!empty && (
            <button type="button" className="link-btn" onClick={props.onNew}>
              New
            </button>
          )}
        </HintLine>
      </section>

      {routes && chosen && (
        <>
          <RouteRows routes={routes} chosen={chosen} onSelect={props.onSelect} />
          <Sections route={chosen} start={start?.label ?? ""} destination={destination?.label ?? ""} />
          {result && (
            <SaveBar
              key={open?.id ?? "new"}
              initial={open?.name ?? routeName(result.places)}
              canSave={plan.start !== null && plan.destination !== null}
              changed={changed}
              onSave={props.onSave}
            />
          )}
        </>
      )}

      {props.saved.length > 0 && <SavedList saved={props.saved} current={open?.id ?? null} unfolded={empty} onRemove={props.onRemoveSaved} />}
    </div>
  );
}
