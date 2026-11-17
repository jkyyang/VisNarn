/**
 * EXAMPLE data for an empty database, so the app opens on something to look at. Every row is
 * labelled EXAMPLE and can be deleted; none of it is company data, and nothing else in the app
 * refers to it.
 */
import type { BatchUpload } from "../../shared/cars.ts";
import type { ShopDraft } from "../../shared/places.ts";
import { instant } from "../../shared/time.ts";

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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The six EXAMPLE cars as a CSV upload with times relative to `now`, in the default import profile's columns. */
export function exampleBatch(now: Date): BatchUpload {
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  // Wall time on this laptop with its offset written out, as a company export with zones would have it.
  const at = (hours: number) => {
    const d = new Date(hour.getTime() + hours * 3_600_000);
    const two = (n: number) => String(n).padStart(2, "0");
    const offset = -d.getTimezoneOffset();
    const zone = `${offset < 0 ? "-" : "+"}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}${zone}`;
  };
  const rows: [car: string, a: string, b: string, reportedH: number, shop: string, prepEndH: number][] = [
    ["EXAMPLE 104233", "Taylor, TX", "Temple, TX", 0, "EX-NLR-01", 40],
    ["EXAMPLE 220871", "Barstow, CA", "Las Vegas, NV", -6, "EX-NPL-01", 30],
    ["EXAMPLE 318045", "Sarnia, ON", "London, ON", -2, "EX-CHI-01", 12],
    ["EXAMPLE 402196", "Savannah, GA", "Jacksonville, FL", -10, "EX-BHM-01", 60],
    ["EXAMPLE 551930", "Fargo, ND", "Minneapolis, MN", -3, "EX-KCY-01", 72],
    ["EXAMPLE 663012", "Winnipeg, MB", "Regina, SK", -1, "EX-CAL-01", 8],
  ];
  const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);
  const text = [
    "car_id,last_node,next_node,reported_at,shop,prep_end",
    ...rows.map(([car, a, b, reportedH, shop, prepEndH]) => [car, a, b, at(reportedH), shop, at(prepEndH)].map(quote).join(",")),
  ].join("\n");
  const fileName = `EXAMPLE cars-${MONTHS[hour.getMonth()]}${hour.getDate()}.csv`;
  return { name: fileName, asOf: instant(hour), source: { kind: "csv", fileName, text: `${text}\n` } };
}
