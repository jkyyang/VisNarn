/**
 * The Directory: what a place reference means on the network. The one resolver in the app.
 *
 * It answers from two sources, each its own namespace: Your shops, and the network itself (FRA node
 * ids, coordinates, public city names). The rules below are the whole policy, and they live only here:
 *
 *   node   → that node, or "removed" if this network build has no such id
 *   coord  → snapped to mainline within SNAP_KM (engine/rules.ts), or "off-network"
 *   shop   → the shop's saved location, or "removed" if the shop was deleted; a shop with links stays at its
 *            location and joins the network at its links' nodes (no snapping), or is "removed" when one is gone
 *   text   → by role, first list with a match wins; more than one match inside a list is "ambiguous"
 *            and lists the candidates:
 *              any role:  "lon, lat" or "lat, lon"  → coord        "FRA 358070" → node
 *              shop:      Your shops (name or code) → city names
 *              position:  city names → Your shops        (a stop, a shop's own location)
 *            A bare number is never an FRA id.
 *
 * Anything that does not resolve is a PlaceProblem, shown at the place it is about; a plan with one is not routed.
 */
import type { City, RailNetwork } from "../../engine/index.ts";
import { createCache } from "../../shared/cache.ts";
import { isLngLat, plainMinus, round5 } from "../../shared/geo.ts";
import {
  SHOP_LINK_MAX_KM, type FraId, type LinkEnd, type NetworkNode, type NodeLocation, type PlaceMatch, type PlaceProblem, type PlaceRef, type PlaceResolution,
  type PlaceRole, type PlaceSuggestion, type Shop, type ShopLink,
} from "../../shared/places.ts";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { Store } from "../store/store.ts";

export interface Directory {
  resolve(ref: PlaceRef, role: PlaceRole): Promise<PlaceResolution>;
  /** Autocomplete. Every suggestion carries a typed ref, so picking one leaves nothing to guess later. */
  suggest(text: string, role: PlaceRole, limit: number): Promise<PlaceSuggestion[]>;
  /** The node a map click snaps to. */
  nearest(lon: number, lat: number, withinKm: number): NetworkNode | null;
  /**
   * A shop at (lon, lat) linked at each end: that node, or the way in nearest a rough spot (its own track followed to
   * the main line), each with the track drawn shop first. Null for an end that cannot be one of its links.
   */
  links(lon: number, lat: number, ends: LinkEnd[]): (ShopLink | null)[];
  /** A shop as a place: where `ref` (the shop itself, or its saved location) leads. */
  shopPlace(shop: Shop, ref: PlaceRef): PlaceResolution;
}

/** Network answers kept: typed text adds one per keystroke, so the least recently used go first. */
const MEMO_ENTRIES = 20_000;
/** Places offered when typed text matches none. */
const CANDIDATES = 5;
/** Suggestions listed under a place input. */
export const SUGGESTIONS_SHOWN = 8;

/** "FRA 358070", "FRA node 358070", "fra:358070". */
const FRA_TEXT = /^fra(?:\s*node)?\s*[:#]?\s*(\d{1,9})$/i;
/** Two numbers: "-92.27, 34.77", "34.77 -92.27". */
const COORD_TEXT = /^(-?\d{1,3}(?:\.\d+)?)\s*(?:,|;|\s)\s*(-?\d{1,3}(?:\.\d+)?)$/;

/** Where the network is: two numbers in this box are read as longitude, latitude in that order. */
const inNorthAmerica = (lon: number, lat: number) => lon >= -170 && lon <= -50 && lat >= 14 && lat <= 84;

export function createDirectory(network: RailNetwork, store: Store): Directory {
  // Only answers that follow from the network and the question: one that reads the store is never kept.
  const memo = createCache<string, PlaceResolution>({ maxEntries: MEMO_ENTRIES });
  const memoized = (key: string, compute: () => PlaceResolution): PlaceResolution => {
    let answer = memo.get(key);
    if (!answer) {
      answer = compute();
      memo.set(key, answer);
    }
    return answer;
  };

  const problem = (kind: PlaceProblem["kind"], message: string, candidates: PlaceSuggestion[] = []): PlaceResolution => ({
    ok: false,
    problem: { kind, message, candidates },
  });

  // ---- the network's own answers ----

  const atNode = (ref: PlaceRef, fraId: FraId, railroad: Railroad | null, how: Omit<PlaceMatch, "confidence" | "snapKm">, label?: string): PlaceResolution => {
    const node = network.node(fraId);
    if (!node) return problem("removed", "No track found for that code.");
    if (railroad && !node.railroads.includes(railroad)) {
      return problem("off-network", `${railroad} has no track at ${node.near}.`);
    }
    return {
      ok: true,
      place: {
        ref,
        label: label ?? node.near,
        lon: node.lon,
        lat: node.lat,
        fraId,
        railroad,
        railroads: node.railroads,
        match: { ...how, confidence: "exact", snapKm: 0 },
      },
    };
  };

  const atCoordinates = (ref: PlaceRef, lon: number, lat: number, how: Omit<PlaceMatch, "confidence" | "snapKm">, label?: string): PlaceResolution => {
    const snap = network.snap(lon, lat);
    if (!snap) {
      const what = label ? `${label} (${round5(lon)}, ${round5(lat)})` : `${round5(lon)}, ${round5(lat)}`;
      return problem("off-network", `No track near ${what}.`);
    }
    return {
      ok: true,
      place: {
        ref,
        label: label ?? network.near(lon, lat),
        lon: round5(lon),
        lat: round5(lat),
        fraId: null,
        railroad: null,
        railroads: snap.railroads,
        match: { ...how, confidence: "snapped", snapKm: Math.round(snap.km * 10) / 10 },
      },
    };
  };

  const atLocation = (ref: PlaceRef, location: NodeLocation, how: Omit<PlaceMatch, "confidence" | "snapKm">, label: string): PlaceResolution =>
    "fraId" in location ? atNode(ref, location.fraId, location.railroad, how, label) : atCoordinates(ref, location.lon, location.lat, how, label);

  // ---- the user's lists ----

  /** A shop wired to the track sits at its location and joins the network only at its links, each over its own track (network.lead). */
  const atLinks = (ref: PlaceRef, shop: Shop): PlaceResolution => {
    const at = "fraId" in shop.location ? network.node(shop.location.fraId) : shop.location;
    if (!at) return problem("removed", `The shop ${shop.name}: no track found for its node.`);
    const links: NetworkNode[] = [];
    for (const [i, fraId] of shop.links.entries()) {
      const node = network.node(fraId);
      const lead = network.lead(at.lon, at.lat, fraId);
      if (!node || !lead) return problem("removed", `The shop ${shop.name}: link ${i + 1} is gone from this network.`);
      links.push({ ...node, km: lead.km });
    }
    const served = new Set(links.flatMap((link) => link.railroads));
    return {
      ok: true,
      place: {
        ref,
        label: shop.name,
        lon: at.lon,
        lat: at.lat,
        fraId: null,
        railroad: null,
        links,
        railroads: RAILROADS.filter((railroad) => served.has(railroad)),
        match: { method: "shop", confidence: "exact", snapKm: 0 },
      },
    };
  };

  const atShop = (ref: PlaceRef, shop: Shop): PlaceResolution => {
    if (shop.links.length) return atLinks(ref, shop);
    const found = atLocation(ref, shop.location, { method: "shop" }, shop.name);
    if (!found.ok) return problem(found.problem.kind, `The shop ${shop.name}: ${found.problem.message}`);
    return found;
  };

  const atCity = (ref: PlaceRef, city: City): PlaceResolution => atCoordinates(ref, city.lon, city.lat, { method: "city" }, city.name);

  /** Keyed by the shop's content as well: an import preview shows shops that are not saved. */
  const shopPlace = (shop: Shop, ref: PlaceRef): PlaceResolution => memoized(`shop\u0000${JSON.stringify([ref, shop])}`, () => atShop(ref, shop));

  const onNetwork = (ref: Extract<PlaceRef, { kind: "node" | "coord" }>): PlaceResolution =>
    memoized(JSON.stringify(ref), () =>
      ref.kind === "node" ? atNode(ref, ref.fraId, ref.railroad, { method: "node" }) : atCoordinates(ref, ref.lon, ref.lat, { method: "coordinates" }),
    );

  // ---- suggestions (also the candidates of a problem) ----

  /** Railroads at a suggested place, from the same (memoized) resolution a pick of it gets. */
  const railroadsAt = (found: PlaceResolution): Railroad[] => (found.ok ? found.place.railroads : []);
  const shopSuggestion = (shop: Shop): PlaceSuggestion => {
    const ref: PlaceRef = { kind: "shop", shopId: shop.id };
    const detail = ["Your shop", ...(shop.code ? [shop.code] : [])].join(" · ");
    return { ref, label: shop.name, detail, source: "shop", railroads: railroadsAt(shopPlace(shop, ref)) };
  };
  const citySuggestion = (city: City): PlaceSuggestion => {
    const ref = { kind: "coord", lon: city.lon, lat: city.lat } as const;
    return { ref, label: city.name, detail: "City", source: "city", railroads: railroadsAt(onNetwork(ref)) };
  };
  const nodeSuggestion = (fraId: FraId): PlaceSuggestion[] => {
    const node = network.node(fraId);
    if (!node) return [];
    const source = node.yard ? "yard" : node.railroads.length > 1 ? "junction" : "node";
    return [{ ref: { kind: "node", fraId, railroad: null }, label: node.near, detail: `FRA node ${fraId}`, source, railroads: node.railroads }];
  };

  const suggest = async (text: string, role: PlaceRole, limit: number): Promise<PlaceSuggestion[]> => {
    const q = plainMinus(text.trim());
    if (!q || limit <= 0) return [];
    const lower = q.toLowerCase();
    const shops = (await store.shops.all())
      .filter((s) => s.name.toLowerCase().includes(lower) || !!s.code?.toLowerCase().includes(lower))
      .sort((x, y) => Number(!startsWith(x, lower)) - Number(!startsWith(y, lower)))
      .map(shopSuggestion);
    const cities = network.cities(q, limit).map(citySuggestion);
    // Only the explicit "FRA 358070" form: Enter picks the first suggestion, and a bare number never names a node.
    const fra = FRA_TEXT.exec(q)?.[1] ?? null;
    const nodes = fra ? nodeSuggestion(Number(fra) as FraId) : [];
    const ordered = role === "shop" ? [...shops, ...cities, ...nodes] : [...cities, ...shops, ...nodes];
    return ordered.slice(0, limit);
  };

  // ---- text ----

  const fromText = async (ref: Extract<PlaceRef, { kind: "text" }>, role: PlaceRole): Promise<PlaceResolution> => {
    const text = plainMinus(ref.text.trim());
    if (!text) return problem("empty", "Nothing is filled in.");

    const fra = FRA_TEXT.exec(text);
    if (fra) return atNode(ref, Number(fra[1]) as FraId, null, { method: "node" });

    const pair = COORD_TEXT.exec(text);
    if (pair) {
      const [x, y] = [Number(pair[1]), Number(pair[2])];
      const [lon, lat] = inNorthAmerica(x, y) ? [x, y] : inNorthAmerica(y, x) ? [y, x] : [x, y];
      if (!isLngLat(lon, lat)) return problem("unknown", `"${ref.text}" cannot be read as a longitude and latitude.`);
      return atCoordinates(ref, lon, lat, { method: "coordinates" });
    }

    const lists: (() => Promise<PlaceResolution | null>)[] = [];
    const shopList = async () => {
      const shops = await store.shops.named(text);
      if (shops.length > 1) return problem("ambiguous", `${shops.length} of Your shops are called "${text}". Pick one.`, shops.map(shopSuggestion));
      return shops.length ? atShop(ref, shops[0]) : null;
    };
    const cityList = async () => {
      const city = network.city(text);
      return city ? atCity(ref, city) : null;
    };
    if (role === "shop") lists.push(shopList, cityList);
    else lists.push(cityList, shopList);
    for (const list of lists) {
      const found = await list();
      if (found) return found;
    }

    // A bare number is never taken as an FRA node, but one that is a node is named, for a person to pick on purpose.
    const node = /^\d{1,9}$/.test(text) ? nodeSuggestion(Number(text) as FraId) : [];
    const fraHint = node.length ? ` For FRA node ${text}, type "FRA ${text}".` : "";
    return problem("unknown", `No place called "${text}".${fraHint}`, [...(await suggest(text, role, CANDIDATES)), ...node].slice(0, CANDIDATES));
  };

  const resolve = async (ref: PlaceRef, role: PlaceRole): Promise<PlaceResolution> => {
    switch (ref.kind) {
      case "node":
      case "coord":
        return onNetwork(ref);
      case "shop": {
        const shop = await store.shops.get(ref.shopId);
        return shop ? shopPlace(shop, ref) : problem("removed", "This shop was deleted. Pick another shop.");
      }
      case "text":
        return fromText(ref, role);
    }
  };

  return {
    resolve,
    suggest,
    nearest: (lon, lat, withinKm) => network.nearest(lon, lat, withinKm),
    links: (lon, lat, ends) =>
      ends.map((end) => {
        const node = "fraId" in end ? network.node(end.fraId) : network.wayIn(end.lon, end.lat);
        const lead = node && network.lead(lon, lat, node.fraId);
        return node && lead && lead.km <= SHOP_LINK_MAX_KM ? { ...node, km: lead.km, path: lead.path } : null;
      }),
    shopPlace,
  };
}

function startsWith(shop: Shop, lower: string): boolean {
  return shop.name.toLowerCase().startsWith(lower) || !!shop.code?.toLowerCase().startsWith(lower);
}
