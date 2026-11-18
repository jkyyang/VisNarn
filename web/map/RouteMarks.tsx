/**
 * The marks over the route that are HTML, not deck.gl: a small rounded pill per route, beside its line
 * where the routes part (the selected one filled, the others saying how they differ), and an amber disc at each turn-back
 * with its details on hover or tap. MapLibre positions them as markers, so they move with the map; the
 * faces themselves are in ./RouteMarkFaces.tsx, which page tests draw without a map.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState, type ReactElement } from "react";
import { Marker, useMap } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import { PILL_HEIGHT_PX, pillWidthPx, placePills, type Box, type PillPlace } from "./pills.ts";
import { PillFace, TurnBackMark } from "./RouteMarkFaces.tsx";
import type { MapScene, SceneTarget } from "./scene.ts";

type RouteScene = Extract<MapScene, { kind: "route" }>;

/** Room the map's own edges take: the round buttons on the right, the attribution at the bottom. */
const EDGE = { side: 8, right: 60, bottom: 28 };

const centred = (x: number, y: number, size: number): Box => ({ left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2 });

/** Where each pill goes on screen now, given the route lines, the pins, the turn-backs, the legend and the map buttons. */
function layout(map: MapLibreMap, scene: RouteScene): PillPlace[] {
  const container = map.getContainer();
  const frame = container.getBoundingClientRect();
  const point = (at: LngLat) => map.project(at);
  const view: Box = { left: EDGE.side, top: EDGE.side, right: container.clientWidth - EDGE.right, bottom: container.clientHeight - EDGE.bottom };

  const obstacles: Box[] = [];
  for (const pin of scene.pins) {
    const { x, y } = point(pin.position);
    if (pin.kind === "destination") obstacles.push({ left: x - 14, top: y - 34, right: x + 14, bottom: y });
    else obstacles.push(centred(x, y, pin.kind === "shop" ? 14 : 24));
  }
  for (const turnBack of scene.turnBacks) {
    const { x, y } = point(turnBack.position);
    obstacles.push(centred(x, y, 26));
  }
  const overlays = container.closest(".map-canvas")?.querySelectorAll(".legend, .map-controls > *") ?? [];
  for (const element of overlays) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) obstacles.push({ left: rect.left - frame.left, top: rect.top - frame.top, right: rect.right - frame.left, bottom: rect.bottom - frame.top });
  }

  const routes = scene.selected ? [scene.selected, ...scene.alternatives] : scene.alternatives;
  const lines = routes.flatMap((route) => route.legs.map((leg) => leg.path.map(point)));
  const asks = scene.pills.map((pill) => ({ id: pill.id, width: pillWidthPx(pill.text, pill.turnBacks), height: PILL_HEIGHT_PX, anchors: pill.anchors.map(point) }));
  return placePills(asks, obstacles, view, lines);
}

/** The pills and turn-back discs of a route scene, as map markers. Must be a child of the map. */
export function RouteMarks(props: { scene: RouteScene; onSelect: (target: SceneTarget) => void }): ReactElement | null {
  const { scene } = props;
  const map = useMap().current;
  const [placed, setPlaced] = useState<PillPlace[]>([]);

  useEffect(() => {
    if (!map) return;
    const instance = map.getMap();
    let frame = 0;
    const update = () => {
      frame = 0;
      setPlaced(scene.pills.length ? layout(instance, scene) : []);
    };
    // At most once a frame while the map moves.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    instance.on("move", schedule);
    instance.on("resize", schedule);
    instance.on("load", schedule);
    return () => {
      instance.off("move", schedule);
      instance.off("resize", schedule);
      instance.off("load", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [map, scene]);

  if (!scene.pills.length && !scene.turnBacks.length) return null;
  return (
    <>
      {placed.map((place) => {
        const pill = scene.pills.find((p) => p.id === place.id);
        const at = pill?.anchors[place.anchor];
        if (!pill || !at) return null;
        return (
          <Marker key={pill.id} longitude={at[0]} latitude={at[1]} anchor="center" className={`route-mark${pill.selected ? " route-mark--selected" : ""}`}>
            <div className="route-mark-anchor">
              <PillFace pill={pill} corner={place.corner} onSelect={() => props.onSelect({ kind: "option", id: pill.id })} />
            </div>
          </Marker>
        );
      })}
      {scene.turnBacks.map((turnBack, i) => (
        <Marker key={`turn-${i}`} longitude={turnBack.position[0]} latitude={turnBack.position[1]} anchor="center" className="route-mark route-mark--turn">
          <TurnBackMark turnBack={turnBack.turnBack} />
        </Marker>
      ))}
    </>
  );
}
