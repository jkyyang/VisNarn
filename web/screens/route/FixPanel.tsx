/** The Fix route screen: its left panel and the cards it lays over the map. Views only. */
import { useState, type ReactElement } from "react";
import type { CheckedCar } from "../../../shared/cars.ts";
import type { NetworkNode, ResolvedPlace } from "../../../shared/places.ts";
import type { Railroad } from "../../../shared/railroads.ts";
import type { RouteOption, TurnBack } from "../../../shared/route.ts";
import { BackHeader } from "../../app/chrome.tsx";
import { go, hrefFor, linkToHref, type CarKey } from "../../app/routes.ts";
import { fmtKmShort, fmtMargin, fmtWhen } from "../../format.ts";
import { BasisBadge, StatusPill } from "../../ui/badges.tsx";
import { mainPill, notCounted, PILL_LABELS, trackWords, turnBackMove, verdictPills } from "../../words.ts";
import { StepsChain, StopField } from "./RoutePanel.tsx";

export interface FixPanelProps {
  carKey: CarKey;
  carId: string;
  /** The car with the person's stops, and the same car without them. Null while loading. */
  now: CheckedCar | null;
  before: CheckedCar | null;
  /** The turn-back being looked at, if the screen was opened from one. */
  at: number | null;
  /** The stops, resolved, in order. */
  stops: ResolvedPlace[];
  addingStop: boolean;
  /** For a batch row: whether the stops differ from what the row has saved. Null for a typed car (nothing to save to). */
  unsaved: boolean | null;
  batchName: string | null;
  onAddStop: () => void;
  onRemoveStop: (index: number) => void;
  onUseForRow: () => Promise<unknown>;
  /** A stop typed while adding one: placed as a map click there would be. */
  onTypedStop?: (lon: number, lat: number) => void;
  /** Why the check failed, when it did. */
  error?: string | null;
}

const shortLabel = (place: ResolvedPlace | undefined) => place?.label ?? "…";

/** The car's status on one route: every pill it has, the margin on the timing one. */
function StatusCell({ option }: { option: RouteOption }): ReactElement {
  return (
    <span className="pill-row">
      {verdictPills(option.verdict).map((pill) => (
        <StatusPill key={pill} pill={pill} size="small" margin={pill === "check-route" ? undefined : fmtMargin(option.verdict.marginH)} />
      ))}
    </span>
  );
}

/**
 * Back header · the step with the problem · Stops (A, B, each "Via … [railroad] · Added by you" with
 * remove, shop, "Add another stop") · What changed (Before / With your stop: length, interchanges,
 * turn-backs, earliest arrival, status) · "Use for this batch row".
 */
export function FixPanel(props: FixPanelProps): ReactElement {
  const { now, before, carKey } = props;
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const places = now?.places ?? before?.places ?? null;
  const beforePick = before?.options[0] ?? null;
  const nowPick = now?.options[0] ?? null;
  const inspected = props.at ?? (beforePick?.turnBacks.length ? 0 : null);
  const problemCar = before ?? now;
  const hasProblemRow = problemCar !== null && inspected !== null && (problemCar.options[0].turnBacks[inspected] ?? null) !== null;
  const fixHref = (turnBack: number) => hrefFor({ name: "fix", car: carKey, at: turnBack });
  const stopsChanged = props.stops.length > 0;
  const rowNumber = carKey.kind === "row" ? carKey.row + 1 : null;

  const useForRow = async () => {
    setSaving("saving");
    setSaveError(null);
    try {
      await props.onUseForRow();
      setSaving("saved");
    } catch (error) {
      setSaving("failed");
      setSaveError(error instanceof Error ? error.message : "Could not save the stops.");
    }
  };

  return (
    <div className="fix-panel">
      <BackHeader
        back={{ name: "route", car: carKey, option: null }}
        title="Fix route"
        sub={`${props.carId || "Car"} · ${shortLabel(places?.b.place)} → ${shortLabel(places?.shop.place)}`}
      />

      {props.error && (
        <p className="error-card" role="alert">
          Couldn't check this car. {props.error}
        </p>
      )}
      {!problemCar && !props.error && (
        <p className="panel-note" role="status">
          Checking the route…
        </p>
      )}

      {hasProblemRow && problemCar && inspected !== null && (
        <section className="problem-step" aria-label="The step with the problem">
          <StepsChain
            car={problemCar}
            option={problemCar.options[0]}
            only={{ turnBack: inspected }}
            fixHref={fixHref}
            onShowTurnBack={(turnBack) => go({ name: "fix", car: carKey, at: turnBack }, { replace: true })}
          />
        </section>
      )}
      {problemCar && !hasProblemRow && (
        <p className="panel-note">The router's route has no turn-back. Add a stop to make the route pass a node you choose.</p>
      )}

      <section className="stops" aria-label="Stops">
        <h2>Stops</h2>
        <ol className="stop-list">
          <li className="stop-item">
            <span className="stop-pin stop-pin--a" aria-hidden="true" />
            <span className="stop-name">
              {shortLabel(places?.a.place)} <span className="muted small">· A, last passed</span>
            </span>
          </li>
          <li className="stop-item">
            <span className="stop-pin stop-pin--b" aria-hidden="true" />
            <span className="stop-name">
              {shortLabel(places?.b.place)} <span className="muted small">· B, next</span>
            </span>
          </li>
          {props.stops.map((stop, index) => (
            <li key={`${stop.label}-${index}`} className="stop-item stop-item--added">
              <span className="stop-pin stop-pin--stop" aria-hidden="true">
                {index + 1}
              </span>
              <span className="stop-name">
                <span className="strong">
                  Via {stop.label} {stop.railroad && <span className="mono muted small">{stop.railroad}</span>}
                </span>
                <span className="added-by">Added by you</span>
              </span>
              {props.unsaved === false && <span className="set-by-you">Route set by you</span>}
              <button type="button" className="icon-btn small" aria-label={`Remove stop ${index + 1}: ${stop.label}`} onClick={() => props.onRemoveStop(index)}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
          <li className="stop-item">
            <span className="stop-pin stop-pin--shop" aria-hidden="true" />
            <span className="stop-name">
              {shortLabel(places?.shop.place)} <span className="muted small">· shop</span>
            </span>
          </li>
        </ol>
        <button type="button" className="add-stop" aria-pressed={props.addingStop} onClick={props.onAddStop}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M9 5.5v7M5.5 9h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {props.addingStop ? "Click the map to add a stop" : stopsChanged ? "Add another stop" : "Add a stop"}
        </button>
        {props.addingStop && props.onTypedStop && <StopField onPlace={props.onTypedStop} onCancel={props.onAddStop} />}
      </section>

      <section className="what-changed" aria-label="What changed">
        <div className="section-head">
          <h2>What changed</h2>
          {now && <BasisBadge basis={now.assumptions.timing.basis} />}
        </div>
        {beforePick && nowPick && stopsChanged ? (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">Before</th>
                  <th scope="col">With your stop</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Route length</th>
                  <td className="mono was">{fmtKmShort(beforePick.km)}</td>
                  <td className="mono">{fmtKmShort(nowPick.km)}</td>
                </tr>
                <tr>
                  <th scope="row">Interchanges</th>
                  <td className="mono was">{beforePick.interchanges}</td>
                  <td className="mono">{nowPick.interchanges}</td>
                </tr>
                <tr>
                  <th scope="row">Turn-backs</th>
                  <td className="mono was">{beforePick.turnBacks.length}</td>
                  <td className="mono">{nowPick.turnBacks.length}</td>
                </tr>
                <tr>
                  <th scope="row">Earliest arrival</th>
                  <td className="rough">{fmtWhen(beforePick.verdict.arrival.ifAtB, before!.assumptions.timing.basis)}</td>
                  <td className="rough">{fmtWhen(nowPick.verdict.arrival.ifAtB, now!.assumptions.timing.basis)}</td>
                </tr>
                <tr>
                  <th scope="row">Status</th>
                  <td>
                    <StatusCell option={beforePick} />
                  </td>
                  <td>
                    <StatusCell option={nowPick} />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="table-foot">{now ? notCounted(nowPick, now).reverse().join(" · ") : ""}</div>
          </>
        ) : (
          <p className="panel-note">Add a stop where the route should pass, for example a wye instead of the yard. Before and after show here.</p>
        )}
      </section>

      {props.unsaved !== null && (
        <div className="use-for-row">
          <button type="button" className="btn btn--primary btn--wide" disabled={!props.unsaved || saving === "saving"} onClick={useForRow}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 9.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {saving === "saving" ? "Saving…" : props.unsaved ? "Use for this batch row" : "Saved for this batch row"}
          </button>
          {saveError && (
            <p className="error" role="alert">
              {saveError}
            </p>
          )}
          <div className="muted small center" role="status">
            {props.unsaved
              ? `Row ${rowNumber} of “${props.batchName ?? "this batch"}” will show the tag Route set by you. The original route stays in history.`
              : stopsChanged
                ? `Row ${rowNumber} uses these stops. The original route stays in history.`
                : `Row ${rowNumber} uses the router's own route.`}
          </div>
        </div>
      )}
    </div>
  );
}

/** Over the map: how the car arrives and leaves at one turn-back (subdivisions, headings, angle, track), and what to do about it. */
export function JunctionInspector(props: { turnBack: TurnBack; backHref: string }): ReactElement {
  const { turnBack } = props;
  const move = turnBackMove(turnBack);
  return (
    <section className="map-card junction" aria-label="Junction inspector">
      <div className="card-head">
        <h2>Junction inspector</h2>
        <span className="muted small">{turnBack.at.near} · yard</span>
      </div>
      <dl className="junction-facts">
        <dt>Arrives</dt>
        <dd>{move.arrives}</dd>
        <dt>Leaves</dt>
        <dd>{move.leaves}</dd>
        <dt>Turn</dt>
        <dd className="mono turn">{Math.round(turnBack.turnDeg)}°</dd>
        <dt>Track</dt>
        <dd>{trackWords(turnBack.track)}</dd>
        <dt>Railroad</dt>
        <dd>{turnBack.railroad}</dd>
      </dl>
      <p className="muted small">The router reversed the car on a yard track, which a real move is unlikely to do. Add a stop at the wye to route around it.</p>
      <a className="chip-link" {...linkToHref(props.backHref)}>
        Back to whole route
      </a>
    </section>
  );
}

/** Over the map after a stop is added: "−120 km · same interchanges · now: Tight (rough)" with Keep and Undo. */
export function DeltaBalloon(props: { before: RouteOption; now: RouteOption; onKeep: () => void; onUndo: () => void }): ReactElement {
  // Rounded like the table beside it, so the two never disagree by a kilometre.
  const km = Math.round(props.now.km) - Math.round(props.before.km);
  const changes = props.now.interchanges - props.before.interchanges;
  const pill = mainPill(props.now.verdict);
  return (
    <div className="map-card delta" role="status">
      <span className="delta-text">
        <span className="strong">
          <span className={`mono ${km <= 0 ? "delta-good" : "delta-bad"}`}>{km === 0 ? "same length" : `${km < 0 ? "−" : "+"}${Math.abs(km).toLocaleString("en-US")} km`}</span>
          {" · "}
          {changes === 0 ? "same interchanges" : `${Math.abs(changes)} ${changes > 0 ? "more" : "fewer"} interchange${Math.abs(changes) === 1 ? "" : "s"}`}
          {" · now: "}
          <span className={`pill-color--${pill}`}>{PILL_LABELS[pill]}</span> <span className="rough">(rough)</span>
        </span>
        <span className="muted small">Grey dashed line = the old route</span>
      </span>
      <button type="button" className="btn btn--primary" onClick={props.onKeep}>
        Keep
      </button>
      <button type="button" className="btn" onClick={props.onUndo}>
        Undo
      </button>
    </div>
  );
}

const PICK_WORDS: Record<"a" | "b" | "shop" | "stop", string> = { a: "set A", b: "set B", shop: "set the shop", stop: "add a stop" };

/** Over the map while picking: "Click the map to add a stop · Esc to cancel", or "No track near that spot." */
export function PickPrompt(props: { target: "a" | "b" | "shop" | "stop"; missed: boolean; onCancel: () => void }): ReactElement {
  return (
    <div className="map-card pick-prompt" role="status">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>
        {props.missed ? "No track near that spot. Zoom in and click closer to a line · " : `Click the map to ${PICK_WORDS[props.target]} · `}
        <kbd>Esc</kbd> to cancel
      </span>
      <button type="button" className="btn btn--dark" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** "Which line? Two railroads meet here." */
export function WhichLine(props: { node: NetworkNode; onChoose: (railroad: Railroad) => void }): ReactElement {
  const { node } = props;
  const count = node.railroads.length;
  return (
    <section className="map-card which-line" aria-label="Which line?">
      <div className="snap-note">
        Snaps to <strong>{node.near}</strong> · {node.railroads.join(" / ")} · {node.km.toFixed(1)} km
      </div>
      <div className="strong small">Which line? {count === 2 ? "Two" : count} railroads meet here.</div>
      <div className="line-choices" role="radiogroup" aria-label="Which line">
        {node.railroads.map((railroad) => (
          <button key={railroad} type="button" role="radio" aria-checked={false} className="line-choice" onClick={() => props.onChoose(railroad)}>
            <span className="rr-swatch rr-swatch--line" style={{ background: `var(--rr-${railroad})` }} aria-hidden="true" />
            {railroad}
          </button>
        ))}
      </div>
    </section>
  );
}
