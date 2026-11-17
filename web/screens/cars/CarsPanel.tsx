/** The Cars screen: its left panel, the upload dialog, and the card over the map. Views only. */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { Assumptions } from "../../../shared/assumptions.ts";
import type { Batch, BatchView, CarCheck, CarField, CarSummary, ImportProfile } from "../../../shared/cars.ts";
import type { TriageGroup } from "../../../shared/route.ts";
import { isTimeZone } from "../../../shared/time.ts";
import { linkToHref } from "../../app/routes.ts";
import { saveImportProfile, uploadBatch, useCodeSets, useImportProfile } from "../../data/hooks.ts";
import { fmtAge, fmtGiven, fmtKmShort, fmtLongDay, fmtMargin, fmtWhen, fromLocalInput, toLocalInput } from "../../format.ts";
import { copyText } from "../../ui/clipboard.ts";
import { readFileText } from "../../ui/files.ts";
import { BasisBadge, RailroadChip, Shape, StatusPill } from "../../ui/badges.tsx";
import { carNote, GROUP_LABELS, headline, pillsOf, reasonLine, verdictPills } from "../../words.ts";
import { GROUP_ORDER, neighbour, type CarGroups, type CarsFilter } from "./list.ts";

export interface CarsPanelProps {
  batches: Batch[];
  view: BatchView;
  groups: CarGroups;
  filter: CarsFilter;
  selected: number | null;
  /** The text "Copy at-risk list" copies, built on click. */
  atRiskText: () => string;
  onFilter: (next: CarsFilter) => void;
  onSelect: (row: number) => void;
  /** Enter on a row, or its link. */
  onOpen: (row: number) => void;
  onFix: (row: number) => void;
  onSwitchBatch: (batch: Batch) => void;
  onUpload: () => void;
  /** Deletes the batch on the server (its rows and route fixes too). */
  onDeleteBatch?: (batch: Batch) => Promise<unknown>;
  /** For the "Rough estimate" badge and the note "C" copies; null until loaded. */
  assumptions?: Assumptions | null;
  /** The route screen's link for a row, so a row opens in a new tab on a modified click. */
  hrefOf?: (row: number) => string;
}

const GROUP_SUB: Partial<Record<TriageGroup, string>> = { "check-first": "route problems come before timing" };

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

/** The margin's colour follows the one pill a row has room for; a flagged on-time car stays grey. */
function marginTone(car: CarSummary): string {
  if (car.check.outcome !== "checked") return "neutral";
  const { verdict } = car.check;
  return verdict.flags.length && verdict.timing === "on-time" ? "neutral" : verdict.timing;
}

/**
 * "Morning list · Tue Nov 17" and the batch name · Upload batch · parse summary ("6 rows read ·
 * 0 need fixing · reports 0 days old", or "checking 120 of 300…") · count chips · shop filter ·
 * Copy at-risk list · the groups (Act now, Check first, OK folded) · key hints.
 * Keys: ↑ ↓ move, Enter open, F fix route, C copy note.
 */
export function CarsPanel(props: CarsPanelProps): ReactElement {
  const { view, groups, filter, selected } = props;
  const { batch, progress } = view;
  const [okOpen, setOkOpen] = useState(false);
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null);
  const [noted, setNoted] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<"ask" | "busy" | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shopId = useId();
  const batchId = useId();

  const issueRows = new Set(batch.issues.map((issue) => issue.row)).size;
  const oldReports = view.cars.filter((car) => car.check.outcome === "checked" && car.check.verdict.flags.some((f) => f.kind === "stale-position")).length;
  const ages = view.cars.flatMap((car) => (car.check.outcome === "checked" ? [car.check.positionAgeH] : []));
  const oldestH = ages.length ? Math.max(...ages) : null;
  const checking = progress.checked < progress.total;
  const pendingCars = view.cars.filter((car) => car.group === null && (filter.shop === null || car.shop === filter.shop));
  // Folded OK rows are not walked by the keys; unfolding them lets the keys reach them.
  const walk: CarGroups = okOpen ? groups : { ...groups, groups: { ...groups.groups, ok: [] } };

  const latest = useRef({ props, walk });
  latest.current = { props, walk };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
      // A dialog over the list (the upload) owns the keys.
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const onPage = target === null || target === document.body;
      // Keys pressed on the tabs, the map or the card over it are theirs, not the list's.
      if (!onPage && !panelRef.current?.contains(target)) return;
      const { props: p, walk: w } = latest.current;
      const key = event.key;
      if (key === "ArrowDown" || key === "ArrowUp") {
        const next = neighbour(w, p.selected, key === "ArrowDown" ? 1 : -1);
        event.preventDefault();
        if (next === null) return;
        p.onSelect(next);
        // Focus moves with the selection at once: Enter, F and C act on the focused row.
        const focus = () => listRef.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus();
        focus();
        requestAnimationFrame(focus);
        return;
      }
      // Enter, F and C act on the row that has focus, or on the selected row when nothing has focus.
      // On the panel's other controls (a button, a link, a summary) they keep their own meaning.
      const rowLink = target?.closest<HTMLElement>("[data-row]") ?? null;
      const row = rowLink && listRef.current?.contains(rowLink) ? Number(rowLink.dataset.row) : onPage ? p.selected : null;
      if (row === null) return;
      if (key === "Enter") {
        event.preventDefault();
        p.onOpen(row);
      } else if (key === "f" || key === "F") {
        event.preventDefault();
        p.onFix(row);
      } else if (key === "c" || key === "C") {
        const car = p.view.cars.find((c) => c.row === row);
        if (!car) return;
        event.preventDefault();
        const note = carNote(car, p.assumptions ?? null);
        void copyText(note).then((ok) => setNoted(ok ? `Copied: ${note}` : "Couldn't copy. Your browser blocked clipboard access."));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!noted) return;
    const timer = setTimeout(() => setNoted(null), 4000);
    return () => clearTimeout(timer);
  }, [noted]);

  const toggleGroup = (group: TriageGroup) =>
    props.onFilter({ ...filter, hide: filter.hide.includes(group) ? filter.hide.filter((g) => g !== group) : [...filter.hide, group] });

  const copyList = async () => {
    const text = props.atRiskText();
    setCopied({ text, ok: await copyText(text) });
  };

  const row = (car: CarSummary) => (
    <li key={car.row}>
      <CarRow car={car} selected={car.row === selected} onSelect={() => props.onSelect(car.row)} href={props.hrefOf?.(car.row) ?? "#"} />
    </li>
  );

  const okRows = groups.groups.ok;
  const showOk = !filter.hide.includes("ok");

  const deleteBatch = async () => {
    if (!props.onDeleteBatch) return;
    setDeleting("busy");
    setDeleteError(null);
    try {
      await props.onDeleteBatch(batch);
    } catch (error) {
      setDeleting("ask");
      setDeleteError(error instanceof Error ? error.message : "Could not delete the batch.");
    }
  };

  return (
    <div className="cars-panel" ref={panelRef}>
      <div className="batch-head">
        <div className="batch-title">
          <h1>Morning list · {fmtLongDay(batch.asOf)}</h1>
          {props.batches.length > 1 ? (
            <div className="batch-switch">
              <label htmlFor={batchId} className="muted small">
                Batch
              </label>
              <select
                id={batchId}
                value={batch.id}
                onChange={(e) => {
                  const next = props.batches.find((b) => b.id === e.target.value);
                  if (next) props.onSwitchBatch(next);
                }}
              >
                {props.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {fmtLongDay(b.asOf)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="muted small">Batch “{batch.name}”</div>
          )}
          {props.onDeleteBatch && deleting === null && (
            <button type="button" className="link-btn link-btn--danger small" onClick={() => setDeleting("ask")}>
              Delete this batch
            </button>
          )}
        </div>
        <button type="button" className="btn btn--outline" onClick={props.onUpload}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 11V3M5 6l3-3 3 3M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Upload batch
        </button>
      </div>

      {deleting !== null && (
        <div className="confirm-row" role="group" aria-label="Delete this batch">
          <span>
            Delete “{batch.name}”? Its {batch.rows} rows and any route fixes go too. This cannot be undone.
          </span>
          <span className="confirm-actions">
            <button type="button" className="btn btn--small" onClick={() => setDeleting(null)} autoFocus>
              Keep it
            </button>
            <button type="button" className="btn btn--small btn--danger" disabled={deleting === "busy"} onClick={deleteBatch}>
              {deleting === "busy" ? "Deleting…" : "Yes, delete"}
            </button>
          </span>
          {deleteError && (
            <p className="error" role="alert">
              {deleteError}
            </p>
          )}
        </div>
      )}

      <div className="parse-summary" role="status">
        <Shape name={issueRows ? "tight" : "on-time"} size={16} />
        <span>
          {checking ? (
            <>
              Checking <span className="mono">{progress.checked}</span> of <span className="mono">{progress.total}</span>…
            </>
          ) : (
            <>
              <span className="mono">{batch.rows}</span> rows read · <span className="mono">{issueRows}</span> need fixing
              {oldestH !== null && <> · reports {oldestH < 24 ? fmtAge(oldestH) : `up to ${fmtAge(oldestH)}`}</>}
              {oldReports > 0 && (
                <>
                  {" "}
                  · <span className="mono">{oldReports}</span> too old to trust
                </>
              )}
            </>
          )}
        </span>
        {props.assumptions && <BasisBadge basis={props.assumptions.timing.basis} />}
      </div>
      {checking && <progress className="check-progress" max={progress.total} value={progress.checked} aria-label="Cars checked so far" />}
      {batch.issues.length > 0 && (
        <details className="issues">
          <summary>What needs fixing ({batch.issues.length})</summary>
          <ul>
            {batch.issues.map((issue, i) => (
              <li key={i}>
                Line <span className="mono">{issue.line}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="count-chips" role="group" aria-label="Filter by group">
        {GROUP_ORDER.map((group) => (
          <button key={group} type="button" className={`count-chip count-chip--${group}`} aria-pressed={!filter.hide.includes(group)} onClick={() => toggleGroup(group)}>
            <Shape name={`group-${group}`} />
            {GROUP_LABELS[group]} <span className="mono">{groups.counts[group]}</span>
          </button>
        ))}
      </div>

      <div className="filter-row">
        <div className="field grow">
          <label htmlFor={shopId}>Shop</label>
          <select id={shopId} value={filter.shop ?? ""} onChange={(e) => props.onFilter({ ...filter, shop: e.target.value || null })}>
            <option value="">All shops ({groups.shops.length})</option>
            {groups.shops.map((shop) => (
              <option key={shop.name} value={shop.name}>
                {shop.name} ({shop.count})
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn--primary" onClick={copyList}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="5" width="8.5" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 3H4a1.5 1.5 0 0 0-1.5 1.5V11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Copy at-risk list
        </button>
      </div>

      <div className="car-list" ref={listRef}>
        {(["act-now", "check-first"] as const).map((group) =>
          filter.hide.includes(group) ? null : (
            <section key={group} className={`car-group car-group--${group}`} aria-label={GROUP_LABELS[group]}>
              <h2 className="group-head">
                <Shape name={`group-${group}`} />
                {GROUP_LABELS[group]} · {groups.groups[group].length}
                {GROUP_SUB[group] && <span className="group-sub">{GROUP_SUB[group]}</span>}
              </h2>
              {groups.groups[group].length ? <ul className="rows">{groups.groups[group].map(row)}</ul> : <p className="muted small empty">None.</p>}
            </section>
          ),
        )}
        {showOk && (
          <section className="car-group car-group--ok" aria-label={GROUP_LABELS.ok}>
            <h2 className="group-head group-head--fold">
              <button type="button" aria-expanded={okOpen} onClick={() => setOkOpen(!okOpen)}>
                <Shape name="group-ok" />
                <span className="nowrap">OK · {okRows.length}</span>
                {!okOpen && okRows.length > 0 && (
                  <span className="group-sub">
                    {okRows
                      .slice(0, 3)
                      .map((car) => `${car.carId} ${car.shop.split(",")[0]} ${car.check.outcome === "checked" ? fmtMargin(car.check.verdict.marginH) : ""}`.trim())
                      .join(" · ")}
                    {okRows.length > 3 ? ` · +${okRows.length - 3} more` : ""}
                  </span>
                )}
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="chev">
                  <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h2>
            {okOpen && <ul className="rows">{okRows.map(row)}</ul>}
          </section>
        )}
        {pendingCars.length > 0 && (
          <section className="car-group car-group--pending" aria-label="Still being checked">
            <h2 className="group-head">Still being checked · {pendingCars.length}</h2>
            <ul className="rows">{pendingCars.map(row)}</ul>
          </section>
        )}
      </div>

      {copied && (
        <div className="copied">
          <div className="copied-head">
            <span>What “Copy at-risk list” put on your clipboard</span>
            <span className={copied.ok ? "copied-ok" : "copied-bad"} role="status">
              {copied.ok ? "Copied" : "Couldn't copy: select the text below"}
            </span>
          </div>
          <pre>{copied.text}</pre>
        </div>
      )}
      {noted && (
        <p className="muted small" role="status">
          {noted}
        </p>
      )}

      <div className="key-hints" aria-label="Keyboard keys">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> open
        </span>
        <span>
          <kbd>F</kbd> fix route
        </span>
        <span>
          <kbd>C</kbd> copy note
        </span>
      </div>
    </div>
  );
}

/** One row: pills, car id, "→ shop", margin, the one-line reason, railroads, "Route set by you". */
export function CarRow(props: { car: CarSummary; selected: boolean; onSelect: () => void; href: string }): ReactElement {
  const { car } = props;
  const pills = pillsOf(car.check);
  return (
    <a
      className={`car-row${props.selected ? " is-selected" : ""}`}
      href={props.href}
      data-row={car.row}
      aria-current={props.selected ? "true" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        props.onSelect();
      }}
    >
      <span className="car-row-top">
        {car.check.outcome === "pending" ? <span className="pill pill--pending">Checking…</span> : pills.map((pill) => <StatusPill key={pill} pill={pill} size="small" />)}
        <span className="car-id mono">{car.carId}</span>
        <span className="car-shop">
          → {car.shop}
          {car.shopExample && <> <span className="example-tag">EXAMPLE</span></>}
        </span>
        {car.fixed && <span className="set-by-you">Route set by you</span>}
      </span>
      <span className={`car-margin mono margin--${marginTone(car)}`}>{car.check.outcome === "checked" ? fmtMargin(car.check.verdict.marginH) : ""}</span>
      <span className="car-reason">{reasonLine(car.check)}</span>
      <span className="car-rr">
        {car.check.outcome === "checked" &&
          car.check.railroads.map((railroad) => (
            <span key={railroad} className="rr-bar-chip">
              <i style={{ background: `var(--rr-${railroad})` }} />
              {railroad}
            </span>
          ))}
      </span>
    </a>
  );
}

/** Over the map: the selected car's verdict in short, with "Open route". */
export function CarCard(props: { car: CarSummary; check: CarCheck | null; href: string }): ReactElement {
  const { car, check } = props;
  const checked = check?.outcome === "checked" ? check : null;
  const pick = checked?.options[0] ?? null;
  const summary = car.check;
  const pills = checked && pick ? verdictPills(pick.verdict) : pillsOf(summary);
  const verdict = pick?.verdict ?? (summary.outcome === "checked" ? summary.verdict : null);
  let message: string;
  if (summary.outcome === "pending") message = "Still being checked.";
  else if (summary.outcome === "cannot-check") message = `Cannot check: ${summary.problems[0].message}`;
  else if (verdict && verdict.timing === "at-risk") message = `Prep may end too late: the car can arrive about ${Math.round(Math.abs(verdict.marginH))} h before prep ends.`;
  else message = verdict ? (verdict.flags.length ? reasonLine(summary) : `${headline(verdict)}.`) : reasonLine(summary);
  const tone = pills[0] ?? "cannot-check";

  return (
    <section className="map-card car-card" aria-label={`Selected car ${car.carId}`}>
      <div className="car-card-body">
        <div className="car-card-head">
          <span className="mono strong">{car.carId}</span>
          {checked && <BasisBadge basis={checked.assumptions.timing.basis} />}
        </div>
        <div className="pill-row">
          {pills.map((pill) => (
            <StatusPill key={pill} pill={pill} />
          ))}
          {verdict && <span className={`mono strong margin--${marginTone(car)}`}>{fmtMargin(verdict.marginH)}</span>}
        </div>
        {check && (
          <div className="car-card-route">
            {labelOf(check.places.a)} → {labelOf(check.places.b)} → shop {labelOf(check.places.shop)}
          </div>
        )}
        {checked && pick && (
          <>
            <dl className="bounds bounds--small">
              <dt>If the car is at B now</dt>
              <dd className="rough">{fmtWhen(pick.verdict.arrival.ifAtB, checked.assumptions.timing.basis)}</dd>
              <dt>If the car just passed A</dt>
              <dd className="rough">{fmtWhen(pick.verdict.arrival.ifJustPastA, checked.assumptions.timing.basis)}</dd>
              <dt>Prep ends</dt>
              <dd>{fmtGiven(checked.prepEnd)}</dd>
            </dl>
            <div className="car-card-line">
              {pick.railroads.map((railroad) => (
                <RailroadChip key={railroad} railroad={railroad} />
              ))}{" "}
              · <span className="mono">{fmtKmShort(pick.km)}</span> · straight line <span className="mono">{fmtKmShort(checked.straightKm)}</span>
              {checked.straightKm > 0 && ` (${(pick.km / checked.straightKm).toFixed(1)}×)`}
            </div>
          </>
        )}
        {!check && summary.outcome !== "pending" && <p className="muted small">Loading the route…</p>}
      </div>
      <div className={`car-card-alert car-card-alert--${tone}`}>
        <Shape name={tone} size={18} />
        <span>{message}</span>
        <a className={`btn btn--small ${tone === "at-risk" ? "btn--danger" : tone === "check-route" ? "btn--check" : "btn--primary"}`} {...linkToHref(props.href)}>
          Open route
        </a>
      </div>
    </section>
  );
}

const labelOf = (resolution: CarCheck["places"]["a"]) => (resolution.ok ? resolution.place.label : "?");

const COLUMN_FIELDS: { field: Exclude<CarField, "stops">; label: string }[] = [
  { field: "carId", label: "Car id" },
  { field: "a", label: "A, last node passed" },
  { field: "b", label: "B, next node" },
  { field: "shop", label: "Shop" },
  { field: "reportedAt", label: "Reported at" },
  { field: "prepEnd", label: "Prep ends" },
];

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Editing the saved import profile: column names, how positions are read, the zone rule. */
function ProfileEditor(props: { profile: ImportProfile; codeTypes: string[]; onSaved: () => void; onCancel: () => void }): ReactElement {
  const [columns, setColumns] = useState(props.profile.columns);
  const [positions, setPositions] = useState(props.profile.positions === "text" ? "" : props.profile.positions.codeType);
  const [reject, setReject] = useState(props.profile.zonelessTimes === "reject");
  const [zone, setZone] = useState(props.profile.zonelessTimes === "reject" ? browserZone() : props.profile.zonelessTimes.zone);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const save = async () => {
    if (!reject && !isTimeZone(zone)) {
      setError(`“${zone}” is not a time zone this browser knows. Try a name like America/Chicago.`);
      return;
    }
    if (COLUMN_FIELDS.some(({ field }) => !columns[field].trim())) {
      setError("Every column needs a name.");
      return;
    }
    try {
      await saveImportProfile({ columns, positions: positions ? { codeType: positions } : "text", zonelessTimes: reject ? "reject" : { zone: zone.trim() } });
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  return (
    <fieldset
      className="profile-editor"
      onKeyDown={(event) => {
        // Enter in a box here saves these settings; left alone it would submit the upload form around them.
        if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
          event.preventDefault();
          void save();
        }
      }}
    >
      <legend>How files are read</legend>
      <div className="profile-grid">
        {COLUMN_FIELDS.map(({ field, label }) => (
          <div key={field} className="field">
            <label htmlFor={`${ids}-${field}`}>{label} column</label>
            <input id={`${ids}-${field}`} className="mono" value={columns[field]} onChange={(e) => setColumns({ ...columns, [field]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor={`${ids}-positions`}>A and B cells are</label>
        <select id={`${ids}-positions`} value={positions} onChange={(e) => setPositions(e.target.value)}>
          <option value="">Free text (city, shop, node, or lon, lat)</option>
          {props.codeTypes.map((codeType) => (
            <option key={codeType} value={codeType}>
              Codes of the set “{codeType}”
            </option>
          ))}
        </select>
      </div>
      <div className="radio-list" role="radiogroup" aria-label="Times without a time zone">
        <label className="check">
          <input type="radio" name={`${ids}-zone`} checked={reject} onChange={() => setReject(true)} />
          Refuse times without a time zone
        </label>
        <label className="check">
          <input type="radio" name={`${ids}-zone`} checked={!reject} onChange={() => setReject(false)} />
          Read them in zone
          <input aria-label="Time zone" className="mono zone-input" value={zone} disabled={reject} onChange={(e) => setZone(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={save}>
          Save how files are read
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Choose a CSV file, name the batch, set its "as of" time. Shows the saved import profile (column
 * names, how positions are read, the zone for times without one) and lets it be changed and saved
 * before the upload. The file is read in the browser and sent to this laptop's server only.
 *
 * A self-contained widget: it reads and saves the profile and uploads the batch itself.
 */
export function UploadBatch(props: { onDone: (batch: Batch) => void; onCancel: () => void }): ReactElement {
  const profile = useImportProfile();
  const codeSets = useCodeSets();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [name, setName] = useState("");
  const [asOf, setAsOf] = useState(() => toLocalInput(new Date()));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A modal dialog: focus starts inside, Tab cycles inside, and goes back to what opened it on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      [...(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? [])];
    focusable().find((el) => el.tagName === "INPUT")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return props.onCancel();
      if (event.key !== "Tab") return;
      const all = focusable();
      if (!all.length) return;
      const inside = !!dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === all[0])) {
        event.preventDefault();
        all[all.length - 1].focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === all[all.length - 1])) {
        event.preventDefault();
        all[0].focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (dialogRef.current && event.target instanceof Node && !dialogRef.current.contains(event.target)) focusable()[0]?.focus();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const choose = async (picked: File | undefined) => {
    setError(null);
    if (!picked) return setFile(null);
    const text = await readFileText(picked);
    setFile({ name: picked.name, text });
    if (!name.trim()) setName(picked.name.replace(/\.csv$/i, ""));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const at = fromLocalInput(asOf);
    if (!file) return setError("Choose a CSV file first.");
    if (!at) return setError("Set the “as of” time.");
    setBusy(true);
    setError(null);
    try {
      const batch = await uploadBatch({ name: name.trim() || file.name, asOf: at, source: { kind: "csv", fileName: file.name, text: file.text } });
      props.onDone(batch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the batch.");
    } finally {
      setBusy(false);
    }
  };

  const p = profile.status === "ready" ? profile.data : null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} ref={dialogRef}>
        <form onSubmit={submit}>
          <h2 id={`${ids}-title`}>Upload batch</h2>
          <div className="field">
            <label htmlFor={`${ids}-file`}>CSV file</label>
            <input id={`${ids}-file`} type="file" accept=".csv,text/csv" onChange={(e) => void choose(e.target.files?.[0])} />
            {file && <span className="muted small">{file.text.split(/\r?\n/).filter(Boolean).length - 1} data rows in {file.name}</span>}
          </div>
          <div className="field">
            <label htmlFor={`${ids}-name`}>Batch name</label>
            <input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="cars-nov17" />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-asof`}>Positions as of</label>
            <input id={`${ids}-asof`} type="datetime-local" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <span className="muted small">Reports older than the limit at this time go to Check first.</span>
          </div>
          {p && !editing && (
            <div className="profile-summary">
              <span>
                Columns <span className="mono">{COLUMN_FIELDS.map(({ field }) => p.columns[field]).join(", ")}</span> · A and B as{" "}
                {p.positions === "text" ? "free text" : `codes of “${p.positions.codeType}”`} · times without a zone{" "}
                {p.zonelessTimes === "reject" ? "are refused" : `are read in ${p.zonelessTimes.zone}`}
              </span>
              <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                Change how files are read
              </button>
            </div>
          )}
          {p && editing && (
            <ProfileEditor profile={p} codeTypes={codeSets.status === "ready" ? codeSets.data.map((set) => set.codeType) : []} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
          )}
          <p className="muted small">The file is read in this browser and sent only to the server on this laptop.</p>
          {editing && <p className="muted small">Save or cancel the changes to how files are read before you upload.</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || !file || editing}>
              {busy ? "Uploading…" : "Upload and check"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
