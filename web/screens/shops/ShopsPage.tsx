/** The Shops screen's parts. Views only. */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import type { ImportReport, ImportRequest, NetworkNode, PlaceRef, PlaceResolution, PlaceSuggestion, RowIssue, ShopDraft, ShopView } from "../../../shared/places.ts";
import { usePlace, usePlaceSuggestions } from "../../data/hooks.ts";
import { moveActive } from "../../map/MapSearch.tsx";
import { readFileText } from "../../ui/files.ts";

/** "On the network · BNSF, UP", "Nearest track 12 km away · BNSF", or the problem in words. */
function placeHint(resolution: PlaceResolution): { ok: boolean; text: string } {
  if (!resolution.ok) return { ok: false, text: resolution.problem.message };
  const { place } = resolution;
  const lines = place.railroads.length ? ` · ${place.railroads.join(", ")}` : "";
  if (place.match.confidence === "snapped" && place.match.snapKm >= 1) return { ok: true, text: `Nearest track ${Math.round(place.match.snapKm)} km away${lines}` };
  return { ok: true, text: `On the network${lines}` };
}

const ShopPin = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={Math.round(size * 1.22)} viewBox="0 0 18 22" aria-hidden="true">
    <path d="M9 21c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z" fill="var(--shop)" />
    <rect x="6.5" y="6.5" width="5" height="5" rx="1" fill="#fff" />
  </svg>
);

/** Search by name or code · Add shop · the table (Shop, Shop code, On lines, Edit) · the count line. Where a shop is, the map shows. */
export function ShopTable(props: { shops: ShopView[]; editing: ShopView | "new" | null; onEdit: (shop: ShopView) => void; onAdd: () => void }): ReactElement {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const q = query.trim().toLowerCase();
  const shown = q ? props.shops.filter((shop) => shop.name.toLowerCase().includes(q) || (shop.code ?? "").toLowerCase().includes(q)) : props.shops;
  const examples = props.shops.filter((shop) => shop.example).length;
  const editingId = props.editing && props.editing !== "new" ? props.editing.id : null;

  return (
    <section className="shop-list" aria-label="Shop list">
      <div className="shop-list-bar">
        <label htmlFor={searchId} className="visually-hidden">
          Search shops
        </label>
        <div className="search-box">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input id={searchId} placeholder="Search by name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button type="button" className="btn btn--primary" onClick={props.onAdd} aria-pressed={props.editing === "new"}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          Add shop
        </button>
      </div>
      <div className="table-scroll">
        <table className="shop-table">
          <thead>
            <tr>
              <th scope="col">Shop</th>
              <th scope="col">Shop code</th>
              <th scope="col">On lines</th>
              <th scope="col">
                <span className="visually-hidden">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((shop) => {
              const editing = shop.id === editingId;
              return (
                <tr key={shop.id} className={editing ? "is-editing" : undefined}>
                  <td>
                    <span className="shop-name">
                      <ShopPin />
                      <span className={editing ? "strong" : undefined}>{shop.name}</span>
                      {shop.example && <span className="example-tag">EXAMPLE</span>}
                    </span>
                  </td>
                  <td className="mono">{shop.code ?? "–"}</td>
                  <td>
                    {shop.place.ok ? (
                      // The legend on the map says which colour is which railroad.
                      <span className="rr-bars" title={shop.place.place.railroads.join(", ")}>
                        {shop.place.place.railroads.map((railroad) => (
                          <i key={railroad} style={{ background: `var(--rr-${railroad})` }} aria-hidden="true" />
                        ))}
                        <span className="visually-hidden">{shop.place.place.railroads.join(", ")}</span>
                      </span>
                    ) : (
                      <span className="hint hint--bad">Not on the network</span>
                    )}
                  </td>
                  <td className="right">
                    <button type="button" className="link-btn" aria-label={`Edit ${shop.name}`} aria-pressed={editing} onClick={() => props.onEdit(shop)}>
                      {editing ? "Editing" : "Edit"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={4} className="muted">
                  {props.shops.length ? "No match" : "No shops yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="muted small table-foot">
        {props.shops.length} {props.shops.length === 1 ? "shop" : "shops"}
        {examples ? ` · ${examples} EXAMPLE` : ""}
      </div>
    </section>
  );
}

/** What the location input shows for a saved location. */
function locationInput(shop: ShopView | null): { text: string; ref: PlaceRef | null } {
  if (!shop) return { text: "", ref: null };
  if ("fraId" in shop.location) return { text: `FRA node ${shop.location.fraId}`, ref: { kind: "node", fraId: shop.location.fraId, railroad: shop.location.railroad } };
  return { text: `${shop.location.lon}, ${shop.location.lat}`, ref: { kind: "coord", lon: shop.location.lon, lat: shop.location.lat } };
}

/**
 * Name · Shop code · Location ("lon, lat", a city or an FRA node, or "Pick on map") with the live
 * hint ("On the network · BNSF, UP") · Cancel / Save shop / Delete.
 *
 * A self-contained input widget: it keeps its own draft and asks the server what the typed
 * location means as the person types (usePlace). Save is off until the place is on the network.
 */
export function ShopForm(props: {
  shop: ShopView | null;
  /** A node just picked on the map, to take over as the location. */
  picked: NetworkNode | null;
  picking: boolean;
  onTogglePick: () => void;
  onSave: (draft: ShopDraft) => Promise<unknown>;
  onDelete: (() => Promise<unknown>) | null;
  onCancel: () => void;
}): ReactElement {
  const initial = locationInput(props.shop);
  const [name, setName] = useState(props.shop?.name ?? "");
  const [code, setCode] = useState(props.shop?.code ?? "");
  const [locText, setLocText] = useState(initial.text);
  const [locRef, setLocRef] = useState<PlaceRef | null>(initial.ref);
  // The suggestions are open from a keystroke until one is chosen, Esc, or leaving the box. -1: none highlighted.
  const [suggesting, setSuggesting] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The form opens above the list, which may be scrolled far down: bring it into view and start at its first box.
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: "nearest" });
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!props.picked) return;
    setLocText(`${props.picked.near} · FRA node ${props.picked.fraId}`);
    setLocRef({ kind: "node", fraId: props.picked.fraId, railroad: null });
  }, [props.picked]);

  // The server reads the text the way it reads an import cell: a code, "lon, lat", a city, a node.
  const ref = useMemo<PlaceRef | null>(() => locRef ?? (locText.trim() ? { kind: "text", text: locText.trim() } : null), [locRef, locText]);
  // "position", as the server saves a shop's own location: codes and cities before Your shops.
  const resolution = usePlace(ref, "position");
  const suggestions = usePlaceSuggestions(suggesting ? locText : "", "position");
  // A stale list belongs to the text before the last keystroke.
  const list: PlaceSuggestion[] = suggesting && suggestions.status === "ready" && !suggestions.stale ? suggestions.data : [];
  const listOpen = list.length > 0;
  const closeList = () => {
    setSuggesting(false);
    setActive(-1);
  };
  const choose = (suggestion: PlaceSuggestion) => {
    setLocText(suggestion.label);
    setLocRef(suggestion.ref);
    closeList();
  };
  const onLocKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (listOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive(moveActive(active, event.key, list.length));
    } else if (listOpen && event.key === "Enter") {
      // Enter takes the highlighted suggestion, else the first, instead of saving the form.
      event.preventDefault();
      choose(list[Math.max(active, 0)]);
    } else if (listOpen && event.key === "Escape") {
      closeList();
    }
  };
  const resolved = resolution.status === "ready" && !resolution.stale ? resolution.data : null;
  const hint = resolution.status === "ready" ? placeHint(resolution.data) : resolution.status === "error" ? { ok: false, text: resolution.error.message } : null;
  const canSave = !!name.trim() && !!resolved?.ok && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ref || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSave({ name: name.trim(), code: code.trim() || null, location: ref });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the shop.");
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!props.onDelete) return;
    setBusy(true);
    try {
      await props.onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the shop.");
      setBusy(false);
    }
  };

  return (
    <section className="shop-form" aria-label={props.shop ? "Edit shop" : "Add shop"} ref={sectionRef}>
      <h2>{props.shop ? "Edit shop" : "Add shop"}</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input id={`${ids}-name`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Little Rock, AR" />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-code`}>Shop code (optional)</label>
          <input id={`${ids}-code`} className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. EX-NLR-01" />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-loc`}>Location</label>
          <div className="place-field">
            <input
              id={`${ids}-loc`}
              className="mono"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls={`${ids}-loc-list`}
              aria-autocomplete="list"
              aria-activedescendant={listOpen && active >= 0 ? `${ids}-loc-list-${active}` : undefined}
              autoComplete="off"
              value={locText}
              aria-invalid={hint && !hint.ok ? true : undefined}
              aria-describedby={hint ? `${ids}-hint` : undefined}
              onChange={(e) => {
                setLocText(e.target.value);
                setLocRef(null);
                setSuggesting(true);
                setActive(-1);
              }}
              onKeyDown={onLocKeyDown}
              onBlur={closeList}
              placeholder="e.g. Kansas City, MO or -92.27, 34.77"
            />
            {listOpen && (
              <ul className="suggestions" role="listbox" id={`${ids}-loc-list`} aria-label="Suggestions for Location">
                {list.map((suggestion, i) => (
                  <li
                    key={`${suggestion.source}-${suggestion.label}-${i}`}
                    id={`${ids}-loc-list-${i}`}
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
          </div>
          {hint && (
            <span id={`${ids}-hint`} className={`hint ${hint.ok ? "hint--ok" : "hint--bad"}`}>
              {hint.text}
            </span>
          )}
          <button type="button" className="btn btn--outline" aria-pressed={props.picking} onClick={props.onTogglePick}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {props.picking ? "Click the map…" : "Pick on map"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {/* Its own row, away from where "Delete" was, with "Keep" focused: a double click cannot delete. */}
        {props.onDelete && confirmDelete && (
          <div className="confirm-row" role="group" aria-label="Delete this shop">
            <span>Delete this shop?</span>
            <span className="confirm-actions">
              <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(false)} autoFocus>
                Keep it
              </button>
              <button type="button" className="btn btn--small btn--danger" onClick={remove} disabled={busy}>
                Yes, delete this shop
              </button>
            </span>
          </div>
        )}
        <div className="actions">
          {props.onDelete && !confirmDelete && (
            <button type="button" className="btn btn--quiet-danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSave}>
            {busy ? "Saving…" : "Save shop"}
          </button>
        </div>
      </form>
    </section>
  );
}

function IssueList(props: { issues: RowIssue[] }): ReactElement | null {
  if (!props.issues.length) return null;
  return (
    <ul className="import-issues" aria-label="Rows to fix before saving">
      {props.issues.map((issue, i) => (
        <li key={i}>
          Line <span className="mono">{issue.line}</span>: {issue.message}
        </li>
      ))}
    </ul>
  );
}

type Preview<T> = { fileName: string; text: string; report: ImportReport<T> };

/** Choose a file, preview it (commit false), then save it (commit true). */
function useImport<T>(run: (request: ImportRequest) => Promise<ImportReport<T>>) {
  const [preview, setPreview] = useState<Preview<T> | null>(null);
  const [saved, setSaved] = useState<ImportReport<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    setError(null);
    setSaved(null);
    if (!file) return;
    setBusy(true);
    try {
      const text = await readFileText(file);
      const report = await run({ source: { kind: "csv", fileName: file.name, text }, commit: false });
      setPreview({ fileName: file.name, text, report });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const report = await run({ source: { kind: "csv", fileName: preview.fileName, text: preview.text }, commit: true });
      setSaved(report);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return { preview, saved, error, busy, choose, commit, cancel: () => setPreview(null) };
}

function FileButton(props: { label: string; onFile: (file: File | undefined) => void; disabled?: boolean }): ReactElement {
  const id = useId();
  return (
    <span className="file-button">
      <input
        id={id}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        disabled={props.disabled}
        onChange={(e) => {
          props.onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <label htmlFor={id} className="btn btn--outline">
        {props.label}
      </label>
    </span>
  );
}

const ImportIcon = () => (
  <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" className="import-icon">
    <rect x="6" y="4" width="22" height="28" rx="3" fill="var(--surface)" stroke="var(--muted)" strokeWidth="1.8" />
    <path d="M11 12h12M11 17h12M11 22h8" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="27" cy="27" r="7" fill="var(--route)" />
    <path d="M27 31v-8M24 26l3-3 3 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * "Import shop list (CSV)": choose a file, see a preview (how many rows are ready, and each row that
 * will not be saved, with why), then save. `run` is called with commit false for the preview, then true.
 */
export function ShopImportCard(props: { run: (request: ImportRequest) => Promise<ImportReport<ShopView>> }): ReactElement {
  const flow = useImport(props.run);
  return (
    <section className="import-card" aria-label="Import shop list">
      <div className="import-row">
        <ImportIcon />
        <div className="grow">
          <h2>Import shop list (CSV)</h2>
          <div className="muted small mono">name, lon, lat</div>
        </div>
        <FileButton label={flow.busy ? "Reading…" : "Choose CSV file"} onFile={flow.choose} disabled={flow.busy} />
      </div>
      {flow.preview && (
        <div className="import-preview" role="region" aria-label="Import preview">
          <p>
            {flow.preview.fileName} · <strong>{flow.preview.report.ready.length}</strong> ready
            {flow.preview.report.issues.length > 0 && (
              <>
                {" "}
                · <strong>{flow.preview.report.issues.length}</strong> not saved
              </>
            )}
          </p>
          {flow.preview.report.ready.length > 0 && (
            <ul className="import-ready">
              {flow.preview.report.ready.slice(0, 8).map((shop, i) => (
                <li key={`${shop.name}-${i}`}>
                  {shop.name} {shop.code && <span className="mono muted small">{shop.code}</span>}
                </li>
              ))}
              {flow.preview.report.ready.length > 8 && <li className="muted">and {flow.preview.report.ready.length - 8} more</li>}
            </ul>
          )}
          <IssueList issues={flow.preview.report.issues} />
          <div className="actions">
            <button type="button" className="btn" onClick={flow.cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!flow.preview.report.ready.length || flow.busy} onClick={flow.commit}>
              Save {flow.preview.report.ready.length} {flow.preview.report.ready.length === 1 ? "shop" : "shops"}
            </button>
          </div>
        </div>
      )}
      {flow.saved && (
        <p className="ok-note" role="status">
          Saved {flow.saved.ready.length} {flow.saved.ready.length === 1 ? "shop" : "shops"}.
        </p>
      )}
      {flow.error && (
        <p className="error" role="alert">
          {flow.error}
        </p>
      )}
    </section>
  );
}

/** Over the map while picking a shop's location: "Click the map to set the shop · Esc to cancel", or "No track near there". */
export function PickPrompt(props: { missed: boolean; onCancel: () => void }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone the map sits above the panel and scrolls away with it: bring the map back to be clicked.
  useEffect(() => {
    const prompt = ref.current;
    (prompt?.closest(".map") ?? prompt)?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <div ref={ref} className="map-card pick-prompt" role="status">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>
        {props.missed ? "No track near there · " : "Click the map to set the shop · "}
        <kbd>Esc</kbd> to cancel
      </span>
      <button type="button" className="btn btn--dark" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}
