/** The answer to a click on the map, where it landed: a ring that pulses (set), or a red ✕ that fades (nothing there). */
import { useState, type ReactElement } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { MapFlash } from "./MapStage.tsx";

/** Must be a child of the map; keyed by the flash, so each click plays once. */
export function Flash({ flash }: { flash: MapFlash }): ReactElement | null {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <Marker longitude={flash.at[0]} latitude={flash.at[1]} anchor="center" className="flash-mark">
      <span className={`flash flash--${flash.kind}`} data-flash={flash.kind} aria-hidden="true" onAnimationEnd={() => setDone(true)} />
    </Marker>
  );
}
