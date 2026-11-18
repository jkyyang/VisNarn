/**
 * The map as page tests see it: no WebGL, only what the map was asked to show, and buttons that do
 * what a click on the map would do (a click on empty map, on a grey route, on a shop square). The real
 * pills, turn-back marks, legend and map controls are drawn, so those are the real ones.
 */
import type { ReactElement } from "react";
import { DEFAULT_INCLUDE, drawnClasses } from "../../shared/railroads.ts";
import type { MapCanvasProps } from "../map/MapCanvas.tsx";
import { MapControls } from "../map/MapControls.tsx";
import { Legend, legendFor } from "../map/Legend.tsx";
import { PillFace, TurnBackMark } from "../map/RouteMarkFaces.tsx";
import type { MapScene } from "../map/scene.ts";

let nextClick = { lon: -97.362, lat: 31.121 };

/** Where the next "click on the map" lands. Defaults to the wye at Temple, TX. */
export function setNextMapClick(lon: number, lat: number): void {
  nextClick = { lon, lat };
}

function describe(scene: MapScene | null | undefined): string {
  if (!scene) return "Map: no scene";
  if (scene.kind === "route") {
    const places = scene.pins.filter((pin) => pin.kind !== "shop").length;
    return `Map: route ${scene.selected?.id ?? "none"}, ${scene.alternatives.length} grey, ${places} pins, ${scene.pills.length} pills`;
  }
  return `Map: ${scene.pins.length} shops`;
}

export default function FakeMapCanvas({ content, layers, onLayers, look }: MapCanvasProps): ReactElement {
  const scene = content?.scene ?? null;
  const select = content?.onSelect;
  return (
    <div data-testid="map" data-focus={content?.focus.kind ?? "none"} data-tracks={layers.tracks ? "on" : "off"} data-basemap={layers.basemap}>
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
        scene.pins.map((pin) =>
          pin.shopId ? (
            <button key={pin.shopId} type="button" onClick={() => pin.shopId && select?.({ kind: "place", ref: { kind: "shop", shopId: pin.shopId }, position: pin.position })}>
              Shop square {pin.label}
            </button>
          ) : null,
        )}
      {scene?.kind === "route" && scene.pills.map((pill) => <PillFace key={pill.id} pill={pill} corner={null} onSelect={() => select?.({ kind: "option", id: pill.id })} />)}
      {scene?.kind === "route" && scene.turnBacks.map((turnBack, i) => <TurnBackMark key={i} turnBack={turnBack.turnBack} />)}
      <MapControls layers={layers} onLayers={onLayers} look={look} onZoom={() => {}} onFit={() => {}} history={content?.history ?? null} />
      <Legend {...legendFor(scene, layers.network ? drawnClasses(content?.include ?? DEFAULT_INCLUDE) : [])} />
    </div>
  );
}
