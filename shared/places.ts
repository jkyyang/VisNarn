/**
 * Places: how a person or a data source names a location, and what the network makes of it.
 *
 * Two rules hold everywhere outside engine/core:
 * - A place is identified by something that survives a rebuild of the network file: an FRA node id,
 *   coordinates, or a name the user owns (a shop, a company code). Never a position in graph.bin.
 * - A name says which list it belongs to. A company code is looked up in its own code set and
 *   nowhere else, so a 6-digit code can never turn into the FRA node that happens to share its digits.
 */
import { round5 } from "./geo.ts";
import type { Railroad } from "./railroads.ts";
import type { Instant } from "./time.ts";

/** The public NARN node id. Branded so that a graph index (also a number) cannot be passed as one. */
export type FraId = number & { readonly __brand: "FraId" };
export type ShopId = string & { readonly __brand: "ShopId" };
/** A user-defined set of location codes, e.g. "splc" or "station". No code set is built in. */
export type CodeType = string;

/** A location as it was given. Stored and sent exactly like this; resolved again every time it is used. */
export type PlaceRef =
  /** Typed by a person, or an import cell read as free text. */
  | { kind: "text"; text: string }
  /** One of Your shops. */
  | { kind: "shop"; shopId: ShopId }
  /** A company location code in a named code set. */
  | { kind: "code"; codeType: CodeType; code: string }
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
}

export interface PlaceMatch {
  /** Which list or syntax the name was found by. */
  method: "node" | "coordinates" | "shop" | "code" | "city";
  codeType: CodeType | null;
  /** "exact": a network node. "snapped": coordinates moved to the nearest mainline, `snapKm` away. */
  confidence: "exact" | "snapped";
  snapKm: number;
}

export interface ResolvedPlace extends Waypoint {
  ref: PlaceRef;
  /** Railroads with track here: "served by BNSF and UP". Found from the network, never typed. */
  railroads: Railroad[];
  match: PlaceMatch;
  /** One of Your shops marked EXAMPLE: a made-up location, to be named as such wherever it shows. */
  example: boolean;
}

export interface PlaceSuggestion {
  /** What to store if the person picks this suggestion: always a typed ref, never text. */
  ref: PlaceRef;
  label: string;
  /** "Your shop · EX-NLR-01", "SPLC 668240", "City", "FRA node 358070". */
  detail: string;
  /** Which list it came from; a network node says what it is: yard track, a junction of railroads, or neither. */
  source: "shop" | "code" | "city" | "yard" | "junction" | "node";
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

/** A network node near a map click. */
export interface NetworkNode {
  fraId: FraId;
  lon: number;
  lat: number;
  /** "Temple, TX" or "72 km from Jacksonville, FL". */
  near: string;
  railroads: Railroad[];
  yard: boolean;
  /** Distance from the clicked point. */
  km: number;
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

/** A destination the user defined. Nothing about any shop is built in. */
export interface Shop {
  id: ShopId;
  name: string;
  /** The user's own code for it, e.g. "EX-NLR-01". A typed place may name the shop by this or by name. */
  code: string | null;
  location: NodeLocation;
  /** True for the seeded EXAMPLE rows. */
  example: boolean;
}

/**
 * A shop as the form or an import row submits it. `location` is whatever was given (a node picked on
 * the map, coordinates, or text such as a node code to look up); saving resolves it once and stores
 * the node or coordinates it came to.
 */
export interface ShopDraft {
  name: string;
  code: string | null;
  location: PlaceRef;
}

/** A shop with what the network says about its location: "Found on the network · served by BNSF and UP", or why not. */
export interface ShopView extends Shop {
  place: PlaceResolution;
}

export interface CodeSet {
  codeType: CodeType;
  label: string;
  count: number;
  importedAt: Instant;
}

export interface NodeCode {
  codeType: CodeType;
  code: string;
  name: string | null;
  location: NodeLocation;
}

/** Company data arrives as one of these. Adding the database is a new member here and a new source in server/intake. */
export type UploadSource = { kind: "csv"; fileName: string; text: string };

/** Where an import came from. */
export interface SourceInfo {
  kind: "csv" | "database";
  /** "EXAMPLE shops.csv". */
  label: string;
}

export interface RowIssue {
  /** 0-based position among the data rows; `line` is the line in the file, for "line 7 matches no node". */
  row: number;
  line: number;
  message: string;
}

/** A preview (commit: false) or the result (commit: true) of importing shops or codes. */
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
