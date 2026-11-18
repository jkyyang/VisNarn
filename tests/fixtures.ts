/** The EXAMPLE shops the API, screen and browser tests start from (codes EX-NLR-01 …), each located by coordinates. */
import type { ShopDraft } from "../shared/places.ts";

const shop = (name: string, code: string, lon: number, lat: number): ShopDraft => ({ name, code, location: { kind: "coord", lon, lat } });

export const EXAMPLE_SHOPS: ShopDraft[] = [
  shop("North Little Rock, AR", "EX-NLR-01", -92.27, 34.77),
  shop("Kansas City, MO", "EX-KCY-01", -94.58, 39.1),
  shop("Birmingham, AL", "EX-BHM-01", -86.8, 33.52),
  shop("Chicago, IL", "EX-CHI-01", -87.63, 41.88),
  shop("Calgary, AB", "EX-CAL-01", -114.07, 51.05),
  shop("North Platte, NE", "EX-NPL-01", -100.77, 41.12),
];
