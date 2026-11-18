/**
 * NASA's Black Marble night-lights tiles, downloaded for the night side of the map
 * (web/map/nightTiles.ts). A public picture of the Earth; each request carries only tile numbers.
 */
import { createCache } from "../../shared/cache.ts";

/** VIIRS Black Marble 2016 from NASA GIBS: free, no key, served with CORS, tiles to zoom 8. */
const BLACK_MARBLE_TILE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";
export const BLACK_MARBLE_MAX_ZOOM = 8;
export const BLACK_MARBLE_ATTRIBUTION = 'Night lights: <a href="https://earthobservatory.nasa.gov/features/NightLights">NASA Earth Observatory</a> VIIRS Black Marble, via NASA GIBS';

/**
 * Downloaded tiles. GIBS sends `cache-control: no-store`, so without this every 10-minute redraw of
 * the night side would download every tile again. The PNGs are kept as they came (tens of KB each;
 * decoded pixels would take 256 KB); decoding one again takes about a millisecond.
 */
const CACHE_TILES = 256;
const downloads = createCache<string, Promise<Blob>>({ maxEntries: CACHE_TILES });

/** One Black Marble tile as a PNG. Rejects if it cannot be downloaded; a failure is not kept. */
export function blackMarbleTile(z: number, x: number, y: number): Promise<Blob> {
  const key = `${z}/${x}/${y}`;
  const cached = downloads.get(key);
  if (cached) return cached;
  // Not tied to one map request's abort: requests may share it, and a tile scrolled away is often
  // wanted again a moment later.
  const url = BLACK_MARBLE_TILE.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
  const download = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Black Marble tile ${key}: HTTP ${response.status}`);
    return response.blob();
  });
  downloads.set(key, download);
  // Forgotten on failure, so the next redraw tries again.
  download.catch(() => downloads.delete(key));
  return download;
}
