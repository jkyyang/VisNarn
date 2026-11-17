/** The left panel of the Route screen (Main), and its compact form on a phone. Views: props in, markup out (PlaceField aside). */
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { Assumptions } from "../../../shared/assumptions.ts";
import type { CannotCheck, CheckedCar, PlaceResolutions } from "../../../shared/cars.ts";
import type { PlaceRef, PlaceResolution, PlaceRole, PlaceSuggestion, ShopView } from "../../../shared/places.ts";
import type { Railroad } from "../../../shared/railroads.ts";
import type { RouteOption, RouteStep, RouteStrategy } from "../../../shared/route.ts";
import { go, hrefFor, linkTo, linkToHref, type CarKey } from "../../app/routes.ts";
import { usePlace, usePlaceSuggestions } from "../../data/hooks.ts";
import { fmtAge, fmtDay, fmtDayPart, fmtDays, fmtGiven, fmtKmShort, fmtMargin, fmtSub, fmtWhen, fmtWindow, fromLocalInput } from "../../format.ts";
import { AssumptionChips, BasisBadge, RailroadChip, StatusPill } from "../../ui/badges.tsx";
import {
  FIELD_LABELS,
  flagSentence,
  headline,
  INTERCHANGE_ASSUMED,
  mainPill,
  notCounted,
  optionDiff,
  optionName,
  placeHint,
  STRATEGY_LABELS,
  stepWords,
  TURN_BACK_NOT_COUNTED,
  verdictPills,
} from "../../words.ts";
import type { CarDraft, PickTarget, PlaceInput, SessionAction } from "./session.ts";

export interface CarFormProps {
  draft: CarDraft;
  /** What the last check made of each place: the hint under each input, and which input to mark as wrong. */
  places: PlaceResolutions | null;
  shops: ShopView[];
  pick: PickTarget | null;
  dirty: boolean;
  /** Hours between the report and "as of": "Report is 0 days old · position comes from the report, not GPS". */
  positionAgeH: number | null;
  /** On a phone the inputs fold into one summary row with an Edit button. */
  compact: boolean;
  dispatch: (action: SessionAction) => void;
  /** A stop typed while "Add stop" is on: placed as a map click there would be. */
  onTypedStop?: (lon: number, lat: number) => void;
}

const hintOf = (resolution: PlaceResolution | undefined) => (resolution ? placeHint(resolution) : null);
/** The label the server found for a place, for an input whose reference was not typed (a shop id, a node). */
const labelOf = (resolution: PlaceResolution | undefined) => (resolution?.ok ? resolution.place.label : "");
const withLabel = (input: PlaceInput, resolution: PlaceResolution | undefined): PlaceInput =>
  input.shown || input.ref.kind === "text" ? input : { ...input, shown: labelOf(resolution) };

const PinA = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="var(--panel)" stroke="var(--pin-a)" strokeWidth="2.5" />
  </svg>
);
const PinB = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="7" fill="var(--route)" stroke="var(--panel)" strokeWidth="2.5" />
  </svg>
);
const PinShop = () => (
  <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
    <path d="M9 21c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z" fill="var(--shop)" />
    <rect x="6.4" y="6.4" width="5.2" height="5.2" rx="1" fill="#fff" />
  </svg>
);
const PinStop = ({ n }: { n: number }) => (
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

/** `folded`: read out by a screen reader but not shown, so a place that was found costs no height. */
function HintLine(props: { id: string; hint: { ok: boolean; text: string }; folded?: boolean }): ReactElement {
  return (
    <span id={props.id} className={`hint ${props.hint.ok ? "hint--ok" : "hint--bad"}${props.folded ? " visually-hidden" : ""}`}>
      {props.hint.ok ? (
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="6.2" fill="currentColor" />
          <path d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke="var(--panel)" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="1" y="1" width="12" height="12" fill="currentColor" />
          <path d="M4 7h6" stroke="var(--panel)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
      {props.hint.text}
    </span>
  );
}

/**
 * Car id; A (last passed), swap, B (next), shop (from Your shops, with a link to them); "Add stop";
 * reported at / prep ends; the report-age line. Enter or the button checks.
 */
export function CarForm(props: CarFormProps): ReactElement {
  const { draft, places, dispatch, pick } = props;
  const [editing, setEditing] = useState(false);
  const carId = useId();
  const reportedId = useId();
  const prepId = useId();

  if (props.compact && !editing) {
    return (
      <button type="button" className="car-summary" aria-label="Edit car position, shop and times" onClick={() => setEditing(true)}>
        <span className="car-summary-pins" aria-hidden="true">
          <PinA />
          <PinB />
          <PinShop />
        </span>
        <span className="car-summary-lines">
          <span className="mono strong">{draft.carId || "Car"}</span>
          <span>
            {withLabel(draft.a, places?.a).shown || "A not set"} <span className="muted">· A, last passed</span>
          </span>
          <span>
            {withLabel(draft.b, places?.b).shown || "B not set"} <span className="muted">· B, next</span>
          </span>
          <span>
            {withLabel(draft.shop, places?.shop).shown || "Shop not set"} <span className="muted">· shop</span>
          </span>
          <span className="muted small">
            {timesLine(draft)}
          </span>
        </span>
        <span className="car-summary-edit">Edit</span>
      </button>
    );
  }

  const place = (field: "a" | "b" | "shop", label: string, role: PlaceRole) => (
    <PlaceField
      label={label}
      role={role}
      value={withLabel(draft[field], places?.[field])}
      hint={hintOf(places?.[field])}
      picking={pick === field}
      onChange={(value) => dispatch({ type: "editPlace", field, value })}
      onTogglePick={() => dispatch({ type: "pick", target: pick === field ? null : field })}
    />
  );

  const stops = places?.stops ?? [];
  const age = props.positionAgeH;

  return (
    <form
      className="car-form"
      aria-label="Car position and shop"
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ type: "submit" });
        if (props.compact) setEditing(false);
      }}
    >
      <div className="car-id-row">
        <label htmlFor={carId}>Car</label>
        <input id={carId} className="mono" value={draft.carId} onChange={(e) => dispatch({ type: "edit", field: "carId", value: e.target.value })} />
      </div>

      <div className="place-grid">
        <span className="place-pin">
          <PinA />
        </span>
        {place("a", "Car is between · A, last passed", "position")}
        <span className="swap-cell">
          <button type="button" className="icon-btn" aria-label="Swap A and B" title="Swap A and B" onClick={() => dispatch({ type: "swapAB" })}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M6 3v13M6 16l-3-3M6 16l3-3M14 17V4M14 4l-3 3M14 4l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
        <span className="place-pin place-pin--joined">
          <PinB />
        </span>
        {place("b", "B, next node (optional)", "position")}
        {stops.map((stop, index) => (
          <Fragment key={index}>
            <span className="place-pin place-pin--joined">
              <PinStop n={index + 1} />
            </span>
            <div className="stop-row">
              <span className="stop-label">
                Via {stop.ok ? stop.place.label : "a stop"} <span className="muted small">· added by you</span>
              </span>
              <button type="button" className="icon-btn small" aria-label={`Remove stop ${index + 1}`} onClick={() => dispatch({ type: "removeStop", index })}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <span />
          </Fragment>
        ))}
        <span className="place-pin place-pin--joined">
          <PinShop />
        </span>
        <div className="shop-cell">
          {place("shop", "Shop · from Your shops", "shop")}
          <a className="icon-btn small" {...linkTo({ name: "shops", edit: null })} aria-label="Choose from Your shops" title={`Your shops (${props.shops.length})`}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
        <span />
      </div>

      <button
        type="button"
        className="add-stop"
        aria-pressed={pick === "stop"}
        onClick={() => dispatch({ type: "pick", target: pick === "stop" ? null : "stop" })}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 5.5v7M5.5 9h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {pick === "stop" ? "Click the map to add a stop" : "Add stop (pass through a node)"}
      </button>
      {pick === "stop" && props.onTypedStop && <StopField onPlace={props.onTypedStop} onCancel={() => dispatch({ type: "pick", target: null })} />}

      <div className="times-grid">
        <div className="boxed-field">
          <label htmlFor={reportedId}>Reported at</label>
          <input id={reportedId} type="datetime-local" value={draft.reportedAt} aria-invalid={!fromLocalInput(draft.reportedAt) || undefined} onChange={(e) => dispatch({ type: "edit", field: "reportedAt", value: e.target.value })} />
        </div>
        <div className="boxed-field">
          <label htmlFor={prepId}>Prep ends</label>
          <input id={prepId} type="datetime-local" value={draft.prepEnd} aria-invalid={!fromLocalInput(draft.prepEnd) || undefined} onChange={(e) => dispatch({ type: "edit", field: "prepEnd", value: e.target.value })} />
        </div>
      </div>
      {age !== null && (
        <div className={`report-age${age >= 48 ? " report-age--old" : ""}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="7" cy="7" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.6 7.2l1.6 1.6 3.2-3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Report is {fmtAge(age)} · position comes from the report, not GPS
        </div>
      )}
      {/* With nothing changed the button is out of sight, but kept: Enter in a field still checks again. */}
      <div className={`form-actions${props.dirty ? "" : " visually-hidden"}`}>
        <button type="submit" className={`btn${props.dirty ? " btn--primary" : ""}`} tabIndex={props.dirty ? undefined : -1}>
          {props.dirty ? "Check with these changes" : "Check again"}
        </button>
      </div>
    </form>
  );
}

function timesLine(draft: CarDraft): string {
  const reported = fromLocalInput(draft.reportedAt);
  const prep = fromLocalInput(draft.prepEnd);
  return `Reported ${reported ? fmtDayPart(reported) : "–"} · prep ends ${prep ? fmtGiven(prep) : "–"}`;
}

/**
 * One place input with autocomplete, a "pick on map" button and the hint line. Typing gives a text
 * ref; choosing a suggestion or a map pick gives a typed one.
 *
 * A self-contained input widget: it asks the server for suggestions itself (usePlaceSuggestions).
 */
export function PlaceField(props: {
  label: string;
  role: PlaceRole;
  value: PlaceInput;
  hint: { ok: boolean; text: string } | null;
  picking: boolean;
  onChange: (value: PlaceInput) => void;
  onTogglePick: () => void;
  /** Called after onChange when the value came from a suggestion the person chose. */
  onChoose?: (suggestion: PlaceSuggestion) => void;
}): ReactElement {
  const id = useId();
  const listId = useId();
  const hintId = useId();
  const [typing, setTyping] = useState(false);
  const [focused, setFocused] = useState(false);
  // A place that was found shows a check in the box; its hint line only while the box has focus.
  const quiet = !!props.hint?.ok && !focused;
  // -1: nothing highlighted, so Enter checks the car with the text as typed. A suggestion is only
  // taken on Enter after the person moved to it with the arrow keys.
  const [active, setActive] = useState(-1);
  const suggestions = usePlaceSuggestions(typing ? props.value.shown : "", props.role);
  // A stale list belongs to the text before the last keystroke.
  const list: PlaceSuggestion[] = typing && suggestions.status === "ready" && !suggestions.stale ? suggestions.data : [];
  const open = list.length > 0;

  const choose = (suggestion: PlaceSuggestion) => {
    props.onChange({ ref: suggestion.ref, shown: suggestion.label });
    props.onChoose?.(suggestion);
    setTyping(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length));
    } else if (event.key === "Enter" && active >= 0 && active < list.length) {
      event.preventDefault();
      choose(list[active]);
    } else if (event.key === "Escape") {
      setTyping(false);
    }
  };

  return (
    <div className={`place-field${props.picking ? " is-picking" : ""}${props.hint && !props.hint.ok ? " is-wrong" : ""}`}>
      <div className="place-box">
        <label htmlFor={id}>{props.label}</label>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={props.hint && !props.hint.ok ? true : undefined}
          aria-describedby={props.hint ? hintId : undefined}
          autoComplete="off"
          value={props.value.shown}
          onChange={(e) => {
            setTyping(true);
            setActive(-1);
            props.onChange({ ref: { kind: "text", text: e.target.value }, shown: e.target.value });
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setTyping(false);
            setFocused(false);
          }}
        />
        {quiet && (
          <svg className="found-mark" width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="7" cy="7" r="6.2" fill="var(--ok)" />
            <path d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke="var(--panel)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <button type="button" className="icon-btn small pick-btn" aria-pressed={props.picking} aria-label={`Pick on the map: ${props.label}`} title="Pick on the map" onClick={props.onTogglePick}>
          <Crosshair />
        </button>
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
                choose(suggestion);
              }}
            >
              <span>{suggestion.label}</span>
              <span className="muted small">{suggestion.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {props.hint && <HintLine id={hintId} hint={props.hint} folded={quiet} />}
    </div>
  );
}

/**
 * "Add a stop" without the mouse: a node, code or city typed here (or picked from its suggestions)
 * becomes a stop the way a map click on that place would, through the same snapping and "Which line?".
 */
export function StopField(props: { onPlace: (lon: number, lat: number) => void; onCancel: () => void }): ReactElement {
  const [value, setValue] = useState<PlaceInput>({ ref: { kind: "text", text: "" }, shown: "" });
  const [asked, setAsked] = useState<PlaceRef | null>(null);
  const resolved = usePlace(asked, "position");
  const answer = asked && resolved.status === "ready" && !resolved.stale ? resolved.data : null;
  const onPlace = useRef(props.onPlace);
  onPlace.current = props.onPlace;
  useEffect(() => {
    if (!answer?.ok) return;
    setAsked(null);
    onPlace.current(answer.place.lon, answer.place.lat);
  }, [answer]);
  const ask = (ref: PlaceRef) => {
    if (ref.kind !== "text" || ref.text.trim()) setAsked(ref);
  };
  return (
    <div
      className="stop-field"
      onKeyDown={(event) => {
        // Enter here adds the stop; it must not check the car (the field sits inside the car form).
        if (event.key !== "Enter" || event.defaultPrevented || (event.target as HTMLElement).tagName !== "INPUT") return;
        event.preventDefault();
        ask(value.ref);
      }}
    >
      <PlaceField
        label="Or type the stop: a node, code or city"
        role="position"
        value={value}
        hint={answer && !answer.ok ? { ok: false, text: answer.problem.message } : resolved.status === "error" ? { ok: false, text: resolved.error.message } : null}
        picking
        onChange={setValue}
        onChoose={(suggestion) => ask(suggestion.ref)}
        onTogglePick={props.onCancel}
      />
    </div>
  );
}

type Tone = "route" | "at-risk" | "tight" | "on-time";
const toneOf = (option: RouteOption): Tone => (option.verdict.flags.length ? "route" : option.verdict.timing);

/** Headline, basis badge, pills, "If the car is at B now / just passed A / Prep ends / Margin", assumption chips. */
export function VerdictCard(props: { car: CheckedCar; option: RouteOption; onSaveAssumptions: (next: Assumptions) => Promise<unknown> }): ReactElement {
  const { car, option } = props;
  const { verdict } = option;
  const basis = car.assumptions.timing.basis;
  const marginTone = verdict.flags.length && verdict.timing === "on-time" ? "neutral" : verdict.timing;
  return (
    <section className="verdict" aria-label="Verdict">
      <div className="verdict-head">
        <h2 className={`headline headline--${toneOf(option)}`}>{headline(verdict)}</h2>
        <BasisBadge basis={basis} />
      </div>
      <div className="pill-row">
        {verdictPills(verdict).map((pill) => (
          <StatusPill key={pill} pill={pill} size="large" />
        ))}
      </div>
      <dl className="bounds">
        {car.approach.km <= 0 ? (
          // No next node: the car is at A, so the two positions are one.
          <>
            <dt>Arrives, from A</dt>
            <dd className="rough">{fmtWhen(verdict.arrival.ifAtB, basis)}</dd>
          </>
        ) : (
          <>
            <dt>If the car is at B now</dt>
            <dd className="rough">{fmtWhen(verdict.arrival.ifAtB, basis)}</dd>
            <dt>If the car just passed A</dt>
            <dd className="rough">{fmtWhen(verdict.arrival.ifJustPastA, basis)}</dd>
          </>
        )}
        <dt className="strong">Prep ends</dt>
        <dd className="strong">{fmtGiven(car.prepEnd)}</dd>
        <dt className="strong">Margin at the earliest arrival</dt>
        <dd className={`mono margin margin--${marginTone}`}>{fmtMargin(verdict.marginH)}</dd>
      </dl>
      <AssumptionChips assumptions={car.assumptions} onSave={props.onSaveAssumptions} />
    </section>
  );
}

/** What is wrong, in words, with the field at fault; no verdict, no times. */
export function CannotCheckCard(props: { check: CannotCheck }): ReactElement {
  return (
    <section className="verdict verdict--cannot" aria-label="Verdict">
      <div className="verdict-head">
        <h2 className="headline headline--cannot">Cannot check this car</h2>
      </div>
      <div className="pill-row">
        <StatusPill pill="cannot-check" size="large" />
      </div>
      <ul className="problems">
        {props.check.problems.map((problem, i) => (
          <li key={i}>
            <strong>{FIELD_LABELS[problem.field]}:</strong> {problem.message}
          </li>
        ))}
      </ul>
      <p className="muted small">Fix this and check again. No arrival time is shown until the car can be checked.</p>
    </section>
  );
}

function interchangeWords(option: RouteOption): string {
  if (!option.interchanges) return "no interchanges";
  const runs = option.legs.map((leg) => leg.railroad).filter((rr, i, all) => i === 0 || all[i - 1] !== rr);
  return `${option.interchanges} interchange${option.interchanges === 1 ? "" : "s"} (${runs.join(" → ")})`;
}

/** The alert under a route card: the turn-backs with their "Show on map", then any other route problem. */
function RouteAlerts(props: { option: RouteOption; fixHref: (turnBack: number) => string; compact?: boolean }): ReactElement | null {
  const { option } = props;
  const others = option.verdict.flags.filter((flag) => flag.kind !== "turn-back");
  if (!option.turnBacks.length && !others.length) return null;
  const places = option.turnBacks.map((t) => t.at.near);
  return (
    <div className="route-alert" role="note">
      <StatusPillIcon />
      <div className="route-alert-text">
        {option.turnBacks.length > 0 && (
          <span>
            {places.length === 1
              ? `This route turns back ${/^\d/.test(places[0]) ? places[0] : `at ${places[0]}`} (yard track).`
              : `This route turns back ${places.length} times: ${places.join(", ")}.`}{" "}
            Check it before trusting the time.
          </span>
        )}
        {others.map((flag) => (
          <span key={flag.kind}>{flagSentence(flag)}</span>
        ))}
      </div>
      {option.turnBacks.length > 0 && (
        <a className={`chip-link${props.compact ? " chip-link--solid" : ""}`} {...linkToHref(props.fixHref(0))}>
          {props.compact ? "Fix route" : "Show on map"}
        </a>
      )}
    </div>
  );
}

const StatusPillIcon = () => (
  <svg className="shape shape--check-route" width="18" height="18" viewBox="0 0 14 14" aria-hidden="true">
    <rect className="s-fill" x=".5" y=".5" width="13" height="13" rx="3.5" />
    <path className="s-mark" d="M4.5 11V6.3a2.3 2.3 0 0 1 4.6 0v3.4M7.4 8.2l1.7 1.7 1.7-1.7" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * "2 routes · Click a route to compare": one card per option (name, pill, when, km · interchanges,
 * difference from the pick, railroads, tags) with the turn-back alert and its "Show on map" link.
 * `compact` (Phone) shows the selected route in full and the others as one line each.
 */
export function RouteOptions(props: {
  car: CheckedCar;
  selected: RouteStrategy;
  fixHref: (turnBack: number) => string;
  onSelect: (id: RouteStrategy) => void;
  compact?: boolean;
}): ReactElement {
  const { car } = props;
  const pick = car.options[0];
  const basis = car.assumptions.timing.basis;
  const count = car.options.length;
  return (
    <section className="routes" aria-label="Routes">
      <div className="section-head">
        <h3>{count === 1 ? "1 route" : `${count} routes`}</h3>
        {count > 1 && <span className="muted small">Click a route to compare</span>}
      </div>
      {car.options.map((option) => {
        const selected = option.id === props.selected;
        const name = optionName(option, car.options);
        const diff = optionDiff(option, pick);
        if (props.compact && !selected) {
          return (
            <button key={option.id} type="button" className="route-line" aria-pressed={false} onClick={() => props.onSelect(option.id)}>
              <span className="route-line-text">
                <span className="strong">
                  {name} · <span className="mono">{fmtKmShort(option.km)}</span>
                </span>
                <span className="muted small">
                  {diff ?? interchangeWords(option)} · <span className="rough">{fmtWindow(option.verdict.arrival, basis)}</span>
                </span>
              </span>
              <span className="tag">{STRATEGY_LABELS[option.strategies[0]]}</span>
            </button>
          );
        }
        return (
          <div key={option.id} className={`route-card${selected ? " is-selected" : ""}`}>
            <button type="button" className="route-card-main" aria-pressed={selected} onClick={() => props.onSelect(option.id)}>
              <span className="route-card-top">
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="route-glyph">
                  <path d="M3 14c3-8 9-2 12-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="route-name">{name}</span>
                <StatusPill pill={mainPill(option.verdict)} size="small" />
              </span>
              <span className="route-when rough">{fmtWindow(option.verdict.arrival, basis)}</span>
              <span className="route-dist">
                <span className="mono">{fmtKmShort(option.km)}</span> · {interchangeWords(option)}
              </span>
              {diff && <span className="route-diff">{diff}</span>}
              <span className="route-chips">
                {option.railroads.map((railroad) => (
                  <RailroadChip key={railroad} railroad={railroad} />
                ))}
                {option.strategies.map((strategy) => (
                  <span key={strategy} className="tag">
                    {STRATEGY_LABELS[strategy]}
                  </span>
                ))}
              </span>
            </button>
            <RouteAlerts option={option} fixHref={props.fixHref} compact={props.compact} />
          </div>
        );
      })}
    </section>
  );
}

type Rail = "none" | "dot" | Railroad;
type Bullet = "passed" | "next" | "warn" | "change" | "shop" | "note" | "stop" | "none";

interface ChainRow {
  key: string;
  km: string;
  above: Rail;
  below: Rail;
  bullet: Bullet;
  body: ReactNode;
  day: string;
  warn?: boolean;
}

const railStyle = (rail: Rail): string => (rail === "none" ? "rail--none" : rail === "dot" ? "rail--dot" : `rail--rr`);
const railColor = (rail: Rail) => (rail === "none" || rail === "dot" ? undefined : { borderColor: `var(--rr-${rail})` });

function RowText(props: { title: string; sub?: string | null; tone?: "warn" | "note" | "strong"; children?: ReactNode }): ReactElement {
  return (
    <span className="step-text">
      <span className={`step-title${props.tone ? ` step-title--${props.tone}` : ""}`}>{props.title}</span>
      {props.sub && <span className="step-sub">{props.sub}</span>}
      {props.children}
    </span>
  );
}

const kmText = (km: number) => Math.round(km).toLocaleString("en-US");

/**
 * The route read top to bottom: A passed · "car is somewhere here · 63 km" · B · then the option's
 * steps (turn-back, leg with its subdivisions, change of railroad, stop, shop) with km from B and a
 * rough day each, then the rows for time that is not counted. `only` shows a few rows (Fix route).
 */
export function StepsChain(props: {
  car: CheckedCar;
  option: RouteOption;
  only?: { turnBack: number };
  fixHref: (turnBack: number) => string;
  onShowTurnBack: (turnBack: number) => void;
}): ReactElement {
  const { car, option, only } = props;
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const basis = car.assumptions.timing.basis;
  const firstRail: Rail = option.legs.find((leg) => leg.km >= 0.5)?.railroad ?? option.legs[0]?.railroad ?? "none";

  const toggle = (leg: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(leg)) next.delete(leg);
      else next.add(leg);
      return next;
    });

  const rows: ChainRow[] = [];
  // No next node given (or B is A): the car starts at A, so there is no "somewhere between" stretch.
  const startsAtA = car.approach.km <= 0;
  if (!only && !startsAtA) {
    rows.push({
      key: "a",
      km: `−${kmText(car.approach.km)}`,
      above: "none",
      below: "dot",
      bullet: "passed",
      body: <RowText title={car.places.a.place.label} sub="A · last passed" />,
      day: `${fmtDayPart(car.reportedAt)} (report)`,
    });
    rows.push({
      key: "between",
      km: "",
      above: "dot",
      below: "dot",
      bullet: "none",
      body: <RowText title={`Car is somewhere here · ${fmtKmShort(car.approach.km)}${car.approach.onTrack ? "" : " (straight line)"}`} tone="note" />,
      day: "",
    });
  }
  rows.push({
    key: "b",
    km: "0",
    above: "dot",
    below: firstRail,
    bullet: "next",
    body: <RowText title={car.places.b.place.label} sub={startsAtA ? "Start · the car is here (direction not known)" : "B · next node"} />,
    day: fmtDay(car.reportedAt),
  });

  let rail: Rail = firstRail;
  const steps = option.steps;
  const endEta = (i: number) => steps.slice(i + 1).find((s) => s.kind !== "leg" || (option.legs[s.leg]?.km ?? 0) >= 0.5)?.eta ?? option.verdict.arrival;

  steps.forEach((step: RouteStep, i) => {
    const words = stepWords(step, option);
    const key = `${step.kind}-${i}`;
    if (only && !(step.kind === "turn-back" && step.turnBack === only.turnBack)) return;
    switch (step.kind) {
      case "turn-back": {
        rows.push({
          key,
          km: kmText(step.kmFromB),
          above: rail,
          below: rail,
          bullet: "warn",
          warn: true,
          body: (
            <RowText title={words.title} sub={words.sub} tone="warn">
              <span className="step-actions">
                <button type="button" className="chip-link" aria-pressed={only ? true : undefined} onClick={() => props.onShowTurnBack(step.turnBack)}>
                  Show on map
                </button>
                <a className="chip-link chip-link--primary" {...linkToHref(props.fixHref(step.turnBack))} aria-current={only ? "page" : undefined}>
                  Fix route
                </a>
              </span>
            </RowText>
          ),
          day: "",
        });
        if (!only) rows.push({ key: `${key}-nc`, km: "", above: rail, below: rail, bullet: "note", body: <RowText title={TURN_BACK_NOT_COUNTED} tone="note" />, day: "" });
        return;
      }
      case "leg": {
        const leg = option.legs[step.leg];
        if (!leg || leg.km < 0.5) return;
        rail = leg.railroad;
        const isOpen = open.has(step.leg);
        rows.push({
          key,
          km: "",
          above: leg.railroad,
          below: leg.railroad,
          bullet: "none",
          body: (
            <span className="step-text">
              <span className="leg-head">
                <span className="rr-tag" style={{ background: `var(--rr-tag-${leg.railroad}, var(--rr-${leg.railroad}))`, color: `var(--on-rr-${leg.railroad})` }}>
                  {leg.railroad}
                </span>
                <span className="step-title">{words.title}</span>
              </span>
              <span className="step-sub mono">{words.sub}</span>
              {leg.subdivisions.length > 0 && (
                <button type="button" className="subs-toggle" aria-expanded={isOpen} onClick={() => toggle(step.leg)}>
                  {leg.subdivisions.length} {leg.subdivisions.length === 1 ? "subdivision" : "subdivisions"}
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="chev">
                    <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {isOpen && (
                <ol className="subs" aria-label={`Subdivisions on ${leg.railroad}`}>
                  {leg.subdivisions.map((sub, j) => (
                    <li key={`${sub}-${j}`}>
                      <i style={{ background: `var(--rr-${leg.railroad})` }} />
                      {fmtSub(sub)}
                    </li>
                  ))}
                </ol>
              )}
            </span>
          ),
          day: fmtDays(step.eta.ifAtB, endEta(i).ifAtB),
        });
        return;
      }
      case "interchange": {
        rows.push({
          key,
          km: kmText(step.kmFromB),
          above: step.from,
          below: step.to,
          bullet: "change",
          body: (
            <RowText title={words.title}>
              <span className="assumed-chip">
                <span className="mono">+{car.assumptions.timing.interchangeDelayH} h</span> (assumed)
              </span>
            </RowText>
          ),
          day: fmtDay(step.eta.ifAtB),
        });
        rail = step.to;
        rows.push({ key: `${key}-nc`, km: "", above: rail, below: rail, bullet: "note", body: <RowText title={INTERCHANGE_ASSUMED} tone="note" />, day: "" });
        return;
      }
      case "stop":
        rows.push({ key, km: kmText(step.kmFromB), above: rail, below: rail, bullet: "stop", body: <RowText title={words.title} sub={words.sub} />, day: fmtDay(step.eta.ifAtB) });
        return;
      case "shop": {
        const shop = car.places.shop.place;
        rows.push({
          key,
          km: kmText(step.kmFromB),
          above: rail,
          below: "none",
          bullet: "shop",
          body: <RowText title={shop.label} sub={shop.match.method === "shop" ? (shop.example ? "Shop · EXAMPLE, from Your shops" : "Shop · from Your shops") : "Shop"} />,
          day: fmtWindow(option.verdict.arrival, basis),
        });
        return;
      }
    }
  });
  if (!only) for (const line of notCounted(option, car)) rows.push({ key: line, km: "", above: "none", below: "none", bullet: "note", body: <RowText title={line} tone="note" />, day: "" });

  return (
    <ol className={`steps${only ? " steps--only" : ""}`}>
      {rows.map((row) => (
        <li key={row.key} className={`step${row.warn ? " step--warn" : ""}`}>
          <span className="step-km mono">{row.km}</span>
          <span className="step-rail" aria-hidden="true">
            <span className={`rail-top ${railStyle(row.above)}`} style={railColor(row.above)} />
            <span className={`rail-bottom ${railStyle(row.below)}`} style={railColor(row.below)} />
            {row.bullet !== "none" && <span className={`bullet bullet--${row.bullet}`} />}
          </span>
          {row.body}
          {!only && <span className="step-day rough">{row.day}</span>}
        </li>
      ))}
    </ol>
  );
}

/** "Arrival spread (after calibration) · Not available yet": a static preview until the speed is fitted from history. */
export function SpreadPreview(): ReactElement {
  const dots = [1, 2, 0, 3, 3, 4, 3, 2, 1, 1];
  return (
    <section className="spread" aria-label="Preview, not available yet">
      <div className="spread-head">
        <h3>Arrival spread (after calibration)</h3>
        <span className="soon">Not available yet</span>
      </div>
      <p className="muted small">Preview only. Needs arrival history to set the spread; until then the tool shows the rough range above.</p>
      <div className="spread-band" aria-hidden="true">
        <span className="spread-prep" />
        <span className="spread-p p10">P10</span>
        <span className="spread-p p90">P90</span>
      </div>
      <div className="spread-dots" aria-hidden="true">
        {dots.map((n, i) =>
          i === 2 ? (
            <span key={i} className="spread-line" />
          ) : (
            <span key={i} className="spread-stack">
              {Array.from({ length: n }, (_, j) => (
                <span key={j} className={i < 2 ? "dot dot--early" : "dot"} />
              ))}
            </span>
          ),
        )}
      </div>
      <p className="small">
        <strong>3 of 20</strong> likely arrivals come before prep is ready (illustration).
      </p>
    </section>
  );
}

export interface RoutePanelProps extends CarFormProps {
  carKey: CarKey;
  /** Null until the first answer; `stale` while a newer one is on its way (the panel dims, it does not blank). */
  check: { result: CheckedCar | CannotCheck; stale: boolean } | null;
  error: string | null;
  selected: RouteStrategy;
  onSelect: (id: RouteStrategy) => void;
  onSaveAssumptions: (next: Assumptions) => Promise<unknown>;
}

/** Main's left panel: form, verdict (or cannot-check), routes, steps, the spread preview. */
export function RoutePanel(props: RoutePanelProps): ReactElement {
  const { check, carKey } = props;
  const result = check?.result ?? null;
  const checked = result?.outcome === "checked" ? result : null;
  const option = checked ? (checked.options.find((o) => o.id === props.selected) ?? checked.options[0]) : null;
  const fixHref = (turnBack: number) => hrefFor({ name: "fix", car: carKey, at: turnBack });
  const timesMissing = !fromLocalInput(props.draft.reportedAt) || !fromLocalInput(props.draft.prepEnd);

  return (
    <div className={`route-panel${check?.stale ? " is-stale" : ""}`} aria-busy={check?.stale || undefined}>
      <CarForm {...props} />
      <div className="band" />
      {props.error && (
        <p className="error-card" role="alert">
          Couldn't check this car. {props.error}
        </p>
      )}
      {!check && !props.error && (
        <p className="panel-note" role="status">
          {timesMissing ? "Fill in both times to check this car." : "Checking the route…"}
        </p>
      )}
      {result?.outcome === "cannot-check" && <CannotCheckCard check={result} />}
      {checked && option && (
        <>
          <VerdictCard car={checked} option={option} onSaveAssumptions={props.onSaveAssumptions} />
          <RouteOptions car={checked} selected={option.id} fixHref={fixHref} onSelect={props.onSelect} compact={props.compact} />
          <div className="band" />
          <section className="steps-section" aria-label="Steps">
            <div className="section-head">
              <h3>Steps · {optionName(option, checked.options)}</h3>
              <span className="muted small">km from B · rough day</span>
            </div>
            <StepsChain car={checked} option={option} fixHref={fixHref} onShowTurnBack={(turnBack) => go({ name: "fix", car: carKey, at: turnBack })} />
          </section>
          {!props.compact && <SpreadPreview />}
        </>
      )}
    </div>
  );
}
