/** The Class I mainline drawn under every route: a static file, the only network data the browser holds. */
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import { useEffect, useState } from "react";

/** One feature per owning railroad. */
export type Mainline = FeatureCollection<LineString | MultiLineString, { owner: string }>;

let loading: Promise<Mainline | null> | null = null;

function load(): Promise<Mainline | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/basemap_mainline.geojson`)
    .then(async (response) => {
      // A dev server answers a missing file with the page's HTML and status 200.
      if (!response.ok || response.headers.get("content-type")?.startsWith("text/html")) return null;
      const data = (await response.json()) as Mainline;
      return data?.type === "FeatureCollection" ? data : null;
    })
    .catch(() => {
      // Asked again on the next mount: the file may be built by then.
      loading = null;
      return null;
    });
  return loading;
}

/** Null until public/data/basemap_mainline.geojson has loaded; the map shows its tiles meanwhile. */
export function useBasemap(): Mainline | null {
  const [network, setNetwork] = useState<Mainline | null>(null);
  useEffect(() => {
    // The page shell renders before the map needs the network; tests and browsers without WebGL never draw it.
    if (typeof window === "undefined" || !("WebGLRenderingContext" in window)) return;
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
