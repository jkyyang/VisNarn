/**
 * The map as page tests see it: no WebGL, only what the map was asked to show, and buttons that do
 * what a click on the map would do (a pick, a grey route, a turn-back ring, a car marker). The real
 * map controls are drawn, so undo, redo and the layer choices are the real ones.
 */
import type { ReactElement } from "react";
import type { MapCanvasProps } from "../map/MapCanvas.tsx";
import { MapControls } from "../map/MapControls.tsx";
import type { MapScene } from "../map/scene.ts";

let nextClick = { lon: -97.362, lat: 31.121 };

/** Where the next "click on the map" lands. Defaults to the wye at Temple, TX. */
export function setNextMapClick(lon: number, lat: number): void {
  nextClick = { lon, lat };
}

function describe(scene: MapScene | null | undefined): string {
  if (!scene) return "Map: no scene";
  if (scene.kind === "route") return `Map: route ${scene.selected.id}, ${scene.alternatives.length} grey, ghost ${scene.ghost ? "shown" : "none"}, ${scene.pins.length} pins`;
  if (scene.kind === "fleet") return `Map: ${scene.cars.length} cars${scene.selected ? ", selected route shown" : ""}`;
  return `Map: ${scene.pins.length} shops`;
}

export default function FakeMapCanvas({ content, layers, onLayers, look }: MapCanvasProps): ReactElement {
  const scene = content?.scene;
  const select = content?.onSelect;
  return (
    <div data-testid="map" data-focus={content?.focus.kind ?? "none"} data-tracks={layers.tracks || content?.forceTracks ? "on" : "off"} data-basemap={layers.basemap}>
      <p>{describe(scene)}</p>
      {content?.onPick && (
        <button type="button" onClick={() => content.onPick?.(nextClick.lon, nextClick.lat, 5)}>
          Click the map
        </button>
      )}
      {scene?.kind === "route" &&
        scene.alternatives.map((route) => (
          <button key={route.id} type="button" onClick={() => select?.({ kind: "option", id: route.id })}>
            Grey route {route.id}
          </button>
        ))}
      {scene?.kind === "route" &&
        scene.turnBacks.map((t) => (
          <button key={t.index} type="button" onClick={() => select?.({ kind: "turn-back", index: t.index })}>
            Turn-back ring {t.index + 1}
          </button>
        ))}
      {scene?.kind === "fleet" &&
        scene.cars.map((car) => (
          <button key={car.row} type="button" onClick={() => select?.({ kind: "car", row: car.row })}>
            Car {car.carId} on the map
          </button>
        ))}
      <MapControls layers={layers} onLayers={onLayers} tracksForced={!!content?.forceTracks} look={look} onZoom={() => {}} onFit={() => {}} history={content?.history ?? null} />
    </div>
  );
}
