import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { Bounds } from "../../shared/geo.ts";
import { FIT_MAX_ZOOM, FIT_MS } from "./config.ts";

/**
 * Room for the floating controls, and at the sides for the labels that hang off the outermost
 * pins. A wide map can spare that room; a phone cannot.
 */
/** A map this wide has room for the layers card beside a route. */
const WIDE_MAP_PX = 640;

function fitOptions(mapWidth: number) {
  const side = Math.round(Math.min(150, Math.max(40, mapWidth * 0.14)));
  // On a wide map the layers card (about 200 px) floats top-right: keep the route out from under it.
  // On a phone the round buttons take the right edge: keep pins and their labels clear of them.
  const right = mapWidth >= WIDE_MAP_PX ? Math.max(side, 240) : Math.max(side, 72);
  return { padding: { top: 72, bottom: 84, left: side, right }, maxZoom: FIT_MAX_ZOOM };
}

type View = { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };

/** True when `bounds` lie wholly inside the visible map. */
export function isInView(view: View, bounds: Bounds): boolean {
  const [west, south, east, north] = bounds;
  return west >= view.getWest() && east <= view.getEast() && south >= view.getSouth() && north <= view.getNorth();
}

/** True when any part of `bounds` is on screen. */
function touchesView(view: View, bounds: Bounds): boolean {
  const [west, south, east, north] = bounds;
  return west <= view.getEast() && east >= view.getWest() && south <= view.getNorth() && north >= view.getSouth();
}

/**
 * Whether a changed route should move the camera. A route already on screen never does. When the
 * whole old route was on screen, a route that grows past the edge is framed again. When the user had
 * zoomed in on part of it (the old route did not fit), adding or removing a stop keeps their view,
 * unless the new route has left the screen entirely.
 */
export function shouldRefit(view: View, previous: Bounds | null, next: Bounds): boolean {
  if (isInView(view, next)) return false;
  if (previous && !isInView(view, previous)) return !touchesView(view, next);
  return true;
}

/**
 * Moves the camera to `bounds` when they first appear (a plan that has just got its route), when they
 * change and `shouldRefit` says so, and whenever `nonce` changes ("Fit whole route"). Renders
 * nothing; must be a child of the map.
 */
export function FitBounds(props: { bounds: Bounds | null; nonce?: number }) {
  const { bounds, nonce = 0 } = props;
  const map = useMap().current;
  const mounted = useRef(false);
  const lastNonce = useRef(nonce);
  const previous = useRef<Bounds | null>(null);
  const key = bounds?.join();

  useEffect(() => {
    // A route that is already there when the map opens is simply where the map starts.
    const first = !mounted.current;
    const jump = first || matchMedia("(prefers-reduced-motion: reduce)").matches;
    mounted.current = true;
    const asked = nonce !== lastNonce.current;
    lastNonce.current = nonce;
    // Before a plan has its route there is nothing to frame; the moment it has one, it is framed.
    const before = previous.current;
    const appeared = !!bounds && !before;
    previous.current = bounds;
    if (!map || !bounds) return;
    const [west, south, east, north] = bounds;
    // Switching tabs or editing stops must not zoom the map back and forth: the camera stays where
    // the user put it unless the route ran off it. "Fit whole route" always moves it.
    if (!first && !asked && !appeared && !shouldRefit(map.getBounds(), before, bounds)) return;
    const options = fitOptions(map.getContainer().clientWidth);
    map.fitBounds([[west, south], [east, north]], { ...options, duration: jump ? 0 : FIT_MS });
    // Keyed on the numbers: a re-check that lands on the same route leaves the camera wherever the user has panned to.
  }, [map, key, nonce]);

  return null;
}
