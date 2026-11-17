/**
 * The morning list as the Cars panel shows it: filtered, split by the group the server gave each
 * car, and walked with the keyboard. Pure.
 */
import type { CarSummary } from "../../../shared/cars.ts";
import type { TriageGroup } from "../../../shared/route.ts";

export interface CarsFilter {
  /** Groups switched off with the count chips. */
  hide: TriageGroup[];
  /** Only this shop's cars. */
  shop: string | null;
}

export interface CarGroups {
  counts: Record<TriageGroup, number>;
  /** After the filter, in the server's order (most urgent first). */
  groups: Record<TriageGroup, CarSummary[]>;
  pending: number;
  /** For the shop filter: every shop in the batch with its car count. */
  shops: { name: string; count: number }[];
}

export const GROUP_ORDER: readonly TriageGroup[] = ["act-now", "check-first", "ok"];

export function groupCars(cars: CarSummary[], filter: CarsFilter): CarGroups {
  const counts: Record<TriageGroup, number> = { "act-now": 0, "check-first": 0, ok: 0 };
  const groups: Record<TriageGroup, CarSummary[]> = { "act-now": [], "check-first": [], ok: [] };
  const shopCounts = new Map<string, number>();
  let pending = 0;
  for (const car of cars) {
    shopCounts.set(car.shop, (shopCounts.get(car.shop) ?? 0) + 1);
    if (car.group === null) {
      pending++;
      continue;
    }
    counts[car.group]++;
    if (filter.hide.includes(car.group)) continue;
    if (filter.shop !== null && car.shop !== filter.shop) continue;
    groups[car.group].push(car);
  }
  const shops = [...shopCounts].map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name));
  return { counts, groups, pending, shops };
}

/** The rows in the order they are shown. */
export function visibleRows(groups: CarGroups): number[] {
  return GROUP_ORDER.flatMap((group) => groups.groups[group].map((car) => car.row));
}

/** The row ↑ / ↓ moves to, through the visible groups in order; null stays put at either end. */
export function neighbour(groups: CarGroups, current: number | null, step: 1 | -1): number | null {
  const rows = visibleRows(groups);
  if (!rows.length) return null;
  const at = current === null ? -1 : rows.indexOf(current);
  if (at < 0) return step > 0 ? rows[0] : rows[rows.length - 1];
  const next = at + step;
  return next < 0 || next >= rows.length ? null : rows[next];
}
