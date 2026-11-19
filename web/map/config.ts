/**
 * The numbers that tune the map's camera and its clicks. Plain values with no map library behind
 * them, so the browser tests can import them too.
 */

/**
 * How far the map pans: North America with a wide margin, so a glimpse of Greenland, the Caribbean
 * and northern South America stays but the map cannot drift to another continent. MapLibre keeps the
 * whole screen inside these, which also stops zooming out once they fill the screen. Zoomed all the
 * way out, the panel covers up to about 72° on a laptop screen: the west edge is that far past the
 * Aleutians (180°), so all of Alaska fits right of the panel. MapLibre draws the world again west of 180°.
 */
export const PAN_BOUNDS: [[number, number], [number, number]] = [
  [-255, 5],
  [-20, 83],
];

/** Where the sun is judged until the map reports its centre: the middle of the network. */
export const NETWORK_CENTRE: [number, number] = [-95.5, 38.5];

/** Room around the whole network, when the map first opens and on Reset view. */
export const INITIAL_PADDING_PX = 24;

/** Every camera move keeps this much clear on the left: on each side of the open panel, or alone when it is collapsed. */
export const CAMERA_MARGIN_PX = 16;

/** The camera's flight to one place, and its move to frame a route. */
export const FLY_MS = 900;
export const FIT_MS = 800;

/** Framing a route never zooms in closer than this: a short route still shows the lines around it. */
export const FIT_MAX_ZOOM = 11;

/**
 * Room kept round a framed route, in px: under the search box, over the credits, and on the right a
 * share of the free map for the labels that hang off the outermost pins, never less than the map
 * buttons take. The left is the camera's own (CAMERA_MARGIN_PX).
 */
export const FIT_PADDING = { top: 72, bottom: 84, sideShare: 0.14, sideMin: 40, sideMax: 150, buttons: 92 };

/** A shop picked in the list or on the map is shown this close: the lines that reach it and the towns round it. */
export const SELECTED_SHOP_ZOOM = 8;

/** A place found with the search box is shown this close: its yard and the lines through it. */
export const FOUND_ZOOM = 12;

/** On Shops: the shop being edited, close enough for its own track, which the Real tracks tiles carry from zoom 14. */
export const SHOP_ZOOM = 15;

/**
 * In Auto, the dark street map only from this zoom in. Further out the screen spans the twilight band,
 * so the light map stays and the night tiles cover the night side, like the Earth from space; from here
 * in the screen (about 700 km) is nearly all day or all night.
 */
export const AUTO_DARK_ZOOM = 7;

/** Zoomed out to here or further, the street map's water is the deep blue of the Earth from space. */
export const OCEAN_SPACE_ZOOM = 5;

/** Zoomed out past this, the map shows main lines and big cities only: regional and short-line track, and every city, from here in. */
export const DETAIL_MIN_ZOOM = 5;

/** The Real tracks tiles carry rail from this zoom; from here in their lines replace the network layers. */
export const REAL_TRACKS_MIN_ZOOM = 8;

/** A click snaps to a track node if one is within this many screen pixels; the tolerance in km follows the zoom. */
export const PICK_RADIUS_PX = 36;

/** A shop link's piece off the track, from the shop to its yard: a dash and a gap, in line widths. */
export const LINK_DASH: [dash: number, gap: number] = [2, 1.6];

/** A click this close to a drawn route or pin picks it. */
export const DECK_PICK_RADIUS_PX = 8;

/** The phone layout: matches the @media (max-width: 640px) rules in web/styles.css. */
export const PHONE_QUERY = "(max-width: 640px)";

/**
 * MapLibre's tile cache, per source: tiles kept after they leave the screen, so zooming or panning
 * back shows them at once. MapLibre sizes it as the tiles a screen holds times five zoom levels;
 * this caps that on a large screen (a 256 px raster tile takes about 0.35 MB of graphics memory, and
 * Satellite at night draws three raster sources).
 */
export const TILE_CACHE_MAX_TILES = 200;

/** Spare tile textures MapLibre may keep for reuse, per tile size; the rest are freed when the map is idle. */
export const SPARE_TILE_TEXTURES = 32;
