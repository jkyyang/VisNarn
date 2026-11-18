/** Your shops: the destinations the user defines. Rules for saving one, and what the network says about each. */
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/app.ts";
import { locationOf, refOf, SHOP_LINK_MAX_KM, type ImportReport, type ImportRequest, type RowIssue, type Shop, type ShopDraft, type ShopId, type ShopView } from "../../shared/places.ts";
import { readShops } from "../intake/intake.ts";
import type { Store } from "../store/store.ts";
import type { Directory } from "./directory.ts";

export interface Shops {
  /** Each with "On lines" found from its node, or the reason it is off the network. */
  list(): ShopView[];
  /**
   * Creates (no id) or replaces a shop. The location is resolved now and saved as a node or
   * coordinates. Throws AppError: "invalid" (empty name; location does not resolve; a link repeats,
   * is gone or is too far; with the field at fault), "conflict" (code used by another shop),
   * "not-found" (unknown id).
   */
  save(draft: ShopDraft, id: ShopId | null): ShopView;
  remove(id: ShopId): void;
  /**
   * Columns: name, code, and fra_id or lon, lat. With commit false nothing is saved and the report
   * is a preview. With commit true the ready rows are upserted by code (else by name), so importing
   * the same file twice changes nothing. Rows that match no node are returned as issues, never saved.
   * A shop keeps its links while the file leaves it where it is; moved, it snaps again.
   */
  import(request: ImportRequest): Promise<ImportReport<ShopView>>;
}

export function createShops(store: Store, directory: Directory): Shops {
  // By its saved location: shops in an import preview have no id yet.
  const view = (shop: Shop): ShopView => ({ ...shop, place: directory.shopPlace(shop, refOf(shop.location)) });
  const withCode = (code: string, except: ShopId | null = null) =>
    store.shops.named(code).find((s) => s.code?.toLowerCase() === code.toLowerCase() && s.id !== except) ?? null;
  const withName = (name: string) => store.shops.named(name).find((s) => s.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

  /** What is wrong with a shop's links, or null: each joins another node of this network, within reach of the shop. */
  const linkProblem = (shop: Shop): string | null => {
    const repeat = shop.links.findIndex((fraId, i) => shop.links.indexOf(fraId) < i);
    if (repeat >= 0) return `Link ${repeat + 1} repeats link ${shop.links.indexOf(shop.links[repeat]) + 1}.`;
    const place = view(shop).place;
    if (!place.ok) return place.problem.message;
    const far = place.place.links?.findIndex((link) => link.km > SHOP_LINK_MAX_KM) ?? -1;
    return far < 0 ? null : `Link ${far + 1} is more than ${SHOP_LINK_MAX_KM} km from the shop.`;
  };

  /** The shop a draft would become, or why it cannot. Saves nothing. */
  const prepare = (draft: ShopDraft, id: ShopId): { shop: Shop } | { field: string; message: string } => {
    const name = draft.name.trim();
    if (!name) return { field: "name", message: "Give the shop a name." };
    const code = draft.code?.trim() || null;
    // A shop's own location is a position: its text is looked up in cities before Your shops.
    const place = directory.resolve(draft.location, "position");
    if (!place.ok) return { field: "location", message: place.problem.message };
    const shop: Shop = { id, name, code, location: locationOf(place.place), links: draft.links };
    const miswired = linkProblem(shop);
    return miswired ? { field: "links", message: miswired } : { shop };
  };

  const same = (x: Shop, y: Shop) => JSON.stringify([x.name, x.code, x.location, x.links]) === JSON.stringify([y.name, y.code, y.location, y.links]);

  /** Writes only when something changed, so saving the same shop again leaves every check where it was. */
  const put = (shop: Shop, before: Shop | null) => {
    if (!before || !same(before, shop)) store.shops.save(shop);
  };

  return {
    list: () => store.shops.all().map(view),

    save(draft, id) {
      const before = id ? store.shops.get(id) : null;
      if (id && !before) throw new AppError("not-found", "This shop no longer exists.");
      const ready = prepare(draft, id ?? (randomUUID() as ShopId));
      if (!("shop" in ready)) throw new AppError("invalid", ready.message, ready.field);
      put(ready.shop, before);
      return view(ready.shop);
    },

    remove(id) {
      if (!store.shops.remove(id)) throw new AppError("not-found", "This shop no longer exists.");
    },

    async import({ source, commit }) {
      const parsed = readShops(source);
      const issues: RowIssue[] = [...parsed.issues];
      const bad = new Set(parsed.issues.map((i) => i.row));
      const seen = new Map<string, number>();
      const plan: { shop: Shop; before: Shop | null }[] = [];

      parsed.items.forEach((draft, row) => {
        if (bad.has(row)) return;
        const line = parsed.lines[row];
        const issue = (message: string) => issues.push({ row, line, message });
        const key = (draft.code?.trim() || `name:${draft.name.trim()}`).toLowerCase();
        const earlier = seen.get(key);
        if (earlier !== undefined) return issue(`This row repeats ${draft.code ? `the code ${draft.code}` : `the name ${draft.name}`} from line ${earlier}.`);
        seen.set(key, line);

        const code = draft.code?.trim() || null;
        const before = (code ? withCode(code) : null) ?? withName(draft.name);
        const ready = prepare(draft, before?.id ?? (randomUUID() as ShopId));
        if (!("shop" in ready)) return issue(ready.message);
        if (before && JSON.stringify(before.location) === JSON.stringify(ready.shop.location)) ready.shop.links = before.links;
        const holder = code ? withCode(code, ready.shop.id) : null;
        if (holder) return issue(`The shop ${holder.name} already has the code ${code}.`);
        plan.push({ shop: ready.shop, before });
      });

      if (commit) for (const { shop, before } of plan) put(shop, before);
      issues.sort((x, y) => x.row - y.row);
      return { committed: commit, ready: plan.map(({ shop }) => view(shop)), issues };
    },
  };
}
