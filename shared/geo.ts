/** [longitude, latitude] in degrees. Everything that leaves the server is rounded to 5 decimal places (about 1 m). */
export type LngLat = [lon: number, lat: number];
export type Bounds = [west: number, south: number, east: number, north: number];

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const dLa = (lat2 - lat1) * r;
  const dLo = (lon2 - lon1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

export const isLngLat = (lon: number, lat: number): boolean => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

/** Text pasted from documents often writes minus as U+2212. */
export const plainMinus = (text: string): string => text.replaceAll("−", "-");

export const roundLngLat = (lon: number, lat: number): LngLat => [round5(lon), round5(lat)];

/** Length of a line along the ground. */
export const pathKm = (path: readonly LngLat[]): number => path.slice(1).reduce((km, [lon, lat], i) => km + haversineKm(path[i][0], path[i][1], lon, lat), 0);
