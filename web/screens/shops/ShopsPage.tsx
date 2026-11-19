/** The Shops screen's parts. Views only. */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import type { LngLat } from "../../../shared/geo.ts";
import {
  SHOP_LINKS_MAX, type FraId, type ImportReport, type ImportRequest, type PlaceRef, type PlaceSuggestion, type ResolvedPlace, type RowIssue, type ShopDraft, type ShopLink,
  type ShopView,
} from "../../../shared/places.ts";
import { fresh, usePlace, usePlaceSuggestions } from "../../data/hooks.ts";
import { fmtDistance } from "../../format.ts";
import { PlacePin, RailroadChips } from "../../ui/badges.tsx";
import { ConfirmDelete } from "../../ui/ConfirmDelete.tsx";
import { readFileText } from "../../ui/files.ts";
import { moveActive, SuggestionList } from "../../ui/combobox.tsx";
import { Cross, Search } from "../../ui/icons.tsx";
import { lineColor } from "../../theme.ts";
import { PHONE_QUERY } from "../../map/config.ts";
import type { DistanceUnit } from "../../units.ts";
import { clickToSet, errorText, linkText, placeHint, plural } from "../../words.ts";

/** Rows of an import preview listed by name; the rest are counted. */
const PREVIEW_ROWS = 8;

const ShopPin = () => (
  <svg width="14" height="17" viewBox="0 0 18 22" aria-hidden="true">
    <path d="M9 21c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z" fill="var(--shop)" />
    <rect x="6.5" y="6.5" width="5" height="5" rx="1" fill="var(--panel)" />
  </svg>
);

/** Search by name or code · Add shop · the table (Shop with its code, On lines, Edit) · the count line. Where a shop is, the map shows. */
export function ShopTable(props: { shops: ShopView[]; editing: ShopView | "new" | null; onEdit: (shop: ShopView) => void; onAdd: () => void }): ReactElement {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const q = query.trim().toLowerCase();
  const shown = q ? props.shops.filter((shop) => shop.name.toLowerCase().includes(q) || (shop.code ?? "").toLowerCase().includes(q)) : props.shops;
  const editingId = props.editing && props.editing !== "new" ? props.editing.id : null;

  return (
    <section aria-label="Shop list">
      <div className="shop-list-bar">
        <label htmlFor={searchId} className="visually-hidden">
          Search shops
        </label>
        <div className="input-box search-box">
          <Search />
          <input id={searchId} placeholder="Search by name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button type="button" className="btn btn--primary" onClick={props.onAdd} aria-pressed={props.editing === "new"}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          Add shop
        </button>
      </div>
      <div className="group table-scroll">
        <table className="shop-table">
          <thead className="visually-hidden">
            <tr>
              <th scope="col">Shop</th>
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
                    <span className={`shop-name${editing ? " strong" : ""}`}>
                      <ShopPin />
                      {shop.name}
                    </span>
                    {shop.code && <span className="shop-sub">{shop.code}</span>}
                  </td>
                  <td>
                    {shop.place.ok ? (
                      // The legend on the map says which colour is which railroad.
                      <span className="rr-bars" title={shop.place.place.railroads.join(", ")}>
                        {shop.place.place.railroads.map((railroad) => (
                          <i key={railroad} style={{ background: lineColor(railroad) }} aria-hidden="true" />
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
                <td colSpan={3} className="muted">
                  {props.shops.length ? "No match" : "No shops yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="table-foot">{plural(props.shops.length, "shop")}</p>
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
 * Name · Shop code · Location ("lon, lat", a city or an FRA node, or where the pin is put on the map) with
 * the live hint ("On the network · BNSF, UP") · the track links (`children`) · Cancel / Save shop / Delete.
 *
 * A self-contained input widget: it keeps its own draft and asks the server what the typed
 * location means as the person types (usePlace), and says where that is (`onPlace`). Save is off
 * until the place is on the network.
 */
export function ShopForm(props: {
  shop: ShopView | null;
  unit: DistanceUnit;
  /** A spot just picked on the map, to take over as the location. */
  picked: LngLat | null;
  /** The shop joins the network at its links: they name their railroads, so the location's hint does not. */
  linked: boolean;
  /** Where the location resolves, each time it does. */
  onPlace: (place: ResolvedPlace | null) => void;
  onSave: (draft: Omit<ShopDraft, "links">) => Promise<unknown>;
  onDelete: (() => Promise<unknown>) | null;
  onCancel: () => void;
  children?: ReactNode;
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
  // On a phone the card can be taller than the screen, where "nearest" stops short and cuts the heading off.
  useEffect(() => {
    const phone = window.matchMedia?.(PHONE_QUERY).matches ?? false;
    sectionRef.current?.scrollIntoView?.({ block: phone ? "start" : "nearest" });
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!props.picked) return;
    const [lon, lat] = props.picked;
    setLocText(`${lon}, ${lat}`);
    setLocRef({ kind: "coord", lon, lat });
  }, [props.picked]);

  // The server reads the text as "lon, lat", a city or "FRA 358070".
  const ref = useMemo<PlaceRef | null>(() => locRef ?? (locText.trim() ? { kind: "text", text: locText.trim() } : null), [locRef, locText]);
  // "position", as the server saves a shop's own location: cities before Your shops.
  const resolution = usePlace(ref, "position");
  const suggestions = usePlaceSuggestions(suggesting ? locText : "", "position");
  // A stale list belongs to the text before the last keystroke.
  const list: PlaceSuggestion[] = (suggesting && fresh(suggestions)) || [];
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
  const resolved = fresh(resolution);
  useEffect(() => {
    if (resolved) props.onPlace(resolved.ok ? resolved.place : null);
  }, [resolved]);
  const hint = resolution.status === "ready" ? placeHint(resolution.data, props.unit, !props.linked) : resolution.status === "error" ? { ok: false, text: resolution.error.message } : null;
  const canSave = !!name.trim() && !!resolved?.ok && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ref || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSave({ name: name.trim(), code: code.trim() || null, location: ref });
    } catch (e) {
      setError(errorText(e, "Could not save the shop."));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!props.onDelete) return;
    setBusy(true);
    try {
      await props.onDelete();
    } catch (e) {
      setError(errorText(e, "Could not delete the shop."));
      setBusy(false);
    }
  };

  return (
    <section className="group shop-form" aria-label={props.shop ? "Edit shop" : "Add shop"} ref={sectionRef}>
      <h2>{props.shop ? "Edit shop" : "Add shop"}</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input id={`${ids}-name`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Little Rock, AR" />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-code`}>Shop code (optional)</label>
          <input id={`${ids}-code`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NLR-01" />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-loc`}>Location</label>
          <div className="place-field">
            <input
              id={`${ids}-loc`}
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
              placeholder="e.g. Kansas City, MO, or click the map"
            />
            {listOpen && <SuggestionList id={`${ids}-loc-list`} label="Suggestions for Location" list={list} active={active} onChoose={choose} />}
          </div>
          {hint && (
            <span id={`${ids}-hint`} className={`hint ${hint.ok ? "hint--ok" : "hint--bad"}`}>
              {hint.text}
            </span>
          )}
        </div>
        {props.children}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {props.onDelete && confirmDelete && <ConfirmDelete question="Delete this shop?" busy={busy} onConfirm={remove} onKeep={() => setConfirmDelete(false)} />}
        <div className="actions">
          {props.onDelete && !confirmDelete && (
            <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
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
          Line {issue.line}: {issue.message}
        </li>
      ))}
    </ul>
  );
}

type Preview = { fileName: string; text: string; report: ImportReport<ShopView> };

/** Choose a file, preview it (commit false), then save it (commit true). */
function useImport(run: (request: ImportRequest) => Promise<ImportReport<ShopView>>) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<ImportReport<ShopView> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    setError(null);
    setSaved(null);
    if (!file) return;
    // Drop the last file's preview first: if this file fails, Save must not write the old one.
    setPreview(null);
    setBusy(true);
    try {
      const text = await readFileText(file);
      const report = await run({ source: { kind: "csv", fileName: file.name, text }, commit: false });
      setPreview({ fileName: file.name, text, report });
    } catch (e) {
      setError(errorText(e, "Could not read the file."));
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
      setError(errorText(e, "Could not save."));
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
      <label htmlFor={id} className="btn">
        {props.label}
      </label>
    </span>
  );
}

/**
 * "Import shop list": choose a file, see a preview (how many rows are ready, and each row that
 * will not be saved, with why), then save. `run` is called with commit false for the preview, then true.
 */
export function ShopImportCard(props: { run: (request: ImportRequest) => Promise<ImportReport<ShopView>> }): ReactElement {
  const flow = useImport(props.run);
  return (
    <section className="group import-card" aria-label="Import shop list">
      <div className="import-row">
        <div className="grow">
          <h2>Import shop list</h2>
          <div className="muted small">name, lon, lat</div>
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
              {flow.preview.report.ready.slice(0, PREVIEW_ROWS).map((shop, i) => (
                <li key={`${shop.name}-${i}`}>
                  {shop.name} {shop.code && <span className="muted small">{shop.code}</span>}
                </li>
              ))}
              {flow.preview.report.ready.length > PREVIEW_ROWS && <li className="muted">and {flow.preview.report.ready.length - PREVIEW_ROWS} more</li>}
            </ul>
          )}
          <IssueList issues={flow.preview.report.issues} />
          <div className="actions">
            <button type="button" className="btn" onClick={flow.cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!flow.preview.report.ready.length || flow.busy} onClick={flow.commit}>
              Save {plural(flow.preview.report.ready.length, "shop")}
            </button>
          </div>
        </div>
      )}
      {flow.saved && (
        <p className="ok-note" role="status">
          Saved {plural(flow.saved.ready.length, "shop")}.
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
 * Track links, numbered as their rings on the map: a row per link (its ring, the node it joins, how far along its own
 * track, the railroads there, ×), the suggestion offered to a shop with none (Use), else ＋ for the next link. Pressing a
 * ring (or ＋) makes the next tap on the map set that link, and a line says so; Delete on a ring removes it.
 */
export function ShopLinks(props: {
  /** Each link: what the server says of it, or only its node until it has. */
  links: (ShopLink | FraId)[];
  /** The suggestion for a shop with no links, shown faint: Use makes it link 1. */
  offer: ShopLink | null;
  unit: DistanceUnit;
  /** The link whose ring is pressed (the number of links: ＋). */
  pressed: number | null;
  /** Why the last drop or tap on the map set no link. */
  refused: string | null;
  onPress: (link: number) => void;
  onUse: () => void;
  onRemove: (link: number) => void;
}): ReactElement {
  const id = useId();
  const text = (link: ShopLink | FraId) =>
    typeof link === "number" ? (
      <span className="link-text">FRA {link}</span>
    ) : (
      <span className="link-text">
        {linkText(link)}
        <span className="link-sub">
          {fmtDistance(link.km, props.unit, 1)}
          <RailroadChips railroads={link.railroads} />
        </span>
      </span>
    );
  const next = props.links.length;
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id} className="field-label">
        Track links
      </span>
      <ul className="link-rows">
        {props.links.map((link, i) => (
          <li key={i} className="link-row">
            <button
              type="button"
              className="icon-btn ring-btn"
              aria-label={`Move link ${i + 1}`}
              aria-pressed={props.pressed === i}
              onClick={() => props.onPress(i)}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") props.onRemove(i);
              }}
            >
              <PlacePin kind="stop" n={i + 1} />
            </button>
            {text(link)}
            <button type="button" className="icon-btn" aria-label={`Remove link ${i + 1}`} onClick={() => props.onRemove(i)}>
              <Cross />
            </button>
          </li>
        ))}
        {props.offer && (
          <li className="link-row is-offer">
            <PlacePin kind="stop" n={1} />
            {text(props.offer)}
            <span className="link-tag">Suggested</span>
            <button type="button" className="link-btn" onClick={props.onUse}>
              Use
            </button>
          </li>
        )}
        {next < SHOP_LINKS_MAX && !props.offer && (
          <li className="link-row is-add">
            <button type="button" className="add-link" aria-pressed={props.pressed === next} onClick={() => props.onPress(next)}>
              <PlacePin kind="stop" n="+" />
              Add link
            </button>
          </li>
        )}
      </ul>
      {props.refused ? (
        <span className="hint hint--bad">{props.refused}</span>
      ) : (
        props.pressed !== null && <span className="hint-line">{clickToSet(`link ${props.pressed + 1}`)}</span>
      )}
    </div>
  );
}
