/**
 * Rail network graph, unpacked from public/data/graph.bin (built by pipeline/export_web_graph.py).
 *
 * INTERNAL to engine/. Everything here is addressed by node and edge index, and an index is only
 * valid for one build of graph.bin. Nothing outside engine/ may import this file (the import rules in
 * scripts/architecture.test.ts fail if it does): the rest of the app speaks FRA ids and coordinates,
 * through engine/index.ts.
 *
 * Binary layout: see pipeline/export_web_graph.py. Line masks (edges and the node mainline mask) have one
 * bit per line in LINES order; graph_meta.json "lines" records the order the file was built with.
 */
import { haversineKm } from "../../shared/geo.ts";
import type { FraId } from "../../shared/places.ts";
import { LINES, RAILROADS } from "../../shared/railroads.ts";
import { NEAR_CITY_KM, SERVE_SLACK_KM, SNAP_KM } from "../rules.ts";

export const REGIONAL = LINES.indexOf("regional");
export const SHORT_LINE = LINES.indexOf("short line");

export const ALL_RAILROADS_MASK = (1 << RAILROADS.length) - 1;
export const ALL_LINES_MASK = (1 << LINES.length) - 1;

/** graph.bin edge flags. */
const YARD_FLAG = 1;
/** Owned by a passenger, commuter or transit agency (pipeline/railroad_classes.py PASSENGER). */
const PASSENGER_FLAG = 2;

/** The track a route may use: lines by bit (LINES order), and whether passenger-owned track counts. */
export interface Track {
  allowedMask: number;
  passenger: boolean;
}

export interface GraphMeta {
  /** The line bit order graph.bin was built with. */
  lines: string[];
  pad: number;
  subdivs: string[];
  fra_ids: number[];
  places: Record<string, [number, number]>;
}

export interface Point {
  label: string;
  lon: number;
  lat: number;
  /** Exact graph node (an index) when the point is a network node. */
  node?: number;
  /** Railroad index: only this railroad may serve the point ("Which line?" at a place where several meet). */
  only?: number;
  /** A shop wired to the track: it joins the network only at these nodes, each over `km` of its own track. */
  links?: { node: number; km: number }[];
}

/** Where a point meets the network: on line `line` at `node`, after `km` of the point's own track (0 unless it is linked). */
export interface Entry {
  line: number;
  node: number;
  km: number;
}

export class RailGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly lon: Float32Array;
  readonly lat: Float32Array;
  /** Bit i set = line i has mainline touching this node. Used for snapping places. */
  readonly mainMask: Uint8Array;
  /** mainMask, without lines that reach this node on passenger-owned track only. */
  readonly freightMainMask: Uint8Array;
  /** Bit i set = line i has any track at this node. Used for interchanges. */
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
  /** 1 = owned by a passenger agency: used only when the route allows passenger-owned track. */
  readonly edgePassenger: Uint8Array;
  /** CSR adjacency: edges of node n are adj[adjOffset[n] .. adjOffset[n+1]). */
  readonly adjOffset: Uint32Array;
  readonly adj: Uint32Array;
  readonly meta: GraphMeta;
  private readonly fraIndex: Map<number, number>;

  constructor(buf: ArrayBuffer, meta: GraphMeta) {
    if (meta.lines.join() !== LINES.join()) throw new Error(`graph lines ${meta.lines} do not match app ${LINES}`);
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
    this.edgeYard = flags.map((f) => f & YARD_FLAG);
    this.edgePassenger = flags.map((f) => (f & PASSENGER_FLAG ? 1 : 0));
    if (o !== buf.byteLength) throw new Error(`graph.bin size mismatch: read ${o} of ${buf.byteLength} bytes`);

    this.lon = new Float32Array(n);
    this.lat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.lon[i] = ll[2 * i];
      this.lat[i] = ll[2 * i + 1];
    }

    this.atMask = new Uint8Array(n);
    const freightAtMask = new Uint8Array(n);
    this.yardNode = new Uint8Array(n);
    for (let k = 0; k < e; k++) {
      if (flags[k] & YARD_FLAG) this.yardNode[this.edgeU[k]] = this.yardNode[this.edgeV[k]] = 1;
    }
    const off = new Uint32Array(n + 1);
    for (let k = 0; k < e; k++) {
      const u = this.edgeU[k], v = this.edgeV[k];
      off[u + 1]++;
      off[v + 1]++;
      this.atMask[u] |= this.edgeMask[k];
      this.atMask[v] |= this.edgeMask[k];
      if (!this.edgePassenger[k]) {
        freightAtMask[u] |= this.edgeMask[k];
        freightAtMask[v] |= this.edgeMask[k];
      }
    }
    this.freightMainMask = this.mainMask.map((mask, i) => mask & freightAtMask[i]);
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

  /** Nearest node; with needMask, only nodes where one of those lines is in `mainline` (by default, has mainline there). */
  nearestNode(lon: number, lat: number, needMask = 0, maxKm = Infinity, mainline = this.mainMask): { node: number; km: number } | null {
    let best = -1;
    let bd = Infinity;
    const cl = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < this.nodeCount; i++) {
      if (needMask && !(mainline[i] & needMask)) continue;
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
    return bd < NEAR_CITY_KM ? best : `${Math.round(bd)} km from ${best}`;
  }

  /** Where a point meets the network on the allowed lines: at its links, at its own node, or where its coordinates snap. */
  serving(p: Point, track: Track, maxKm = SNAP_KM): Entry[] {
    if (p.links) return p.links.flatMap(({ node, km }) => this.linesAt(node, p.only, track).map((line) => ({ line, node, km })));
    if (p.node !== undefined) return this.linesAt(p.node, p.only, track).map((line) => ({ line, node: p.node!, km: 0 }));
    // "Which line?" names the railroad on purpose, so it keeps the plain distance limit.
    if (p.only !== undefined) {
      const near = this.nearestNode(p.lon, p.lat, 1 << p.only, maxKm, this.mainline(track));
      return near ? [{ line: p.only, node: near.node, km: 0 }] : [];
    }
    return this.servingNear(p.lon, p.lat, track, maxKm).map(({ line, node }) => ({ line, node, km: 0 }));
  }

  /** The allowed lines with track at a node, or only line `only`. */
  private linesAt(node: number, only: number | undefined, track: Track): number[] {
    const lines: number[] = [];
    for (let c = 0; c < LINES.length; c++) if ((only === undefined || only === c) && this.atMask[node] & track.allowedMask & (1 << c)) lines.push(c);
    return lines;
  }

  /** Each allowed line whose mainline is within `maxKm` and within SERVE_SLACK_KM of the nearest allowed one. */
  servingNear(lon: number, lat: number, track: Track, maxKm = SNAP_KM): { line: number; node: number; km: number }[] {
    const hits: { line: number; node: number; km: number }[] = [];
    for (let c = 0; c < LINES.length; c++) {
      if (!(track.allowedMask & (1 << c))) continue;
      const hit = this.nearestNode(lon, lat, 1 << c, maxKm, this.mainline(track));
      if (hit) hits.push({ line: c, ...hit });
    }
    const nearest = Math.min(...hits.map((h) => h.km));
    return hits.filter((h) => h.km <= nearest + SERVE_SLACK_KM);
  }

  /** Whether a segment of the `mask` lines that is a line's own track (yard track is the rest) touches `node`. */
  ownTrack(node: number, mask: number): boolean {
    for (let j = this.adjOffset[node]; j < this.adjOffset[node + 1]; j++) {
      const e = this.adj[j];
      if (this.edgeMask[e] & mask && !this.edgeYard[e]) return true;
    }
    return false;
  }

  /**
   * The yard track around `from`, nearest first: each node reached over yard segments of the `mask` lines within
   * `maxKm`, how far along, and the node it was reached from (-1 for `from`). A node on a line's own track ends the
   * walk where it is: it is reached, and the walk goes on past it only when it is `from`.
   */
  *yardWalk(from: number, mask: number, maxKm: number): Generator<{ node: number; km: number; before: number }> {
    const km = new Map([[from, 0]]);
    const before = new Map([[from, -1]]);
    const done = new Set<number>();
    const open = [from];
    while (open.length) {
      open.sort((x, y) => km.get(y)! - km.get(x)!);
      const node = open.pop()!;
      if (done.has(node)) continue;
      done.add(node);
      yield { node, km: km.get(node)!, before: before.get(node)! };
      if (node !== from && this.ownTrack(node, mask)) continue;
      for (let j = this.adjOffset[node]; j < this.adjOffset[node + 1]; j++) {
        const e = this.adj[j];
        if (!(this.edgeMask[e] & mask) || !this.edgeYard[e]) continue;
        const next = this.other(e, node), d = km.get(node)! + this.edgeKm[e];
        if (d <= maxKm && d < (km.get(next) ?? Infinity)) {
          km.set(next, d);
          before.set(next, node);
          open.push(next);
        }
      }
    }
  }

  /**
   * Out of a yard along its own track: the nearest node, over yard segments of the `mask` lines within `maxKm`, that
   * also touches a line's own track (a plant's lead where it meets the main line). A node on such track is its own exit.
   */
  yardExit(from: number, mask: number, maxKm: number): number | null {
    for (const { node } of this.yardWalk(from, mask, maxKm)) if (this.ownTrack(node, mask)) return node;
    return null;
  }

  /**
   * A shop's own track from the point (lon, lat) to `join`, as nodes from its foot to the join: straight from the shop
   * to the foot, then back along the yard walk from the join. The foot is the node of that walk nearest the shop with
   * the straight piece and the yard track together within `maxKm`, the one less far along on a tie; with none, the
   * join itself. Another line's own track is never part of it. `km` is the straight piece plus the yard track.
   */
  lead(lon: number, lat: number, join: number, mask: number, maxKm: number): { nodes: number[]; km: number } {
    const walked = new Map<number, number>();
    let foot = { node: join, straight: haversineKm(lon, lat, this.lon[join], this.lat[join]), km: 0 };
    let found = false;
    for (const { node, km, before } of this.yardWalk(join, mask, maxKm)) {
      walked.set(node, before);
      if (node !== join && this.ownTrack(node, mask)) continue;
      const straight = haversineKm(lon, lat, this.lon[node], this.lat[node]);
      // The walk comes nearest first, so on a tie the foot already found is the one less far along.
      if (straight + km <= maxKm && (!found || straight < foot.straight)) {
        foot = { node, straight, km };
        found = true;
      }
    }
    const nodes = [foot.node];
    while (nodes[nodes.length - 1] !== join) nodes.push(walked.get(nodes[nodes.length - 1])!);
    return { nodes, km: foot.straight + foot.km };
  }

  /**
   * The piece of network joined to these nodes over this track, ignoring direction and railroad changes:
   * `has[n]` is 1 for each node in it. No route on this track joins two different pieces.
   */
  piece(from: Iterable<number>, track: Track): { has: Uint8Array; size: number } {
    const has = new Uint8Array(this.nodeCount);
    const queue = new Uint32Array(this.nodeCount);
    let size = 0;
    for (const node of from) if (!has[node]) has[(queue[size++] = node)] = 1;
    for (let head = 0; head < size; head++) {
      const node = queue[head];
      for (let j = this.adjOffset[node]; j < this.adjOffset[node + 1]; j++) {
        const e = this.adj[j];
        if (!(this.edgeMask[e] & track.allowedMask) || (!track.passenger && this.edgePassenger[e])) continue;
        const next = this.other(e, node);
        if (!has[next]) has[(queue[size++] = next)] = 1;
      }
    }
    return { has, size };
  }

  /** Node mainline masks for this track: a place snaps only to mainline the route may use. */
  private mainline(track: Track): Uint8Array {
    return track.passenger ? this.mainMask : this.freightMainMask;
  }
}
