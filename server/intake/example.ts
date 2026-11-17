/**
 * EXAMPLE data for an empty database, so the app opens on something to look at. Every row is
 * labelled EXAMPLE and can be deleted; none of it is company data, and nothing else in the app
 * refers to it.
 */
import type { ShopDraft } from "../../shared/places.ts";

/** The six EXAMPLE shops of the mockups (codes EX-NLR-01 …), each located by coordinates. */
export function exampleShops(): ShopDraft[] {
  const shop = (name: string, code: string, lon: number, lat: number): ShopDraft => ({ name, code, location: { kind: "coord", lon, lat } });
  return [
    shop("North Little Rock, AR", "EX-NLR-01", -92.27, 34.77),
    shop("Kansas City, MO", "EX-KCY-01", -94.58, 39.1),
    shop("Birmingham, AL", "EX-BHM-01", -86.8, 33.52),
    shop("Chicago, IL", "EX-CHI-01", -87.63, 41.88),
    shop("Calgary, AB", "EX-CAL-01", -114.07, 51.05),
    shop("North Platte, NE", "EX-NPL-01", -100.77, 41.12),
  ];
}
