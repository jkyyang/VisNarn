import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { useState } from "react";
import { useControl, type IControl } from "react-map-gl/maplibre";

/**
 * deck.gl as a map control, on its own canvas above the basemap. Being outside the map style,
 * it is untouched when the basemap (and with it the whole style) is swapped.
 */
export function DeckOverlay(props: MapboxOverlayProps) {
  const [overlay] = useState(() => new MapboxOverlay({ ...props, interleaved: false }));
  // The cast bridges typings only. deck.gl and react-map-gl each declare their own minimal "map"
  // interface for controls, and neither is assignable to the other; the MapLibre map satisfies both.
  useControl(() => overlay as unknown as IControl);
  overlay.setProps(props);
  return null;
}
