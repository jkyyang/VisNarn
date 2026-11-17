/** Numbers, distances, names and compass points as text. Display only: the browser's locale is applied here and nowhere else. */

/** Numbers stay English whatever the browser's language: the rest of the page is English. */
const LOCALE = "en-US";

const grouped = (n: number) => Math.round(n).toLocaleString(LOCALE);

/** "1,046 km". */
export const fmtKmShort = (km: number) => `${grouped(km)} km`;

/** Unicode-aware: "QUÉRETARO" → "Quéretaro" (a plain \b\w gives "QuéRetaro"). */
export const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, pre: string, c: string) => pre + c.toUpperCase());

/** Subdivision names arrive in capitals. Title-case them, but leave marks like "(BNSF)" and "A&WP" alone. */
export const fmtSubdivision = (name: string) =>
  name.split(" ").map((w) => (/[&(]/.test(w) ? w : titleCase(w))).join(" ");

/** "LAMPASAS" → "Lampasas Sub"; "GALVESTON (BNSF)" → "Galveston Sub (BNSF)". */
export function fmtSub(name: string): string {
  const pretty = fmtSubdivision(name);
  const mark = /\s(\([^)]*\))$/.exec(pretty);
  const base = mark ? pretty.slice(0, mark.index) : pretty;
  const named = /\bsub(division)?$/i.test(base) ? base : `${base} Sub`;
  return mark ? `${named} ${mark[1]}` : named;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** 0 → "N", 45 → "NE", … eight points. */
export function fmtCompass(headingDeg: number): string {
  const normal = ((headingDeg % 360) + 360) % 360;
  return COMPASS[Math.round(normal / 45) % 8];
}

/** "−92.27, 34.77". */
export const fmtLonLat = (lon: number, lat: number) => `${fmtSigned(lon)}, ${fmtSigned(lat)}`;
const fmtSigned = (n: number) => (n < 0 ? `−${Math.abs(n).toFixed(2)}` : n.toFixed(2));
