/** The mainline drawn under every route: a static file, the only network data the browser holds. */
import type { Feature, LineString, MultiLineString } from "geojson";
import { useEffect, useState } from "react";
import { NETWORK_CLASSES, type NetworkClass } from "../../shared/railroads.ts";

/** One feature per owning railroad and class (pipeline/export_basemap.py). */
type MainlineFeature = Feature<LineString | MultiLineString, { owner: string; class: NetworkClass }>;

/** The mainline by class, so each class is drawn as its own layer. */
export type Mainline = Record<NetworkClass, MainlineFeature[]>;

const byClass = (features: MainlineFeature[]) => Object.fromEntries(NETWORK_CLASSES.map((c) => [c, features.filter((f) => f.properties.class === c)])) as Mainline;

let loading: Promise<Mainline | null> | null = null;

function load(): Promise<Mainline | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/basemap_mainline.geojson`)
    .then(async (response) => {
      // A dev server answers a missing file with the page's HTML and status 200.
      if (!response.ok || response.headers.get("content-type")?.startsWith("text/html")) return null;
      const data = (await response.json()) as { type?: string; features: MainlineFeature[] };
      return data?.type === "FeatureCollection" ? byClass(data.features) : null;
    })
    .catch(() => {
      // Asked again on the next mount: the file may be built by then.
      loading = null;
      return null;
    });
  return loading;
}

/** WebGL is what MapLibre and deck.gl draw with; without it there is nothing to load. */
export const canDrawMaps = () => typeof window !== "undefined" && ("WebGL2RenderingContext" in window || "WebGLRenderingContext" in window);

/** Null until public/data/basemap_mainline.geojson has loaded; the map shows its tiles meanwhile. */
export function useBasemap(): Mainline | null {
  const [network, setNetwork] = useState<Mainline | null>(null);
  useEffect(() => {
    // The page shell renders before the map needs the network; tests and browsers without WebGL never draw it.
    if (!canDrawMaps()) return;
    let live = true;
    void load().then((data) => {
      if (live) setNetwork(data);
    });
    return () => {
      live = false;
    };
  }, []);
  return network;
}
