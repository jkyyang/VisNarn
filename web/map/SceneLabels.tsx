/**
 * Names on the map for the scene: each shop's beside its marker, and each interchange's by its node on the
 * selected route. MapLibre draws them as its top text layers, over the scene's routes and markers (SCENE_NAMES in
 * ./basemaps.ts), and places them first: where a shop's name and a city's collide, the city's gives way.
 */
import type { FeatureCollection, Point } from "geojson";
import { useMemo, type ReactElement } from "react";
import { Layer, Source, type LayerProps } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import { css, type ThemeColors } from "../theme.ts";
import { nearPlace, shortPlace } from "../words.ts";
import type { MapScene } from "./scene.ts";

type Label = { name: string; kind: "shop" | "interchange"; rank: number };

const label = (position: LngLat, properties: Label) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: position }, properties });

/** "Sarnia", "Chicago": the shops on the map (as places of the plan too), then the selected route's interchanges. The route's ends and the selected shop are placed first. */
export function sceneLabels(scene: MapScene | null): FeatureCollection<Point, Label> {
  const shops = scene?.pins.filter((pin) => pin.mark) ?? [];
  const interchanges = scene?.kind === "route" ? (scene.selected?.interchanges ?? []) : [];
  return {
    type: "FeatureCollection",
    features: [
      ...shops.map((pin) => label(pin.position, { name: shortPlace(pin.label), kind: "shop", rank: pin.kind !== "shop" || pin.mark?.selected ? 0 : 1 })),
      ...interchanges.filter((x) => x.place).map((x) => label(x.position, { name: nearPlace(x.place), kind: "interchange", rank: 0 })),
    ],
  };
}

/** The mockup's names: semibold, on a halo of the map's paper. A shop's sits beside its marker, an interchange's off its node, away from the line. */
const LOOK = {
  shop: { id: "shop-labels", size: 11.5, anchors: ["left", "right", "top", "bottom"], offsetEm: 1 },
  interchange: { id: "interchange-labels", size: 11, anchors: ["bottom-right", "top-left", "bottom-left", "top-right"], offsetEm: 0.7 },
} as const;

function labelLayer(kind: Label["kind"], colors: ThemeColors): LayerProps {
  const look = LOOK[kind];
  return {
    id: look.id,
    type: "symbol",
    filter: ["==", ["get", "kind"], kind],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": look.size,
      "text-variable-anchor": [...look.anchors],
      "text-radial-offset": look.offsetEm,
      "text-justify": "auto",
      // One line: "near St. Louis".
      "text-max-width": 30,
      "symbol-sort-key": ["get", "rank"],
    },
    paint: { "text-color": css(colors.fg), "text-halo-color": css(colors.casing), "text-halo-width": 1.5 },
  };
}

export function SceneLabels({ scene, colors }: { scene: MapScene | null; colors: ThemeColors }): ReactElement {
  const data = useMemo(() => sceneLabels(scene), [scene]);
  return (
    <Source id="scene-labels" type="geojson" data={data}>
      <Layer {...labelLayer("shop", colors)} />
      <Layer {...labelLayer("interchange", colors)} />
    </Source>
  );
}
