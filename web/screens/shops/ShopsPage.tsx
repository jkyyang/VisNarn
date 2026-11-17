/** The Shops screen's parts. Views only. */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { ImportReport, ImportRequest, RowIssue } from "../../../shared/cars.ts";
import type { CodeSet, CodeType, NetworkNode, NodeCode, PlaceRef, ShopDraft, ShopView } from "../../../shared/places.ts";
import { usePlace } from "../../data/hooks.ts";
import { fmtLongDay, fmtLonLat } from "../../format.ts";
import { readFileText } from "../../ui/files.ts";
import { placeHint } from "../../words.ts";

const ShopPin = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={Math.round(size * 1.22)} viewBox="0 0 18 22" aria-hidden="true">
    <path d="M9 21c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z" fill="var(--shop)" />
    <rect x="6.5" y="6.5" width="5" height="5" rx="1" fill="#fff" />
  </svg>
);

function locationText(shop: ShopView): string {
  if (shop.place.ok) return fmtLonLat(shop.place.place.lon, shop.place.place.lat);
  return "lon" in shop.location ? fmtLonLat(shop.location.lon, shop.location.lat) : `FRA node ${shop.location.fraId}`;
}

/** Search by name or code · Add shop · the table (Shop, Shop code, Location, On lines, Edit) · the count line. */
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
              <th scope="col">Location</th>
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
                  <td className="mono muted">{locationText(shop)}</td>
                  <td>
                    {shop.place.ok ? (
                      <span className="on-lines">
                        <span className="rr-bars" aria-hidden="true">
                          {shop.place.place.railroads.map((railroad) => (
                            <i key={railroad} style={{ background: `var(--rr-${railroad})` }} title={railroad} />
                          ))}
                        </span>
                        <span className="mono small muted">{shop.place.place.railroads.join(", ")}</span>
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
                <td colSpan={5} className="muted">
                  {props.shops.length ? "No shop matches the search." : "No shops yet. Add one, or import a list."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="muted small table-foot">
        {props.shops.length} {props.shops.length === 1 ? "shop" : "shops"}
        {examples ? ` · ${examples === props.shops.length ? "all are" : `${examples} are`} EXAMPLE rows you can delete` : ""} · “On lines” is found from the node, not typed
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
 * Name · "Node code, or “lon, lat”" with the live hint ("Found on the network · served by BNSF and
 * UP") · location mini-map with "Pick on map" · Cancel / Save shop / Delete.
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // On a phone the form opens below the list, out of sight: bring it into view and start at its first box.
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: "nearest" });
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!props.picked) return;
    setLocText(`${props.picked.near} · FRA node ${props.picked.fraId}`);
    setLocRef({ kind: "node", fraId: props.picked.fraId, railroad: null });
  }, [props.picked]);

  // The server reads the text the way it reads a batch cell: a code, "lon, lat", a city, a node.
  const ref = useMemo<PlaceRef | null>(() => locRef ?? (locText.trim() ? { kind: "text", text: locText.trim() } : null), [locRef, locText]);
  const resolution = usePlace(ref, "shop");
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

  const place = resolved?.ok ? resolved.place : null;
  return (
    <section className="shop-form" aria-label={props.shop ? "Edit shop" : "Add shop"} ref={sectionRef}>
      <h2>{props.shop ? "Edit shop" : "Add shop"}</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input id={`${ids}-name`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Little Rock, AR" />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-code`}>Shop code (optional, how batch rows name it)</label>
          <input id={`${ids}-code`} className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. EX-NLR-01" />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-loc`}>Node code, or “lon, lat”</label>
          <input
            id={`${ids}-loc`}
            className="mono"
            value={locText}
            aria-invalid={hint && !hint.ok ? true : undefined}
            aria-describedby={hint ? `${ids}-hint` : undefined}
            onChange={(e) => {
              setLocText(e.target.value);
              setLocRef(null);
            }}
            placeholder="e.g. -92.27, 34.77"
          />
          {hint && (
            <span id={`${ids}-hint`} className={`hint ${hint.ok ? "hint--ok" : "hint--bad"}`}>
              {hint.text}
            </span>
          )}
        </div>
        <div className="field">
          <span className="label-text">Location</span>
          <span className="shop-location small">
            {place ? (
              <>
                <span className="mono">{fmtLonLat(place.lon, place.lat)}</span> · {place.railroads.join(", ")} · <span className="muted">marked + on the map</span>
              </>
            ) : (
              <span className="muted">Type a location or pick it on the map</span>
            )}
          </span>
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
            <span>Delete this shop? Batch rows that name it will show Cannot check.</span>
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

/** Choose a file, preview it (commit false), then save it (commit true). Shared by both import cards. */
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
 * "Import shop list (CSV)": choose a file, see a preview (rows ready, and rows that match no node,
 * to fix before saving), then save. `run` is called with commit false for the preview, then true.
 */
export function ShopImportCard(props: { run: (request: ImportRequest) => Promise<ImportReport<ShopView>> }): ReactElement {
  const flow = useImport(props.run);
  return (
    <section className="import-card" aria-label="Import shop list">
      <div className="import-row">
        <ImportIcon />
        <div className="grow">
          <h2>Import shop list (CSV)</h2>
          <div className="muted small">
            Company shop data comes later. Columns: <span className="mono">name, node_code</span> or <span className="mono">name, lon, lat</span>. Rows that do not match a node are listed for you to fix before saving.
          </div>
        </div>
        <FileButton label={flow.busy ? "Reading…" : "Choose CSV file"} onFile={flow.choose} disabled={flow.busy} />
      </div>
      {flow.preview && (
        <div className="import-preview" role="region" aria-label="Import preview">
          <p>
            <strong>{flow.preview.report.ready.length}</strong> {flow.preview.report.ready.length === 1 ? "shop is" : "shops are"} ready in {flow.preview.fileName}
            {flow.preview.report.issues.length > 0 && (
              <>
                {" "}
                · <strong>{flow.preview.report.issues.length}</strong> {flow.preview.report.issues.length === 1 ? "row matches" : "rows match"} no node and will not be saved
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

/**
 * The same card for a set of company node codes, which also asks which code set the file is (an
 * existing one to replace, or a new id and label) and lists the sets already loaded.
 * Not on the design canvas: the back end must be able to load node codes, and this is the smallest way in.
 */
export function CodeImportCard(props: {
  codeSets: CodeSet[];
  run: (request: ImportRequest & { codeType: CodeType; label: string }) => Promise<ImportReport<NodeCode>>;
  onRemove: (codeType: CodeType) => Promise<unknown>;
}): ReactElement {
  const [target, setTarget] = useState<string>("");
  const [codeType, setCodeType] = useState("");
  const [label, setLabel] = useState("");
  const ids = useId();
  const existing = props.codeSets.find((set) => set.codeType === target) ?? null;
  const chosenType = existing ? existing.codeType : codeType.trim();
  const chosenLabel = existing ? existing.label : label.trim() || codeType.trim();
  const flow = useImport((request) => props.run({ ...request, codeType: chosenType, label: chosenLabel }));
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <section className="import-card" aria-label="Import node codes">
      <div className="import-row">
        <ImportIcon />
        <div className="grow">
          <h2>Import node codes (CSV)</h2>
          <div className="muted small">
            A code set lets batch rows name places by your company's codes. Columns: <span className="mono">code, name, lon, lat</span> or <span className="mono">code, fra_node</span>. A code is only
            looked up in its own set, never read as an FRA node.
          </div>
        </div>
      </div>
      <div className="code-target">
        <div className="field">
          <label htmlFor={`${ids}-set`}>Code set</label>
          <select id={`${ids}-set`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">A new code set</option>
            {props.codeSets.map((set) => (
              <option key={set.codeType} value={set.codeType}>
                Replace “{set.label}”
              </option>
            ))}
          </select>
        </div>
        {!existing && (
          <>
            <div className="field">
              <label htmlFor={`${ids}-type`}>Set id</label>
              <input id={`${ids}-type`} className="mono" value={codeType} onChange={(e) => setCodeType(e.target.value)} placeholder="splc" />
            </div>
            <div className="field">
              <label htmlFor={`${ids}-label`}>Label</label>
              <input id={`${ids}-label`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="SPLC" />
            </div>
          </>
        )}
        <FileButton label={flow.busy ? "Reading…" : "Choose CSV file"} onFile={flow.choose} disabled={flow.busy || !chosenType} />
      </div>
      {flow.preview && (
        <div className="import-preview" role="region" aria-label="Code import preview">
          <p>
            <strong>{flow.preview.report.ready.length}</strong> codes are ready in {flow.preview.fileName}
            {flow.preview.report.issues.length > 0 && (
              <>
                {" "}
                · <strong>{flow.preview.report.issues.length}</strong> rows match no node and will not be saved
              </>
            )}
          </p>
          <IssueList issues={flow.preview.report.issues} />
          <div className="actions">
            <button type="button" className="btn" onClick={flow.cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!flow.preview.report.ready.length || flow.busy} onClick={flow.commit}>
              Save {flow.preview.report.ready.length} codes as “{chosenLabel}”
            </button>
          </div>
        </div>
      )}
      {flow.saved && (
        <p className="ok-note" role="status">
          Saved {flow.saved.ready.length} codes.
        </p>
      )}
      {flow.error && (
        <p className="error" role="alert">
          {flow.error}
        </p>
      )}
      {props.codeSets.length > 0 && (
        <ul className="code-sets" aria-label="Code sets loaded">
          {props.codeSets.map((set) => (
            <li key={set.codeType}>
              <span>
                <span className="strong">{set.label}</span> <span className="mono muted small">{set.codeType}</span> · {set.count.toLocaleString("en-US")} codes · imported {fmtLongDay(set.importedAt)}
              </span>
              <button
                type="button"
                className="link-btn"
                aria-label={`Remove code set ${set.label}`}
                onClick={() => props.onRemove(set.codeType).catch((e: unknown) => setRemoveError(e instanceof Error ? e.message : "Could not remove."))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removeError && (
        <p className="error" role="alert">
          {removeError}
        </p>
      )}
    </section>
  );
}
