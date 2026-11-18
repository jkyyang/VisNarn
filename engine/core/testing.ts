/** Test-only: the real network, as index-addressed core objects, for tests of the search itself. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RailGraph, type GraphMeta, type Point } from "./graph.ts";
import { Router } from "./router.ts";

export function loadTestCore(): { graph: RailGraph; router: Router } {
  const file = (name: string) => fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url));
  const bin = readFileSync(file("graph.bin"));
  const meta = JSON.parse(readFileSync(file("graph_meta.json"), "utf8")) as GraphMeta;
  const graph = new RailGraph(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), meta);
  return { graph, router: new Router(graph) };
}

/** A public city name as coordinates, the way the Directory hands a city to the router. */
export function cityPoint(graph: RailGraph, name: string): Point {
  const place = graph.meta.places[name];
  if (!place) throw new Error(`No city named "${name}" in graph_meta.json.`);
  return { label: name, lon: place[0], lat: place[1] };
}

/** A network node as an exact point. */
export function nodePoint(graph: RailGraph, node: number): Point {
  return { label: `FRA node ${graph.fraId(node)}`, lon: graph.lon[node], lat: graph.lat[node], node };
}
