/**
 * The numbers that tune the map's camera and its clicks. Plain values with no map library behind
 * them, so the browser tests can import them too.
 */

/**
 * How far the map pans: North America with a wide margin, so a glimpse of Greenland, the Caribbean
 * and northern South America stays but the map cannot drift to another continent. MapLibre keeps the
 * whole screen inside these, which also stops zooming out once they fill the screen.
 */
export const PAN_BOUNDS: [[number, number], [number, number]] = [
  [-170, 5],
  [-20, 83],
];

/** Where the sun is judged until the map reports its centre: the middle of the network. */
export const NETWORK_CENTRE: [number, number] = [-95.5, 38.5];

/** Room around the network when the map first opens. */
export const INITIAL_PADDING_PX = 24;

/** The camera's flight to one place, and its move to frame a route. */
export const FLY_MS = 900;
export const FIT_MS = 800;

/** Framing a route never zooms in closer than this: a short route still shows the lines around it. */
export const FIT_MAX_ZOOM = 11;

/** A place found with the search box is shown this close: its yard and the lines through it. */
export const FOUND_ZOOM = 12;

/** On Shops: a spot just picked on the map, and the shop being edited. */
export const SHOP_PICKED_ZOOM = 11;
export const SHOP_EDITING_ZOOM = 9;

/**
 * In Auto, the dark street map only from this zoom in. Further out the screen spans the twilight band,
 * so the light map stays and the night tiles cover the night side, like the Earth from space; from here
 * in the screen (about 700 km) is nearly all day or all night.
 */
export const AUTO_DARK_ZOOM = 7;

/** Zoomed out to here or further, the street map's water is the deep blue of the Earth from space. */
export const OCEAN_SPACE_ZOOM = 5;

/** The Real tracks tiles carry rail from this zoom; from here in their lines replace the network layers. */
export const REAL_TRACKS_MIN_ZOOM = 8;

/** A click snaps to a track node if one is within this many screen pixels; the tolerance in km follows the zoom. */
export const PICK_RADIUS_PX = 36;

/** A click this close to a drawn route or pin picks it. */
export const DECK_PICK_RADIUS_PX = 8;

/** The phone layout: matches the @media (max-width: 640px) rules in web/styles.css. */
export const PHONE_QUERY = "(max-width: 640px)";
