/**
 * The rail network as the rest of the app may see it: nodes by FRA id, places by coordinates and
 * public city names. The index-addressed graph stays behind this interface.
 */
import { round5 } from "../shared/geo.ts";
import type { FraId, NetworkNode } from "../shared/places.ts";
import { RAILROADS, type Railroad } from "../shared/railroads.ts";
import { ALL_LINES_MASK, ALL_RAILROADS_MASK, MAX_SNAP_KM, RailGraph, type GraphMeta } from "./core/graph.ts";

export { MAX_SNAP_KM };

export interface City {
  name: string;
  lon: number;
  lat: number;
}

/** Where coordinates meet the network: each Class I whose mainline is within MAX_SNAP_KM and about as close as the nearest. */
export interface Snap {
  /** Empty when only a regional railroad or a short line is that close. */
  railroads: Railroad[];
  /** Distance to the nearest of those mainlines (or of the regional / short-line one). */
  km: number;
}

export interface RailNetwork {
  /** Identifies this build of graph.bin (a hash of its bytes). Two networks with one version route alike. */
  readonly version: string;
  /** The node with this id, or null if this build of the network has none. `km` is 0. */
  node(fraId: FraId): NetworkNode | null;
  /** The node nearest to a point, on any Class I track; null when none is within `withinKm`. */
  nearest(lon: number, lat: number, withinKm: number): NetworkNode | null;
  /** Null: no freight mainline within MAX_SNAP_KM, so a car cannot be routed to or from here. */
  snap(lon: number, lat: number): Snap | null;
  /** One of the public city names shipped with the network, matched exactly (case-insensitive). */
  city(name: string): City | null;
  /** City names for autocomplete: those starting with the text first, then those containing it. */
  cities(text: string, limit: number): City[];
  /** "Temple, TX", or "72 km from Jacksonville, FL" when no city is within 25 km. */
  near(lon: number, lat: number): string;
}

/** Unpacks graph.bin. Throws if the file's railroad list is not shared/railroads.ts or its size is wrong. */
export function openNetwork(bin: ArrayBuffer, meta: GraphMeta, version: string): RailNetwork {
  const graph = new RailGraph(bin, meta);
  const allCities: City[] = Object.entries(meta.places)
    .map(([name, [lon, lat]]) => ({ name, lon, lat }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const byName = new Map(allCities.map((c) => [c.name.toLowerCase(), c]));

  const nodeView = (index: number, km: number): NetworkNode => {
    const lon = graph.lon[index], lat = graph.lat[index];
    return {
      fraId: graph.fraId(index),
      lon: round5(lon),
      lat: round5(lat),
      near: graph.nearestPlace(lon, lat),
      railroads: railroadsIn(graph.atMask[index]),
      yard: graph.yardNode[index] === 1,
      km,
    };
  };

  const network: RailNetwork = {
    version,
    node(fraId) {
      const index = graph.indexOf(fraId);
      return index < 0 ? null : nodeView(index, 0);
    },
    nearest(lon, lat, withinKm) {
      const hit = graph.nearestNode(lon, lat, ALL_RAILROADS_MASK, withinKm, graph.atMask);
      return hit ? nodeView(hit.node, hit.km) : null;
    },
    snap(lon, lat) {
      // Any mainline, so a place resolves whatever track the routing rules will allow; the router decides.
      const classI = graph.servingNear(lon, lat, { allowedMask: ALL_RAILROADS_MASK, passenger: true });
      const hits = classI.length ? classI : graph.servingNear(lon, lat, { allowedMask: ALL_LINES_MASK, passenger: true });
      if (!hits.length) return null;
      return { railroads: classI.map((h) => RAILROADS[h.line]), km: Math.min(...hits.map((h) => h.km)) };
    },
    city(name) {
      return byName.get(name.trim().toLowerCase()) ?? null;
    },
    cities(text, limit) {
      const q = text.trim().toLowerCase();
      const starts = allCities.filter((c) => c.name.toLowerCase().startsWith(q));
      const contains = allCities.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
      return [...starts, ...contains].slice(0, Math.max(0, limit));
    },
    near(lon, lat) {
      return graph.nearestPlace(lon, lat);
    },
  };
  cores.set(network, graph);
  return network;
}

const cores = new WeakMap<RailNetwork, RailGraph>();

/**
 * The index-addressed graph behind a network. For engine/trip.ts only: engine/index.ts does not
 * export it, so nothing outside engine/ can reach an index.
 */
export function coreOf(network: RailNetwork): RailGraph {
  const graph = cores.get(network);
  if (!graph) throw new Error("This network was not opened by openNetwork().");
  return graph;
}

function railroadsIn(mask: number): Railroad[] {
  return RAILROADS.filter((_r, i) => mask & (1 << i));
}
