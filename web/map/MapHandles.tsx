/**
 * Things on the map a person moves by hand, each a marker holding a button. Dragged, a handle follows the pointer and
 * says where its face is (`onDrag` on each move, `onDrop` where it is let go); tapped without a drag, it is pressed
 * (`onPress`). Esc during a drag drops it nowhere (`onDrop(null)`) and puts it back. A handle with none of these only
 * marks a spot. Nothing here knows what a handle stands for.
 *
 * Handles are no stops for the Tab key: the screen offers the same through its own controls.
 */
import { useRef, useState, type ReactElement } from "react";
import { Marker, useMap, type MarkerDragEvent } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import { PlacePin } from "../ui/badges.tsx";
import { useEscape } from "../ui/useEscape.ts";
import { useNativeClick } from "./RouteMarkFaces.tsx";

export interface MapHandle {
  id: string;
  at: LngLat;
  /** "shop": a shop's pin. "link": a numbered ring. "add": a small ＋ on the edge of the handle at the same spot. */
  face: "shop" | "link" | "add";
  /** Drawn in a ring: its number. */
  glyph: string;
  /** Its name, read out and shown on hover. */
  label: string;
  faint?: boolean;
  pressed?: boolean;
  /** Why it cannot stay where it is: its edge is red and this is its tooltip. */
  wrong?: string | null;
  /** Each move of a drag: where the face is. */
  onDrag?: (at: LngLat) => void;
  /** Where it was let go; null when Esc ended the drag. */
  onDrop?: (at: LngLat | null) => void;
  onPress?: () => void;
}

/** West of 180° the map draws the world again; a longitude leaves here between -180 and 180. */
const wrapped = (lon: number) => ((lon + 540) % 360) - 180;

function Face({ handle }: { handle: MapHandle }): ReactElement {
  switch (handle.face) {
    case "shop":
      return (
        <svg className="map-handle-face" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="var(--accent)" stroke="var(--on-accent)" strokeWidth="2" />
          <circle cx="12" cy="12" r="3.5" fill="var(--on-accent)" />
        </svg>
      );
    case "link":
      return (
        <span className="map-handle-face">
          <PlacePin kind="stop" n={handle.glyph} />
        </span>
      );
    case "add":
      return (
        <svg className="map-handle-face" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7.5" fill="var(--text)" stroke="var(--casing)" strokeWidth="1.5" />
          <path d="M9 5.5v7M5.5 9h7" stroke="var(--surface-solid)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}

function Handle({ handle }: { handle: MapHandle }): ReactElement {
  const map = useMap().current;
  const button = useRef<HTMLButtonElement>(null);
  // Where the marker is while it is dragged: a render in the middle of a drag leaves it under the pointer.
  const [held, setHeld] = useState<LngLat | null>(null);
  const cancelled = useRef(false);
  useNativeClick(button, () => handle.onPress?.());
  useEscape(held !== null, () => {
    cancelled.current = true;
    handle.onDrop?.(null);
  });

  /** Where the face's middle is on the map (the ＋ sits beside the marker's own spot). */
  const faceAt = (): LngLat | null => {
    const face = button.current?.getBoundingClientRect();
    if (!map || !face) return null;
    const frame = map.getContainer().getBoundingClientRect();
    const { lng, lat } = map.unproject([face.left + face.width / 2 - frame.left, face.top + face.height / 2 - frame.top]);
    return [wrapped(lng), lat];
  };
  const move = (event: MarkerDragEvent) => {
    if (cancelled.current) return;
    setHeld([event.lngLat.lng, event.lngLat.lat]);
    const spot = faceAt();
    if (spot) handle.onDrag?.(spot);
  };

  if (!handle.onDrag && !handle.onDrop && !handle.onPress) {
    return (
      <Marker longitude={handle.at[0]} latitude={handle.at[1]} anchor="center" className="map-handle-mark">
        <span className={`map-handle map-handle--${handle.face} is-still`}>
          <Face handle={handle} />
        </span>
      </Marker>
    );
  }
  const [lon, lat] = held ?? handle.at;
  return (
    <Marker
      longitude={lon}
      latitude={lat}
      anchor="center"
      className="map-handle-mark"
      draggable={!!handle.onDrop}
      onDragStart={() => void (cancelled.current = false)}
      onDrag={move}
      onDragEnd={() => {
        const spot = cancelled.current ? null : faceAt();
        setHeld(null);
        if (spot) handle.onDrop?.(spot);
      }}
    >
      <button
        ref={button}
        type="button"
        tabIndex={-1}
        className={`map-handle map-handle--${handle.face}${handle.faint ? " is-faint" : ""}${handle.wrong ? " is-wrong" : ""}${held ? " is-dragging" : ""}`}
        aria-label={handle.label}
        title={handle.wrong ?? handle.label}
        aria-pressed={handle.pressed ?? undefined}
      >
        <Face handle={handle} />
      </button>
    </Marker>
  );
}

/** The screen's handles, as map markers. Must be a child of the map. */
export function MapHandles({ handles }: { handles: MapHandle[] }): ReactElement {
  return (
    <>
      {handles.map((handle) => (
        <Handle key={handle.id} handle={handle} />
      ))}
    </>
  );
}
