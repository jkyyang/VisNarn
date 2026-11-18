/** The routing policy: the numbers that decide which route the router finds and where a place meets the track. */

/** Extra km the router's pick accepts to avoid changing railroad. */
export const INTERCHANGE_PENALTY_KM = 500;

/** Cost of reversing direction inside a yard, in km. */
export const REVERSE_KM = 100;

/** Largest change of heading allowed outside a yard, in degrees: a sharper move is a reversal. */
export const MAX_TURN_DEG = 90;

/** Most railroad changes one route may make. Sets the router's memory: states grow with it. */
export const MAX_INTERCHANGES = 3;

/**
 * Passenger-owned track, when allowed, costs this many times its km, so a route takes it only where no
 * freight-owned way is close in length, such as a shop on a commuter line.
 */
export const PASSENGER_TRACK_COST = 4;

/** Coordinates snap to a railroad's mainline only within this distance. */
export const SNAP_KM = 15;

/**
 * A railroad serves coordinates only when its mainline is about as close as the nearest one: within this
 * many km of the nearest railroad's distance. A shop 1 km from CN track is not served by a CPKC line 14 km
 * away, so a route must not end there (Oakville, ON, 2026-11-17).
 */
export const SERVE_SLACK_KM = 5;

/** A point takes the name of a city within this distance; farther, "72 km from Jacksonville, FL". */
export const NEAR_CITY_KM = 25;
