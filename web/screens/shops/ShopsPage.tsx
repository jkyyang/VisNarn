/** The Shops screen's parts. Views only. */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import type { LngLat } from "../../../shared/geo.ts";
import {
  SHOP_LINKS_MAX, type FraId, type ImportReport, type ImportRequest, type PlaceRef, type ResolvedPlace, type RowIssue, type ShopDraft, type ShopId,
  type ShopLink, type ShopView,
} from "../../../shared/places.ts";
import type { Railroad } from "../../../shared/railroads.ts";
import { fresh, usePlace } from "../../data/hooks.ts";
import { fmtDistance } from "../../format.ts";
import { PlacePin, RailroadChips } from "../../ui/badges.tsx";
import { ConfirmDelete } from "../../ui/ConfirmDelete.tsx";
import { readFileText } from "../../ui/files.ts";
import { HistoryButtons, type History } from "../../ui/history.tsx";
import { Cross, Plus } from "../../ui/icons.tsx";
import { Menu } from "../../ui/Menu.tsx";
import { ownerOf, type Owner } from "../../owner.ts";
import { lineColor } from "../../theme.ts";
import { PHONE_QUERY } from "../../map/config.ts";
import type { DistanceUnit } from "../../units.ts";
import { clickToSet, errorText, lineName, linkText, nameAndNote, plural } from "../../words.ts";

/** Rows of an import preview listed by name; the rest are counted. */
const PREVIEW_ROWS = 8;

/** The owner's mark: Procor a filled dot, UTLX a ring; an owner the name and code do not give, none. */
export function OwnerGlyph({ owner }: { owner: Owner | null }): ReactElement {
  return <span className={`owner-glyph${owner ? ` owner-glyph--${owner.toLowerCase()}` : ""}`} aria-hidden="true" />;
}

/** Up to three of the railroads at a shop as dots; the tooltip names them all. */
function CarrierDots({ railroads }: { railroads: readonly Railroad[] }): ReactElement {
  const names = `Carriers: ${railroads.map(lineName).join(", ")}`;
  return (
    <span className="carrier-dots" role="img" aria-label={names} title={names}>
      {railroads.slice(0, 3).map((railroad) => (
        <i key={railroad} style={{ background: lineColor(railroad) }} />
      ))}
    </span>
  );
}

/**
 * The shops: a count, Add shop and the ⋯ menu (Import CSV) over one row per shop (its owner's mark, name, code and
 * the name's note in brackets, carriers). A row's click selects the shop and the map flies there; Edit shows on the
 * hovered or selected row. The rows an import just saved light up once. On the public site (no `onAdd`, `onEdit`,
 * `onImport`) the list has none of those.
 */
export function ShopList(props: {
  shops: ShopView[];
  /** Shown of all: the search narrows the list. */
  total: number;
  selected: ShopId | null;
  editing: ShopView | "new" | null;
  /** The shops an import just saved; `onLit` once their rows have lit up. */
  lit: ShopView[];
  onLit: () => void;
  onSelect: (shop: ShopView) => void;
  onEdit: ((shop: ShopView) => void) | null;
  onAdd: (() => void) | null;
  onImport: ((file: File | undefined) => void) | null;
  /** Why the file chosen could not be read: ⋯ turns red. */
  importWrong: string | null;
}): ReactElement {
  const { onEdit } = props;
  const editingId = props.editing && props.editing !== "new" ? props.editing.id : null;
  const count = props.shops.length === props.total ? plural(props.total, "shop") : `${props.shops.length} of ${plural(props.total, "shop")}`;
  // The shop picked, here or on the map, is on show in the list: on a phone, in the part of the sheet above the screen's foot.
  const selectedRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [props.selected]);
  return (
    <section className="shop-list" aria-label="Shop list">
      <div className="list-bar">
        <span className="list-count">{count}</span>
        {props.onAdd && (
          <button type="button" className="btn btn--primary btn--pill" onClick={props.onAdd} aria-pressed={props.editing === "new"}>
            <Plus size={14} />
            Add shop
          </button>
        )}
        {props.onImport && <ShopMenu onImport={props.onImport} wrong={props.importWrong} />}
      </div>
      <ul className="shop-rows">
        {props.shops.map((shop) => {
          const selected = shop.id === props.selected;
          const editing = shop.id === editingId;
          const [name, note] = nameAndNote(shop.name);
          return (
            <li
              key={shop.id}
              ref={selected ? selectedRow : undefined}
              className={`shop-row${selected || editing ? " is-selected" : ""}${shop.place.ok ? "" : " is-off"}${props.lit.some((saved) => saved.id === shop.id) ? " is-lit" : ""}`}
              title={shop.place.ok ? undefined : "Not on the network"}
              onAnimationEnd={props.onLit}
            >
              <button type="button" className="shop-pick" aria-pressed={selected} onClick={() => props.onSelect(shop)}>
                <OwnerGlyph owner={ownerOf(shop)} />
                <span className="shop-text">
                  <span className="shop-name">{name}</span>
                  <span className="shop-sub" title={note ?? undefined}>{[shop.code, note].filter(Boolean).join(" · ")}</span>
                </span>
                {shop.place.ok && <CarrierDots railroads={shop.place.place.railroads} />}
              </button>
              {onEdit && (
                <button type="button" className="btn btn--pill shop-edit" aria-label={`Edit ${shop.name}`} aria-pressed={editing} onClick={() => onEdit(shop)}>
                  {editing ? "Editing" : "Edit"}
                </button>
              )}
            </li>
          );
        })}
        {!props.shops.length && <li className="list-empty">{props.total ? "No match" : "No shops yet"}</li>}
      </ul>
    </section>
  );
}

/** ⋯: what else the list can do. Import CSV opens the file chooser; the preview shows above the list. */
function ShopMenu(props: { onImport: (file: File | undefined) => void; wrong: string | null }): ReactElement {
  const fileId = useId();
  return (
    <Menu
      label="More actions"
      wrong={props.wrong}
      items={(close) => (
        <label role="menuitem" tabIndex={0} htmlFor={fileId} className="menu-item" onClick={() => requestAnimationFrame(close)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), e.currentTarget.click())}>
          Import CSV
        </label>
      )}
    >
      <input
        id={fileId}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Import CSV"
        onChange={(e) => {
          props.onImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </Menu>
  );
}

/** A saved location as the place reference to resolve and save again. */
function savedRef(shop: ShopView | null): PlaceRef | null {
  if (!shop) return null;
  return "fraId" in shop.location ? { kind: "node", fraId: shop.location.fraId, railroad: shop.location.railroad } : { kind: "coord", lon: shop.location.lon, lat: shop.location.lat };
}

/**
 * Edit shop / Add shop, with Undo and Redo of its link changes in its bar · Name · Shop code · Location, set on the map
 * (a new shop's first click drops its pin; a pin is dragged to move it), shown as the place it is near · the track links
 * (`children`) · Delete / Cancel / Save shop.
 *
 * It asks the server what the location means (usePlace) and says where that is (`onPlace`). Save is off until the place
 * is on the network; off it, the Location row's edge is red and its tooltip says why. A save or delete the server
 * refuses turns Save shop's edge red, with why in its tooltip.
 */
export function ShopForm(props: {
  shop: ShopView | null;
  /** The spot the pin was put on or dragged to on the map. */
  picked: LngLat | null;
  /** Where the location resolves, each time it does. */
  onPlace: (place: ResolvedPlace | null) => void;
  /** The pin is wrong where it is: why, for the map's pin. */
  onProblem: (problem: string | null) => void;
  onSave: (draft: Omit<ShopDraft, "links">) => Promise<unknown>;
  onDelete: (() => Promise<unknown>) | null;
  onCancel: () => void;
  /** Undo and redo of the link changes made in this form. */
  history: History;
  children?: ReactNode;
}): ReactElement {
  const [name, setName] = useState(props.shop?.name ?? "");
  const [code, setCode] = useState(props.shop?.code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The form opens above the list, which may be scrolled far down: bring it into view and start at its first box.
  // On a phone the card can be taller than the screen, where "nearest" stops short and cuts the heading off. On a touch
  // screen the name waits for a tap, as its keyboard would cover the map the shop is set on.
  useEffect(() => {
    const phone = window.matchMedia?.(PHONE_QUERY).matches ?? false;
    sectionRef.current?.scrollIntoView?.({ block: phone ? "start" : "nearest" });
    if (!window.matchMedia?.("(pointer: coarse)").matches) nameRef.current?.focus({ preventScroll: true });
  }, []);

  const saved = useMemo(() => savedRef(props.shop), [props.shop]);
  const ref = useMemo<PlaceRef | null>(() => (props.picked ? { kind: "coord", lon: props.picked[0], lat: props.picked[1] } : saved), [props.picked, saved]);
  // "position", as the server saves a shop's own location: cities before Your shops.
  const resolution = usePlace(ref, "position");
  const resolved = fresh(resolution);
  const problem = resolved && !resolved.ok ? resolved.problem.message : resolution.status === "error" ? resolution.error.message : null;
  useEffect(() => {
    if (resolved) props.onPlace(resolved.ok ? resolved.place : null);
  }, [resolved]);
  useEffect(() => props.onProblem(problem), [problem]);
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
      <div className="field-head">
        <h2>{props.shop ? "Edit shop" : "Add shop"}</h2>
        <HistoryButtons history={props.history} />
      </div>
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
          <span className="field-label" id={`${ids}-loc`}>
            Location
          </span>
          <output className={`location${problem ? " is-wrong" : ""}`} aria-labelledby={`${ids}-loc`} title={problem ?? undefined}>
            {resolved?.ok ? resolved.place.label : "—"}
            {problem && <span className="visually-hidden">{problem}</span>}
          </output>
        </div>
        {props.children}
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
          <button type="submit" className={`btn btn--primary${error ? " is-wrong" : ""}`} disabled={!canSave} title={error ?? undefined}>
            {busy ? "Saving…" : "Save shop"}
          </button>
        </div>
        {error && (
          <span className="visually-hidden" role="alert">
            {error}
          </span>
        )}
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
export function useImport(run: (request: ImportRequest) => Promise<ImportReport<ShopView>>) {
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
  return { preview, saved, error, busy, choose, commit, cancel: () => setPreview(null), dismiss: () => setSaved(null) };
}

/**
 * A shop list being imported, from the ⋯ menu's Import CSV: how many rows are ready ("update" on one that replaces a
 * saved shop: it keeps that shop's id), and each row that will not be saved, with why; then Save. A save the server refuses turns Save's edge red, with why in its tooltip. On screen the
 * saved rows light up in the list, and a file that cannot be read turns ⋯ red; screen readers hear both here.
 */
export function ImportPreview(props: { flow: ReturnType<typeof useImport>; saved: ShopView[] }): ReactElement {
  const { flow } = props;
  const replaces = (shop: ShopView) => props.saved.some((saved) => saved.id === shop.id);
  const said = (
    <span className="visually-hidden" role={flow.error ? "alert" : "status"}>
      {flow.error ?? (flow.saved ? `Saved ${plural(flow.saved.ready.length, "shop")}.` : "")}
    </span>
  );
  if (!flow.preview && !flow.busy) return said;
  return (
    <section className="group import-card" aria-label="Import shop list">
      {said}
      {flow.busy && !flow.preview && <p className="muted">Reading the file…</p>}
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
                  {shop.name} {shop.code && <span className="muted small">{shop.code}</span>} {replaces(shop) && <span className="tag">update</span>}
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
            <button type="button" className={`btn btn--primary${flow.error ? " is-wrong" : ""}`} title={flow.error ?? undefined} disabled={!flow.preview.report.ready.length || flow.busy} onClick={flow.commit}>
              Save {plural(flow.preview.report.ready.length, "shop")}
            </button>
          </div>
        </div>
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
      {/* On screen a pressed ring and the map's answer to the tap say it; screen readers hear it. */}
      <span className="visually-hidden" role="status">
        {props.refused ?? (props.pressed !== null ? clickToSet(`link ${props.pressed + 1}`) : "")}
      </span>
    </div>
  );
}
