import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { Bounds } from "../../shared/geo.ts";
import { FIT_MAX_ZOOM, FIT_MS, FIT_PADDING } from "./config.ts";

/** The free part of the map, right of the panel, less FIT_PADDING. */
function fitOptions(mapWidth: number, coveredLeft: number) {
  const { top, bottom, sideShare, sideMin, sideMax, buttons } = FIT_PADDING;
  const side = Math.round(Math.min(sideMax, Math.max(sideMin, (mapWidth - coveredLeft) * sideShare)));
  return { padding: { top, bottom, left: coveredLeft + side, right: Math.max(side, buttons) }, maxZoom: FIT_MAX_ZOOM };
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
 * change and `shouldRefit` says so, and whenever `nonce` changes ("Fit whole route"). `coveredLeft`:
 * the px of the map the panel covers from the left. Renders nothing; must be a child of the map.
 */
export function FitBounds(props: { bounds: Bounds | null; nonce?: number; coveredLeft: number }) {
  const { bounds, nonce = 0, coveredLeft } = props;
  const map = useMap().current;
  const mounted = useRef(false);
  const lastNonce = useRef(nonce);
  const previous = useRef<Bounds | null>(null);
  const key = bounds?.join();

  useEffect(() => {
    // A route that is already there when the map opens is where the map starts.
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
    // What the person sees: the map right of the panel.
    const { clientWidth, clientHeight } = map.getContainer();
    const nw = map.unproject([coveredLeft, 0]);
    const se = map.unproject([clientWidth, clientHeight]);
    const view: View = { getWest: () => nw.lng, getNorth: () => nw.lat, getEast: () => se.lng, getSouth: () => se.lat };
    // Switching tabs or editing stops must not zoom the map back and forth: the camera stays where
    // the user put it unless the route ran off it. "Fit whole route" always moves it.
    if (!first && !asked && !appeared && !shouldRefit(view, before, bounds)) return;
    const options = fitOptions(clientWidth, coveredLeft);
    map.fitBounds([[west, south], [east, north]], { ...options, duration: jump ? 0 : FIT_MS });
    // Keyed on the numbers: a re-check that lands on the same route leaves the camera wherever the user has panned to.
  }, [map, key, nonce]);

  return null;
}
