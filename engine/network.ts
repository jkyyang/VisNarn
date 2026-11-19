/**
 * The rail network as the rest of the app may see it: nodes by FRA id, places by coordinates and
 * public city names. The index-addressed graph stays behind this interface.
 */
import { haversineKm, round5, roundLngLat, type LngLat } from "../shared/geo.ts";
import { SHOP_LINK_MAX_KM, type FraId, type NetworkNode } from "../shared/places.ts";
import { RAILROADS, type Railroad } from "../shared/railroads.ts";
import { ALL_LINES_MASK, ALL_RAILROADS_MASK, RailGraph, type GraphMeta } from "./core/graph.ts";


export interface City {
  name: string;
  lon: number;
  lat: number;
}

/** Where coordinates meet the network: each Class I whose mainline is within SNAP_KM (./rules.ts) and about as close as the nearest. */
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
  /** The node on Class I track nearest to a point; null when none is within `withinKm`. */
  nearest(lon: number, lat: number, withinKm: number): NetworkNode | null;
  /** Null: no freight mainline within SNAP_KM, so a car cannot be routed to or from here. */
  snap(lon: number, lat: number): Snap | null;
  /**
   * Where a shop at this point most likely joins the network: from the nearest Class I node, along yard track to
   * the first node on a line's own track (a plant's lead to the main line). `km` is the straight distance to it;
   * null when no Class I track is within SHOP_LINK_MAX_KM.
   */
  wayIn(lon: number, lat: number): NetworkNode | null;
  /**
   * A shop's own track from this point to the node `fraId`, as graph.ts `lead` finds it within SHOP_LINK_MAX_KM:
   * shop first, then node by node from its foot in the yard to the join. Null for a node this network lacks.
   */
  lead(lon: number, lat: number, fraId: FraId): { path: LngLat[]; km: number } | null;
  /** One of the public city names shipped with the network, matched exactly (case-insensitive). */
  city(name: string): City | null;
  /** City names for autocomplete: those starting with the text first, then those containing it. */
  cities(text: string, limit: number): City[];
  /** "Temple, TX", or "72 km from Jacksonville, FL" when no city is within NEAR_CITY_KM. */
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
    wayIn(lon, lat) {
      const near = graph.nearestNode(lon, lat, ALL_RAILROADS_MASK, SHOP_LINK_MAX_KM, graph.atMask);
      if (!near) return null;
      // The walk spends what the nearest node left of the reach, so the way in is within reach of the point too.
      const node = graph.yardExit(near.node, ALL_RAILROADS_MASK, SHOP_LINK_MAX_KM - near.km) ?? near.node;
      return nodeView(node, haversineKm(lon, lat, graph.lon[node], graph.lat[node]));
    },
    lead(lon, lat, fraId) {
      const join = graph.indexOf(fraId);
      if (join < 0) return null;
      const { nodes, km } = graph.lead(lon, lat, join, ALL_RAILROADS_MASK, SHOP_LINK_MAX_KM);
      return { path: [roundLngLat(lon, lat), ...nodes.map((node) => roundLngLat(graph.lon[node], graph.lat[node]))], km };
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
 * The index-addressed graph behind a network. For engine/trip.ts and engine/track.ts only: engine/index.ts does not
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
