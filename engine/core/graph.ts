/**
 * Rail network graph, unpacked from public/data/graph.bin (built by pipeline/export_web_graph.py).
 *
 * INTERNAL to engine/. Everything here is addressed by node and edge index, and an index is only
 * valid for one build of graph.bin. Nothing outside engine/ may import this file (the import rules in
 * scripts/architecture.test.ts fail if it does): the rest of the app speaks FRA ids and coordinates,
 * through engine/index.ts.
 *
 * Binary layout (little-endian):
 *   uint32 nNodes, uint32 nEdges
 *   float32[nNodes*2] lon,lat        uint8[nNodes] mainline railroad mask   (+ pad bytes)
 *   uint32[nEdges] u   uint32[nEdges] v   float32[nEdges] km
 *   uint8[nEdges] railroad mask       uint16[nEdges] subdivision index
 *   uint16[nEdges] heading leaving u  uint16[nEdges] heading leaving v   (degrees, 0 = north)
 *   uint8[nEdges] flags (bit 0 = yard track)
 */
import { haversineKm } from "../../shared/geo.ts";
import type { FraId } from "../../shared/places.ts";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";

export const ALL_RAILROADS_MASK = (1 << RAILROADS.length) - 1;

/** Railroads as the bit mask graph.bin uses. */
export const maskOf = (railroads: readonly Railroad[]): number =>
  railroads.reduce((mask, railroad) => mask | (1 << RAILROADS.indexOf(railroad)), 0);

/** Coordinates snap to a railroad's mainline only within this distance. */
export const MAX_SNAP_KM = 15;

/**
 * A railroad serves coordinates only when its mainline is about as close as the nearest one: within this
 * many km of the nearest railroad's distance. A shop 1 km from CN track is not served by a CPKC line 14 km
 * away, so a route must not end there (Oakville, ON, 2026-11-17).
 */
export const SERVE_SLACK_KM = 5;

export interface GraphMeta {
  railroads: string[];
  pad: number;
  subdivs: string[];
  fra_ids: number[];
  places: Record<string, [number, number]>;
}

export interface Point {
  label: string;
  lon: number;
  lat: number;
  /** Exact graph node (an index), when the point is a network node and not just coordinates. */
  node?: number;
  /** Railroad index: only this railroad may serve the point ("Which line?" at a place where several meet). */
  only?: number;
}

export class RailGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly lon: Float32Array;
  readonly lat: Float32Array;
  /** Bit i set = railroad i has mainline touching this node. Used for snapping places. */
  readonly mainMask: Uint8Array;
  /** Bit i set = railroad i has any track at this node. Used for interchanges. */
  readonly atMask: Uint8Array;
  readonly edgeU: Uint32Array;
  readonly edgeV: Uint32Array;
  readonly edgeKm: Float32Array;
  readonly edgeMask: Uint8Array;
  readonly edgeSubdiv: Uint16Array;
  /** Compass heading (degrees) of the track as it leaves edgeU / edgeV, over its first ~0.2 km. */
  readonly headU: Uint16Array;
  readonly headV: Uint16Array;
  /** 1 = node touches yard track. */
  readonly yardNode: Uint8Array;
  /** 1 = this segment is yard track. A car may only change direction between two yard segments. */
  readonly edgeYard: Uint8Array;
  /** CSR adjacency: edges of node n are adj[adjOffset[n] .. adjOffset[n+1]). */
  readonly adjOffset: Uint32Array;
  readonly adj: Uint32Array;
  readonly meta: GraphMeta;
  private readonly fraIndex: Map<number, number>;

  constructor(buf: ArrayBuffer, meta: GraphMeta) {
    if (meta.railroads.join() !== RAILROADS.join()) {
      throw new Error(`graph railroads ${meta.railroads} do not match app ${RAILROADS}`);
    }
    this.meta = meta;
    const [n, e] = new Uint32Array(buf, 0, 2);
    this.nodeCount = n;
    this.edgeCount = e;
    let o = 8;
    // slice() copies, so typed arrays are always aligned regardless of offset.
    const ll = new Float32Array(buf.slice(o, (o += n * 8)));
    this.mainMask = new Uint8Array(buf.slice(o, (o += n)));
    o += meta.pad;
    this.edgeU = new Uint32Array(buf.slice(o, (o += e * 4)));
    this.edgeV = new Uint32Array(buf.slice(o, (o += e * 4)));
    this.edgeKm = new Float32Array(buf.slice(o, (o += e * 4)));
    this.edgeMask = new Uint8Array(buf.slice(o, (o += e)));
    this.edgeSubdiv = new Uint16Array(buf.slice(o, (o += e * 2)));
    this.headU = new Uint16Array(buf.slice(o, (o += e * 2)));
    this.headV = new Uint16Array(buf.slice(o, (o += e * 2)));
    const flags = new Uint8Array(buf.slice(o, (o += e)));
    this.edgeYard = flags.map((f) => f & 1);
    if (o !== buf.byteLength) throw new Error(`graph.bin size mismatch: read ${o} of ${buf.byteLength} bytes`);

    this.lon = new Float32Array(n);
    this.lat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.lon[i] = ll[2 * i];
      this.lat[i] = ll[2 * i + 1];
    }

    this.atMask = new Uint8Array(n);
    this.yardNode = new Uint8Array(n);
    for (let k = 0; k < e; k++) {
      if (flags[k] & 1) this.yardNode[this.edgeU[k]] = this.yardNode[this.edgeV[k]] = 1;
    }
    const off = new Uint32Array(n + 1);
    for (let k = 0; k < e; k++) {
      const u = this.edgeU[k], v = this.edgeV[k];
      off[u + 1]++;
      off[v + 1]++;
      this.atMask[u] |= this.edgeMask[k];
      this.atMask[v] |= this.edgeMask[k];
    }
    for (let i = 0; i < n; i++) off[i + 1] += off[i];
    this.adjOffset = off;
    this.adj = new Uint32Array(2 * e);
    const fill = off.slice(0, n);
    for (let k = 0; k < e; k++) {
      this.adj[fill[this.edgeU[k]]++] = k;
      this.adj[fill[this.edgeV[k]]++] = k;
    }
    this.fraIndex = new Map(meta.fra_ids.map((id, i) => [id, i]));
  }

  other(edge: number, node: number): number {
    return this.edgeU[edge] === node ? this.edgeV[edge] : this.edgeU[edge];
  }

  /** Heading of `edge` as it leaves `node` (one of its two ends). */
  leaving(edge: number, node: number): number {
    return this.edgeU[edge] === node ? this.headU[edge] : this.headV[edge];
  }

  edgeBetween(a: number, b: number): number {
    for (let j = this.adjOffset[a]; j < this.adjOffset[a + 1]; j++) {
      const k = this.adj[j];
      if (this.other(k, a) === b) return k;
    }
    return -1;
  }

  fraId(node: number): FraId {
    return this.meta.fra_ids[node] as FraId;
  }

  /** The node with this FRA id, or -1. The only way from a stable id back to an index. */
  indexOf(fraId: FraId): number {
    return this.fraIndex.get(fraId) ?? -1;
  }

  /** Nearest node; with needMask, only nodes where one of those railroads has mainline. */
  nearestNode(lon: number, lat: number, needMask = 0, maxKm = Infinity): { node: number; km: number } | null {
    let best = -1;
    let bd = Infinity;
    const cl = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < this.nodeCount; i++) {
      if (needMask && !(this.mainMask[i] & needMask)) continue;
      const dx = (this.lon[i] - lon) * cl;
      const dy = this.lat[i] - lat;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const km = haversineKm(lon, lat, this.lon[best], this.lat[best]);
    return km <= maxKm ? { node: best, km } : null;
  }

  nearestPlace(lon: number, lat: number): string {
    let best = "";
    let bd = Infinity;
    for (const [name, [x, y]] of Object.entries(this.meta.places)) {
      const d = haversineKm(lon, lat, x, y);
      if (d < bd) {
        bd = d;
        best = name;
      }
    }
    return bd < 25 ? best : `${Math.round(bd)} km from ${best}`;
  }

  nodePoint(node: number): Point {
    return { label: `FRA node ${this.fraId(node)}`, lon: this.lon[node], lat: this.lat[node], node };
  }

  /** Railroads serving a point → their entry node. Exact nodes use the railroads present there. */
  serving(p: Point, maxKm = MAX_SNAP_KM): Map<number, number> {
    const out = new Map<number, number>();
    if (p.node !== undefined) {
      for (let c = 0; c < RAILROADS.length; c++) {
        if (p.only !== undefined && p.only !== c) continue;
        if (this.atMask[p.node] & (1 << c)) out.set(c, p.node);
      }
      return out;
    }
    // "Which line?" names the railroad on purpose, so it keeps the plain distance limit.
    const near = p.only !== undefined ? this.nearestNode(p.lon, p.lat, 1 << p.only, maxKm) : null;
    if (p.only !== undefined) return near ? new Map([[p.only, near.node]]) : out;
    for (const hit of this.servingNear(p.lon, p.lat, maxKm)) out.set(hit.railroad, hit.node);
    return out;
  }

  /** Each railroad whose mainline is within `maxKm` and within SERVE_SLACK_KM of the nearest one. */
  servingNear(lon: number, lat: number, maxKm = MAX_SNAP_KM): { railroad: number; node: number; km: number }[] {
    const hits: { railroad: number; node: number; km: number }[] = [];
    for (let c = 0; c < RAILROADS.length; c++) {
      const hit = this.nearestNode(lon, lat, 1 << c, maxKm);
      if (hit) hits.push({ railroad: c, ...hit });
    }
    const nearest = Math.min(...hits.map((h) => h.km));
    return hits.filter((h) => h.km <= nearest + SERVE_SLACK_KM);
  }
}
