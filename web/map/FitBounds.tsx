import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { Bounds } from "../../shared/geo.ts";
import { CAMERA_MARGIN_PX, FIT_MAX_ZOOM, FIT_MS, FIT_PADDING } from "./config.ts";
import type { Covered } from "./MapStage.tsx";

/** The map the panel leaves free, less FIT_PADDING. */
function fitOptions(mapWidth: number, covered: Covered) {
  const { top, bottom, sideShare, sideMin, sideMax, buttons } = FIT_PADDING;
  const left = covered.left + CAMERA_MARGIN_PX;
  const side = Math.round(Math.min(sideMax, Math.max(sideMin, (mapWidth - left) * sideShare)));
  return { padding: { top: covered.top + top, bottom: covered.bottom + bottom, left, right: Math.max(side, buttons) }, maxZoom: FIT_MAX_ZOOM };
}

/** A fit puts the route's box on the edge of its room: this much past it still counts as inside. */
const EDGE_SLACK_PX = 8;

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
 * Moves the camera to `bounds` when they first appear (a plan that has just got its route), and when
 * they change and `shouldRefit` says so, into the map the panel leaves free (`covered`). Renders
 * nothing; must be a child of the map.
 */
export function FitBounds(props: { bounds: Bounds | null; covered: Covered }) {
  const { bounds, covered } = props;
  const map = useMap().current;
  const mounted = useRef(false);
  const previous = useRef<Bounds | null>(null);
  const key = bounds?.join();

  useEffect(() => {
    // A route that is already there when the map opens is where the map starts.
    const first = !mounted.current;
    const jump = first || matchMedia("(prefers-reduced-motion: reduce)").matches;
    mounted.current = true;
    // Before a plan has its route there is nothing to frame; the moment it has one, it is framed.
    const before = previous.current;
    const appeared = !!bounds && !before;
    previous.current = bounds;
    if (!map || !bounds) return;
    const [west, south, east, north] = bounds;
    const { clientWidth, clientHeight } = map.getContainer();
    const options = fitOptions(clientWidth, covered);
    // Where a framed route is clear of the panel and the map buttons: the room a fit keeps, with a few px to spare (a fit lands on its edge).
    const { top, right, bottom, left } = options.padding;
    const nw = map.unproject([left - EDGE_SLACK_PX, top - EDGE_SLACK_PX]);
    const se = map.unproject([clientWidth - right + EDGE_SLACK_PX, clientHeight - bottom + EDGE_SLACK_PX]);
    const view: View = { getWest: () => nw.lng, getNorth: () => nw.lat, getEast: () => se.lng, getSouth: () => se.lat };
    // Switching tabs or editing stops must not zoom the map back and forth: the camera stays where
    // the user put it unless the route ran off it.
    if (!first && !appeared && !shouldRefit(view, before, bounds)) return;
    map.fitBounds([[west, south], [east, north]], { ...options, duration: jump ? 0 : FIT_MS });
    // Keyed on the numbers: a re-check that lands on the same route leaves the camera wherever the user has panned to.
  }, [map, key]);

  return null;
}
