/**
 * Places: how a person or a data source names a location, and what the network makes of it.
 *
 * Two rules hold everywhere outside engine/core:
 * - A place is identified by something that survives a rebuild of the network file: an FRA node id,
 *   coordinates, or a name the user owns (a shop). Never a position in graph.bin.
 * - A name says which list it belongs to.
 */
import { round5, type LngLat } from "./geo.ts";
import type { Railroad } from "./railroads.ts";

/** The public NARN node id. Branded so that a graph index (also a number) cannot be passed as one. */
export type FraId = number & { readonly __brand: "FraId" };
export type ShopId = string & { readonly __brand: "ShopId" };

/** A location as it was given. Stored and sent exactly like this; resolved again every time it is used. */
export type PlaceRef =
  /** Typed by a person, or an import cell read as free text. */
  | { kind: "text"; text: string }
  /** One of Your shops. */
  | { kind: "shop"; shopId: ShopId }
  /** An exact network node, from a map pick. `railroad` is the answer to "Which line?" where several meet. */
  | { kind: "node"; fraId: FraId; railroad: Railroad | null }
  | { kind: "coord"; lon: number; lat: number };

/** What the place is for. It decides which lists a free-text name is looked up in, and in what order. */
export type PlaceRole = "position" | "shop";

/** The part of a resolved place the router needs. */
export interface Waypoint {
  label: string;
  lon: number;
  lat: number;
  /** The exact node, when there is one. Without it the router snaps the coordinates per railroad. */
  fraId: FraId | null;
  /** Only this railroad may serve the waypoint. */
  railroad: Railroad | null;
  /** A shop wired to the track joins the network only at these nodes, each over `km` of its own track; `fraId` is then null. */
  links?: Pick<NetworkNode, "fraId" | "km">[];
}

export interface PlaceMatch {
  /** Which list or syntax the name was found by. */
  method: "node" | "coordinates" | "shop" | "city";
  /** "exact": a network node. "snapped": coordinates moved to the nearest mainline, `snapKm` away. */
  confidence: "exact" | "snapped";
  snapKm: number;
}

export interface ResolvedPlace extends Waypoint {
  ref: PlaceRef;
  /** The nodes a linked shop joins, in the shop's order. */
  links?: NetworkNode[];
  /** Railroads with track here: "served by BNSF and UP". Found from the network, never typed. */
  railroads: Railroad[];
  match: PlaceMatch;
}

export interface PlaceSuggestion {
  /** What to store if the person picks this suggestion: always a typed ref, never text. */
  ref: PlaceRef;
  label: string;
  /** "Your shop · EX-NLR-01", "City", "FRA node 358070". */
  detail: string;
  /** Which list it came from; a network node says what it is: yard track, a junction of railroads, or neither. */
  source: "shop" | "city" | "yard" | "junction" | "node";
  /** Railroads with track there, as resolving the place finds them. */
  railroads: Railroad[];
}

export interface PlaceProblem {
  kind: "empty" | "unknown" | "ambiguous" | "off-network" | "removed";
  message: string;
  /** For "ambiguous" and "unknown": what the person may have meant. */
  candidates: PlaceSuggestion[];
}

export type PlaceResolution = { ok: true; place: ResolvedPlace } | { ok: false; problem: PlaceProblem };

/** The farthest a map click snaps to a node (GET /api/places/nearest). */
export const NEAREST_MAX_KM = 100;

export const resolvedOf = (resolution: PlaceResolution | null | undefined): ResolvedPlace | null => (resolution?.ok ? resolution.place : null);

/** A network node near a map click. */
export interface NetworkNode {
  fraId: FraId;
  lon: number;
  lat: number;
  /** "Temple, TX" or "72 km from Jacksonville, FL". */
  near: string;
  railroads: Railroad[];
  yard: boolean;
  /** Distance from the clicked point, or along its own track from the shop it is a link of. */
  km: number;
}

/** Where a shop's link is to join: that node, or a rough spot on the map, refined to the way in nearest it. */
export type LinkEnd = { fraId: FraId } | { lon: number; lat: number };

/** A shop's link as drawn: the node it joins, and its own track there, shop first (straight to its yard, then node by node). `km` is that track's length. */
export interface ShopLink extends NetworkNode {
  path: LngLat[];
}

/** Where a saved thing sits on the network. Only stable keys. */
export type NodeLocation = { fraId: FraId; railroad: Railroad | null } | { lon: number; lat: number };

/** A saved location as a place reference, so it resolves through the same path as everything else. */
export function refOf(location: NodeLocation): PlaceRef {
  return "fraId" in location
    ? { kind: "node", fraId: location.fraId, railroad: location.railroad }
    : { kind: "coord", lon: location.lon, lat: location.lat };
}

/** What to save for a resolved place: its node when it has one, its coordinates otherwise. */
export function locationOf(place: ResolvedPlace): NodeLocation {
  return place.fraId !== null ? { fraId: place.fraId, railroad: place.railroad } : { lon: round5(place.lon), lat: round5(place.lat) };
}

/** A shop has at most this many links: one is a stub the car backs out of, two make the shop a through track. */
export const SHOP_LINKS_MAX = 2;

/** A shop's own track reaches the network within this distance: the longest link, how far the suggestion looks, and how far from a drop or a tap on the map a link's node may be. */
export const SHOP_LINK_MAX_KM = 5;

/** A destination the user defined. Nothing about any shop is built in. */
export interface Shop {
  id: ShopId;
  name: string;
  /** The user's own code for it, e.g. "NLR-01". A typed place may name the shop by this or by name. */
  code: string | null;
  location: NodeLocation;
  /**
   * The nodes the shop's own track joins the network at, wired by a person like a resistor's leads, in order.
   * Each link runs from the location straight to the shop's yard, then along it to its node (ShopLink). Empty: the location snaps as any place does.
   */
  links: FraId[];
}

/**
 * A shop as the form or an import row submits it. `location` is whatever was given (a node picked on
 * the map, coordinates, or text to look up); saving resolves it once and stores the node or
 * coordinates it came to.
 */
/** Longest shop name or code, the same through the shop form and a file import: longer text breaks map labels. */
export const SHOP_TEXT_MAX = 200;

/**
 * Control, format (zero-width, bidi overrides), line-separator and unpaired-surrogate characters.
 * SQLite cuts text at NUL and swaps a lone surrogate for U+FFFD, and the rest hide or reorder what a
 * person sees, so text holding one could be listed differently from how it was saved. Refused in
 * names, shop codes and route strings, through the forms and a file import alike.
 */
export const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export interface ShopDraft {
  name: string;
  code: string | null;
  location: PlaceRef;
  links: FraId[];
}

/** A shop with what the network says about its location: "Found on the network · served by BNSF and UP", or why not. */
export interface ShopView extends Shop {
  place: PlaceResolution;
}

/** Company data arrives as one of these. Adding the database is a new member here and a new source in server/intake. */
export type UploadSource = { kind: "csv"; fileName: string; text: string };

export interface RowIssue {
  /** 0-based position among the data rows; `line` is the line in the file, for "line 7 matches no node". */
  row: number;
  line: number;
  message: string;
}

/** A preview (commit: false) or the result (commit: true) of importing shops. */
export interface ImportRequest {
  source: UploadSource;
  commit: boolean;
}

export interface ImportReport<T> {
  committed: boolean;
  ready: T[];
  /** Rows that did not match a node, listed for the person to fix. They are never saved. */
  issues: RowIssue[];
}
