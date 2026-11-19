/**
 * The map's credits: a round "i" in the bottom-right corner, and the credits in a popover to its left.
 * MapLibre's own attribution control writes them, so they follow the sources on the map (the night
 * lights, the satellite photo); this popover is only where they show. A map move closes it.
 */
import { AttributionControl } from "maplibre-gl";
import { useEffect, useId, useRef, type ReactElement } from "react";
import { useMap } from "react-map-gl/maplibre";
import { Info } from "../ui/icons.tsx";
import { usePopover } from "../ui/popover.ts";

/** The app's own data, after the map sources' credits. */
const DATA_ATTRIBUTION = ["Rail network: BTS NTAD North American Rail Network", "Place names: GeoNames (CC BY 4.0)"];

/** Must be a child of the map. */
export function Credits(): ReactElement {
  const map = useMap().current?.getMap();
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePopover([button, card]);
  const cardId = useId();

  useEffect(() => {
    const box = card.current;
    if (!map || !box) return;
    const control = new AttributionControl({ compact: false, customAttribution: DATA_ATTRIBUTION });
    box.append(control.onAdd(map));
    return () => control.onRemove();
  }, [map]);

  useEffect(() => {
    if (!map || !open) return;
    const close = () => setOpen(false);
    map.on("movestart", close);
    return () => void map.off("movestart", close);
  }, [map, open, setOpen]);

  return (
    <>
      <div className="glass credits-card" id={cardId} ref={card} hidden={!open} />
      <button type="button" className="glass credits-btn" ref={button} aria-label="Map credits" aria-expanded={open} aria-controls={cardId} onClick={() => setOpen(!open)}>
        <Info />
      </button>
    </>
  );
}
