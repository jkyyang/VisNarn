/** Whose a shop is, read from its name or code ("Oakville, ON · Procor", "DRAFT-UTLX-ECH"): the panel's glyph and the map's marker show it. */
import type { ShopView } from "../shared/places.ts";

export type Owner = "Procor" | "UTLX";

const OWNERS: [Owner, RegExp][] = [
  ["Procor", /\bproc(or)?\b/i],
  ["UTLX", /\butlx\b/i],
];

/** Null when neither the name nor the code says. */
export const ownerOf = (shop: Pick<ShopView, "name" | "code">): Owner | null =>
  OWNERS.find(([, pattern]) => pattern.test(shop.name) || pattern.test(shop.code ?? ""))?.[0] ?? null;
