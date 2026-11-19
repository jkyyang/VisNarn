/**
 * The HTML marks over the route, drawn as DOM markers above the deck.gl canvas: a small rounded pill per route, beside its line
 * where the routes part (the selected one filled, the others saying how they differ), and an amber disc at each turn-back
 * with its details on hover or tap (a small badge beside a pin it would otherwise hide). MapLibre positions them as markers, so they move with the map; the
 * faces themselves are in ./RouteMarkFaces.tsx, which page tests draw without a map.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState, type ReactElement } from "react";
import { Marker, useMap } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import { PIN_BOX } from "./layers.ts";
import { PILL_HEIGHT_PX, pillWidthPx, placePills, turnBackShift, type Box, type PillPlace, type Point } from "./pills.ts";
import { PillFace, TurnBackMark } from "./RouteMarkFaces.tsx";
import type { MapScene, SceneTarget } from "./scene.ts";

type RouteScene = Extract<MapScene, { kind: "route" }>;

/** Room the map's own edges take: the round buttons on the right, the attribution at the bottom. */
const EDGE = { side: 8, right: 60, bottom: 28 };

/** Matches .turn-mark, and .route-mark--badge .turn-mark for the small one beside a pin; with a little air. */
const TURN_MARK_PX = 22;
const TURN_BADGE_PX = 16;

const centred = (x: number, y: number, size: number): Box => ({ left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2 });

interface Placed {
  pills: PillPlace[];
  /** Per turn-back: its shift off a pin it would hide (drawn as a small badge), or null. */
  turns: (Point | null)[];
}

/** Where each pill and turn-back goes on screen now, given the route lines, the pins, the map buttons and their card, the search box and the panel. */
function layout(map: MapLibreMap, scene: RouteScene): Placed {
  const container = map.getContainer();
  const frame = container.getBoundingClientRect();
  const point = (at: LngLat) => map.project(at);
  const view: Box = { left: EDGE.side, top: EDGE.side, right: container.clientWidth - EDGE.right, bottom: container.clientHeight - EDGE.bottom };

  const obstacles: Box[] = [];
  const pins = scene.pins.map((pin) => ({ kind: pin.kind, ...point(pin.position) }));
  for (const { kind, x, y } of pins) {
    const icon = PIN_BOX[kind];
    obstacles.push({ left: x - icon.width / 2, top: y - icon.anchorY, right: x + icon.width / 2, bottom: y - icon.anchorY + icon.height });
  }
  const turns = scene.turnBacks.map((turnBack) => {
    const at = point(turnBack.position);
    const shift = turnBackShift(at, pins);
    obstacles.push(shift ? centred(at.x + shift.x, at.y + shift.y, TURN_BADGE_PX + 2) : centred(at.x, at.y, TURN_MARK_PX + 4));
    return shift;
  });
  if (!scene.pills.length) return { pills: [], turns };
  const overlays = container.closest(".app")?.querySelectorAll(".map-controls > *, .layers-card, .map-search, .panel") ?? [];
  for (const element of overlays) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) obstacles.push({ left: rect.left - frame.left, top: rect.top - frame.top, right: rect.right - frame.left, bottom: rect.bottom - frame.top });
  }

  const routes = scene.selected ? [scene.selected, ...scene.alternatives] : scene.alternatives;
  const lines = routes.flatMap((route) => route.legs.map((leg) => leg.path.map(point)));
  const asks = scene.pills.map((pill) => ({ id: pill.id, width: pillWidthPx(pill.text, pill.turnBacks), height: PILL_HEIGHT_PX, anchors: pill.anchors.map(point) }));
  return { pills: placePills(asks, obstacles, view, lines), turns };
}

/** The pills and turn-back discs of a route scene, as map markers. Must be a child of the map. */
export function RouteMarks(props: { scene: RouteScene; onSelect: (target: SceneTarget) => void }): ReactElement | null {
  const { scene } = props;
  const map = useMap().current;
  const [placed, setPlaced] = useState<Placed>({ pills: [], turns: [] });

  useEffect(() => {
    if (!map) return;
    const instance = map.getMap();
    let frame = 0;
    const update = () => {
      frame = 0;
      setPlaced(scene.pills.length || scene.turnBacks.length ? layout(instance, scene) : { pills: [], turns: [] });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    // Placed again when a move ends: while it lasts the marks ride along with the map where they
    // are, and the frames go to drawing (a layout projects every point of every route).
    instance.on("moveend", schedule);
    instance.on("resize", schedule);
    instance.on("load", schedule);
    return () => {
      instance.off("moveend", schedule);
      instance.off("resize", schedule);
      instance.off("load", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [map, scene]);

  if (!scene.pills.length && !scene.turnBacks.length) return null;
  return (
    <>
      {placed.pills.map((place) => {
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
      {scene.turnBacks.map((turnBack, i) => {
        const shift = placed.turns[i] ?? null;
        return (
          <Marker
            key={`turn-${i}`}
            longitude={turnBack.position[0]}
            latitude={turnBack.position[1]}
            anchor="center"
            offset={shift ? [shift.x, shift.y] : [0, 0]}
            className={`route-mark route-mark--turn${shift ? " route-mark--badge" : ""}`}
          >
            <TurnBackMark turnBack={turnBack.turnBack} />
          </Marker>
        );
      })}
    </>
  );
}
