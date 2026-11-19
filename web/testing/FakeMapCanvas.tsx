/**
 * The map as page tests see it: no WebGL, only what the map was asked to show, and buttons that do
 * what a click on the map would do (a click on empty map, on a grey route, on a shop square) or a drag
 * of a handle to the next click's spot. The real pills, turn-back marks and map controls are drawn, so
 * those are the real ones; the carrier shown in colour is on the map as data-carrier.
 */
import { useState, type ReactElement } from "react";
import type { Railroad } from "../../shared/railroads.ts";
import type { MapCanvasProps } from "../map/MapCanvas.tsx";
import { MapControls } from "../map/MapControls.tsx";
import { PillFace, TurnBackMark } from "../map/RouteMarkFaces.tsx";
import type { MapScene } from "../map/scene.ts";

const TEMPLE_WYE = { lon: -97.362, lat: 31.121 };
let nextClick = TEMPLE_WYE;

/** Where the next "click on the map" lands, until the next call. With no point: the wye at Temple, TX. */
export function setNextMapClick(lon = TEMPLE_WYE.lon, lat = TEMPLE_WYE.lat): void {
  nextClick = { lon, lat };
}

function describe(scene: MapScene | null | undefined): string {
  if (!scene) return "Map: no scene";
  if (scene.kind === "route") {
    const places = scene.pins.filter((pin) => pin.kind !== "shop").length;
    return `Map: route ${scene.selected?.id ?? "none"}, ${scene.alternatives.length} grey, ${places} pins, ${scene.pills.length} pills`;
  }
  const links = scene.links.map((link, i) => `link ${i + 1}${link.look === "set" ? "" : ` ${link.look}`}`);
  return `Map: ${scene.pins.filter((pin) => pin.kind === "shop").length} shops${links.length ? `, ${links.join(", ")}` : ""}`;
}

export default function FakeMapCanvas({ content, layers, onLayers, look, found }: MapCanvasProps): ReactElement {
  const scene = content?.scene ?? null;
  const select = content?.onSelect;
  const [preview, setPreview] = useState<Railroad | null>(null);
  return (
    <div
      data-testid="map"
      data-focus={content?.focus.kind ?? "none"}
      data-tracks={layers.tracks ? "on" : "off"}
      data-basemap={layers.basemap}
      data-carrier={preview ?? layers.carrier ?? undefined}
    >
      <p>{describe(scene)}</p>
      {found && <p>Found: {found.suggestion.label}</p>}
      {content?.onPick && (
        <button type="button" onClick={() => content.onPick?.(nextClick.lon, nextClick.lat, 5, null)}>
          Click the map
        </button>
      )}
      {scene?.kind === "route" &&
        scene.alternatives.map((route) => (
          <button key={route.id} type="button" onClick={() => (content?.onPick ? content.onPick(nextClick.lon, nextClick.lat, 5, route.id) : select?.({ kind: "option", id: route.id }))}>
            Grey route {route.id}
          </button>
        ))}
      {scene &&
        scene.pins.map((pin) =>
          pin.shopId ? (
            <button key={pin.shopId} type="button" onClick={() => pin.shopId && select?.({ kind: "place", ref: { kind: "shop", shopId: pin.shopId }, position: pin.position })}>
              Shop square {pin.label}
            </button>
          ) : (
            <button key={`row-${pin.row}`} type="button" onClick={() => pin.row !== null && select?.({ kind: "row", index: pin.row })}>
              Pin {pin.label}
            </button>
          ),
        )}
      {content?.handles?.length ? <p>Handles: {content.handles.map((handle) => handle.label).join(", ")}</p> : null}
      {content?.handles?.map(
        (handle) =>
          handle.onDrop && (
            <button
              key={handle.id}
              type="button"
              onClick={() => {
                handle.onDrag?.([nextClick.lon, nextClick.lat]);
                handle.onDrop?.([nextClick.lon, nextClick.lat]);
              }}
            >
              Drag {handle.label}
            </button>
          ),
      )}
      {scene?.kind === "route" && scene.pills.map((pill) => <PillFace key={pill.id} pill={pill} corner={null} onSelect={() => select?.({ kind: "option", id: pill.id })} />)}
      {scene?.kind === "route" && scene.turnBacks.map((turnBack, i) => <TurnBackMark key={i} turnBack={turnBack.turnBack} />)}
      <MapControls layers={layers} onLayers={onLayers} look={look} onPreview={setPreview} onZoom={() => {}} onReset={() => {}} />
    </div>
  );
}
