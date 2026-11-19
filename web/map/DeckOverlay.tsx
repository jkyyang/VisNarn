import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { useState } from "react";
import { useControl, useMap, type IControl } from "react-map-gl/maplibre";

/**
 * deck.gl as a map control, drawing inside the map style (interleaved): a layer with a `beforeId` goes
 * under that style layer (the rail network under the place names), any other on top. On every change
 * of style deck.gl puts its layers back in place, so a basemap switch keeps them.
 */
export function DeckOverlay(props: MapboxOverlayProps) {
  const map = useMap().current;
  const [overlay] = useState(
    () =>
      new MapboxOverlay({
        ...props,
        interleaved: true,
        // deck.gl 9.0 follows the camera's moves only once it is ready, and picks with the last view it
        // heard of: a jump before then (the first fit, a shop opened from its link) would send the next
        // click somewhere else. So once it is ready, the map says where the camera is. (Not in `onLoad`:
        // deck.gl's own `onLoad` starts the following, and the next setProps would put ours in its place.)
        onDeviceInitialized: () => queueMicrotask(() => map?.getMap().fire("move")),
      }),
  );
  // The cast bridges typings only. deck.gl and react-map-gl each declare their own minimal "map"
  // interface for controls, and neither is assignable to the other; the MapLibre map satisfies both.
  useControl(() => overlay as unknown as IControl);
  overlay.setProps(props);
  return null;
}
