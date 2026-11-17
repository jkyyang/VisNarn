import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { Bounds } from "../../shared/geo.ts";

/**
 * Room for the floating controls, and at the sides for the labels that hang off the outermost
 * pins. A wide map can spare that room; a phone cannot.
 */
function fitOptions(mapWidth: number, leftInset: number, topInset: number) {
  const side = Math.round(Math.min(150, Math.max(40, mapWidth * 0.14)));
  // On a wide map the layers card (about 200 px) floats top-right: keep the route out from under it.
  // On a phone the round buttons take the right edge: keep pins and their labels clear of them.
  const right = mapWidth >= 640 ? Math.max(side, 240) : Math.max(side, 72);
  // A card over the map's left side (the selected car) leaves the rest for the scene, if enough is left.
  const left = leftInset && mapWidth - leftInset - right >= 320 ? Math.max(side, leftInset) : side;
  return { padding: { top: Math.max(72, topInset), bottom: 84, left, right }, maxZoom: 11 };
}

/**
 * Moves the camera to `bounds` whenever they change, and again whenever `nonce` changes ("Fit whole
 * route"). Renders nothing; must be a child of the map.
 */
export function FitBounds(props: { bounds: Bounds | null; nonce?: number; leftInset?: number; topInset?: number }) {
  const { bounds, nonce = 0, leftInset = 0, topInset = 0 } = props;
  const map = useMap().current;
  const mounted = useRef(false);
  const key = bounds?.join();

  useEffect(() => {
    // A route that is already there when the map opens is simply where the map starts.
    const jump = !mounted.current || matchMedia("(prefers-reduced-motion: reduce)").matches;
    mounted.current = true;
    if (!map || !bounds) return;
    const [west, south, east, north] = bounds;
    const options = fitOptions(map.getContainer().clientWidth, leftInset, topInset);
    map.fitBounds([[west, south], [east, north]], { ...options, duration: jump ? 0 : 800 });
    // Keyed on the numbers, not the array: a re-check that lands on the same route must not
    // pull the camera back from wherever the user has panned to.
  }, [map, key, nonce, leftInset, topInset]);

  return null;
}
