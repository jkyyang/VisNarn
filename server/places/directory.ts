/**
 * The Directory: what a place reference means on the network. The one resolver in the app.
 *
 * It answers from three sources, each its own namespace: Your shops, the imported code sets, and
 * the network itself (FRA node ids, coordinates, public city names). The rules below are the whole
 * policy, and they live only here:
 *
 *   node   → that node, or "removed" if this network build has no such id
 *   coord  → snapped to mainline within MAX_SNAP_KM, or "off-network"
 *   shop   → the shop's saved location, or "removed" if the shop was deleted
 *   code   → looked up in its own code set and nowhere else, or "unknown"
 *   text   → by role, first list with a match wins; more than one match inside a list is "ambiguous"
 *            and lists the candidates:
 *              any role:  "lon, lat" or "lat, lon"  → coord        "FRA 358070" → node
 *              shop:      Your shops (name or code) → code sets → city names
 *              position:  code sets → city names → Your shops        (A, B, a stop, a shop's own location)
 *            A bare number is never an FRA id: digits alone are only ever looked up as a code.
 *
 * Anything that does not resolve is a PlaceProblem, shown at the place it is about; a plan with one is not routed.
 */
import { MAX_SNAP_KM, type City, type RailNetwork } from "../../engine/index.ts";
import { round5 } from "../../shared/geo.ts";
import type {
  FraId, NetworkNode, NodeCode, NodeLocation, PlaceMatch, PlaceProblem, PlaceRef, PlaceResolution, PlaceRole, PlaceSuggestion, Shop,
} from "../../shared/places.ts";
import type { Railroad } from "../../shared/railroads.ts";
import type { Store } from "../store/store.ts";

export interface Directory {
  resolve(ref: PlaceRef, role: PlaceRole): PlaceResolution;
  /** Autocomplete. Every suggestion carries a typed ref, so picking one leaves nothing to guess later. */
  suggest(text: string, role: PlaceRole, limit: number): PlaceSuggestion[];
  /** The node a map click snaps to. */
  nearest(lon: number, lat: number, withinKm: number): NetworkNode | null;
}

/** A memo past this size is dropped whole: typed text (one entry per keystroke) must not grow it forever. */
const MEMO_LIMIT = 20_000;
const CANDIDATES = 5;

/** "FRA 358070", "FRA node 358070", "fra:358070". */
const FRA_TEXT = /^fra(?:\s*node)?\s*[:#]?\s*(\d{1,9})$/i;
/** Two numbers: "-92.27, 34.77", "34.77 -92.27". The mockups write minus as U+2212. */
const COORD_TEXT = /^(-?\d{1,3}(?:\.\d+)?)\s*(?:,|;|\s)\s*(-?\d{1,3}(?:\.\d+)?)$/;

const inNorthAmerica = (lon: number, lat: number) => lon >= -170 && lon <= -50 && lat >= 14 && lat <= 84;

export function createDirectory(network: RailNetwork, store: Store): Directory {
  const memo = new Map<string, PlaceResolution>();
  let memoRevision = -1;

  const problem = (kind: PlaceProblem["kind"], message: string, candidates: PlaceSuggestion[] = []): PlaceResolution => ({
    ok: false,
    problem: { kind, message, candidates },
  });

  const codeSetLabel = (codeType: string) => store.codes.sets().find((s) => s.codeType.toLowerCase() === codeType.toLowerCase())?.label ?? codeType;

  // ---- the network's own answers ----

  const atNode = (ref: PlaceRef, fraId: FraId, railroad: Railroad | null, how: Omit<PlaceMatch, "confidence" | "snapKm">, label?: string): PlaceResolution => {
    const node = network.node(fraId);
    if (!node) return problem("removed", `FRA node ${fraId} is not in this network file.`);
    if (railroad && !node.railroads.includes(railroad)) {
      return problem("off-network", `${railroad} has no track at FRA node ${fraId} (${node.near}). Track there: ${node.railroads.join(", ") || "none"}.`);
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
        example: false,
      },
    };
  };

  const atCoordinates = (ref: PlaceRef, lon: number, lat: number, how: Omit<PlaceMatch, "confidence" | "snapKm">, label?: string): PlaceResolution => {
    const snap = network.snap(lon, lat);
    if (!snap) {
      const what = label ? `${label} (${round5(lon)}, ${round5(lat)})` : `${round5(lon)}, ${round5(lat)}`;
      return problem("off-network", `${what} is more than ${MAX_SNAP_KM} km from any Class I main line.`);
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
        example: false,
      },
    };
  };

  const atLocation = (ref: PlaceRef, location: NodeLocation, how: Omit<PlaceMatch, "confidence" | "snapKm">, label: string): PlaceResolution =>
    "fraId" in location ? atNode(ref, location.fraId, location.railroad, how, label) : atCoordinates(ref, location.lon, location.lat, how, label);

  // ---- the user's lists ----

  const atShop = (ref: PlaceRef, shop: Shop): PlaceResolution => {
    const found = atLocation(ref, shop.location, { method: "shop", codeType: null }, shop.name);
    if (!found.ok) return problem(found.problem.kind, `The shop ${shop.name}: ${found.problem.message}`);
    return { ok: true, place: { ...found.place, example: shop.example } };
  };

  const atCode = (ref: PlaceRef, code: NodeCode): PlaceResolution => {
    const label = code.name ?? `${codeSetLabel(code.codeType)} ${code.code}`;
    const found = atLocation(ref, code.location, { method: "code", codeType: code.codeType }, label);
    return found.ok ? found : problem(found.problem.kind, `${codeSetLabel(code.codeType)} ${code.code}: ${found.problem.message}`);
  };

  const atCity = (ref: PlaceRef, city: City): PlaceResolution => atCoordinates(ref, city.lon, city.lat, { method: "city", codeType: null }, city.name);

  // ---- suggestions (also the candidates of a problem) ----

  const shopSuggestion = (shop: Shop): PlaceSuggestion => ({
    ref: { kind: "shop", shopId: shop.id },
    label: shop.name,
    detail: ["Your shop", ...(shop.example ? ["EXAMPLE"] : []), ...(shop.code ? [shop.code] : [])].join(" · "),
    source: "shop",
  });
  const codeSuggestion = (code: NodeCode): PlaceSuggestion => ({
    ref: { kind: "code", codeType: code.codeType, code: code.code },
    label: code.name ?? `${codeSetLabel(code.codeType)} ${code.code}`,
    detail: `${codeSetLabel(code.codeType)} ${code.code}`,
    source: "code",
  });
  const citySuggestion = (city: City): PlaceSuggestion => ({ ref: { kind: "coord", lon: city.lon, lat: city.lat }, label: city.name, detail: "City", source: "city" });
  const nodeSuggestion = (fraId: FraId): PlaceSuggestion[] => {
    const node = network.node(fraId);
    return node ? [{ ref: { kind: "node", fraId, railroad: null }, label: node.near, detail: `FRA node ${fraId}`, source: "node" }] : [];
  };

  const suggest = (text: string, role: PlaceRole, limit: number): PlaceSuggestion[] => {
    const q = text.trim().replaceAll("−", "-");
    if (!q || limit <= 0) return [];
    const lower = q.toLowerCase();
    const shops = store.shops
      .all()
      .filter((s) => s.name.toLowerCase().includes(lower) || !!s.code?.toLowerCase().includes(lower))
      .sort((x, y) => Number(!startsWith(x, lower)) - Number(!startsWith(y, lower)))
      .map(shopSuggestion);
    const codes = store.codes.search(q, limit).map(codeSuggestion);
    const cities = network.cities(q, limit).map(citySuggestion);
    // Only the explicit "FRA 358070" form: a bare number is a company code, and Enter picks the first suggestion.
    const fra = FRA_TEXT.exec(q)?.[1] ?? null;
    const nodes = fra ? nodeSuggestion(Number(fra) as FraId) : [];
    const ordered = role === "shop" ? [...shops, ...codes, ...cities, ...nodes] : [...codes, ...cities, ...shops, ...nodes];
    return ordered.slice(0, limit);
  };

  // ---- text ----

  const fromText = (ref: Extract<PlaceRef, { kind: "text" }>, role: PlaceRole): PlaceResolution => {
    const text = ref.text.trim().replaceAll("−", "-");
    if (!text) return problem("empty", "Nothing is filled in.");

    const fra = FRA_TEXT.exec(text);
    if (fra) return atNode(ref, Number(fra[1]) as FraId, null, { method: "node", codeType: null });

    const pair = COORD_TEXT.exec(text);
    if (pair) {
      const [x, y] = [Number(pair[1]), Number(pair[2])];
      const [lon, lat] = inNorthAmerica(x, y) ? [x, y] : inNorthAmerica(y, x) ? [y, x] : [x, y];
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return problem("unknown", `"${ref.text}" is not a longitude and latitude.`);
      return atCoordinates(ref, lon, lat, { method: "coordinates", codeType: null });
    }

    const lists: (() => PlaceResolution | null)[] = [];
    const shopList = () => {
      const shops = store.shops.named(text);
      if (shops.length > 1) return problem("ambiguous", `${shops.length} of Your shops are called "${text}". Pick one.`, shops.map(shopSuggestion));
      return shops.length ? atShop(ref, shops[0]) : null;
    };
    const codeList = () => {
      const codes = store.codes.find(text, null);
      if (codes.length > 1) {
        const sets = codes.map((c) => codeSetLabel(c.codeType)).join(" and ");
        return problem("ambiguous", `"${text}" is a code in ${sets}. Pick the one you mean.`, codes.map(codeSuggestion));
      }
      return codes.length ? atCode(ref, codes[0]) : null;
    };
    const cityList = () => {
      const city = network.city(text);
      return city ? atCity(ref, city) : null;
    };
    if (role === "shop") lists.push(shopList, codeList, cityList);
    else lists.push(codeList, cityList, shopList);
    for (const list of lists) {
      const found = list();
      if (found) return found;
    }

    if (/^\d+$/.test(text)) {
      const node = /^\d{1,9}$/.test(text) ? nodeSuggestion(Number(text) as FraId) : [];
      const fraHint = node.length ? ` If you mean FRA node ${text}, type "FRA ${text}".` : "";
      // Named as an FRA node, for a person to pick on purpose; never among the as-you-type suggestions.
      return problem("unknown", `No code set has the code ${text}.${fraHint}`, [...suggest(text, role, CANDIDATES), ...node].slice(0, CANDIDATES));
    }
    const where = role === "shop" ? "Your shops, the code sets or the city names" : "the code sets, the city names or Your shops";
    return problem("unknown", `Nothing called "${text}" in ${where}.`, suggest(text, role, CANDIDATES));
  };

  const compute = (ref: PlaceRef, role: PlaceRole): PlaceResolution => {
    switch (ref.kind) {
      case "node":
        return atNode(ref, ref.fraId, ref.railroad, { method: "node", codeType: null });
      case "coord":
        return atCoordinates(ref, ref.lon, ref.lat, { method: "coordinates", codeType: null });
      case "shop": {
        const shop = store.shops.get(ref.shopId);
        return shop ? atShop(ref, shop) : problem("removed", "This shop was deleted. Pick another shop.");
      }
      case "code": {
        const [code] = store.codes.find(ref.code, ref.codeType);
        if (code) return atCode(ref, code);
        const known = store.codes.sets().some((s) => s.codeType.toLowerCase() === ref.codeType.toLowerCase());
        return problem(
          "unknown",
          known
            ? `The code set ${codeSetLabel(ref.codeType)} has no code ${ref.code}.`
            : `There is no code set "${ref.codeType}" yet, so ${ref.code} cannot be found. Import the code set on the Shops screen.`,
        );
      }
      case "text":
        return fromText(ref, role);
    }
  };

  return {
    resolve(ref, role) {
      if (memoRevision !== store.revision || memo.size > MEMO_LIMIT) {
        memo.clear();
        memoRevision = store.revision;
      }
      const key = `${role}\u0000${JSON.stringify(ref)}`;
      let answer = memo.get(key);
      if (!answer) {
        answer = compute(ref, role);
        memo.set(key, answer);
      }
      return answer;
    },
    suggest,
    nearest: (lon, lat, withinKm) => network.nearest(lon, lat, withinKm),
  };
}

function startsWith(shop: Shop, lower: string): boolean {
  return shop.name.toLowerCase().startsWith(lower) || !!shop.code?.toLowerCase().startsWith(lower);
}
