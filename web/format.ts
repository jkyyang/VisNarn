/** Numbers, distances and times as text. Display only: the browser's locale and zone are applied here and nowhere else. */
import type { EstimateBasis } from "../shared/assumptions.ts";
import type { EtaWindow } from "../shared/route.ts";
import { instant, type Instant } from "../shared/time.ts";

/** Day and month names stay English whatever the browser's language: the rest of the page is English. */
const LOCALE = "en-US";

const grouped = (n: number) => Math.round(n).toLocaleString(LOCALE);

export const fmtKm = (km: number) => `${grouped(km)} km · ${grouped(km / 1.609)} mi`;

/** "1,046 km": where miles would crowd a line. */
export const fmtKmShort = (km: number) => `${grouped(km)} km`;

export const fmtDate = (d: Date) =>
  d.toLocaleString(LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Unsigned duration: hours up to two days, then days. */
export function fmtHours(h: number): string {
  const a = Math.abs(h);
  return a >= 48 ? `${(a / 24).toFixed(1)} days` : `${Math.round(a)} h`;
}

export const fmtSlack = (h: number) => `${h < 0 ? "−" : "+"}${fmtHours(h)}`;

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

/** Date → value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
}

/** An Instant as a <input type="datetime-local"> value; "" for none. */
export const instantToLocalInput = (at: Instant | null) => (at ? toLocalInput(new Date(at)) : "");

// ---- rough times: no minutes while the speed is a placeholder ----

type DayPart = "early" | "morning" | "afternoon" | "evening" | "night";

function dayPart(hour: number): DayPart {
  if (hour < 6) return "early";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

/** "Thu 19" in the browser's zone. */
export function fmtDay(at: Instant): string {
  const d = new Date(at);
  return `${d.toLocaleDateString(LOCALE, { weekday: "short" })} ${d.getDate()}`;
}

/** "Tue Nov 17". */
export function fmtLongDay(at: Instant): string {
  const d = new Date(at);
  return `${d.toLocaleDateString(LOCALE, { weekday: "short" })} ${d.toLocaleDateString(LOCALE, { month: "short" })} ${d.getDate()}`;
}

/** "Thu 19, 00:00": a time someone gave (a report, a prep end), not an estimate, so it keeps its minutes. */
export function fmtGiven(at: Instant): string {
  const d = new Date(at);
  return `${fmtDay(at)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Thu 19 night": a rough moment, day and part of day. */
function roughPhrase(at: Instant): { day: string; part: DayPart } {
  return { day: fmtDay(at), part: dayPart(new Date(at).getHours()) };
}

/** "Tue 17 morning": the day and part of day of a time someone gave, for a row that has no room for minutes. */
export function fmtDayPart(at: Instant): string {
  const { day, part } = roughPhrase(at);
  return `${day} ${part}`;
}

/** "about Thu 19 night" for a placeholder basis; an exact local time once the estimate is calibrated. */
export function fmtWhen(at: Instant, basis: EstimateBasis): string {
  if (basis.kind === "calibrated") return fmtGiven(at);
  const { day, part } = roughPhrase(at);
  return `about ${day} ${part}`;
}

/** "about Thu 19 night – Fri 20 early"; one phrase when both ends fall in the same part of the same day. */
export function fmtWindow(window: EtaWindow, basis: EstimateBasis): string {
  const [first, last] = Date.parse(window.ifAtB) <= Date.parse(window.ifJustPastA) ? [window.ifAtB, window.ifJustPastA] : [window.ifJustPastA, window.ifAtB];
  if (basis.kind === "calibrated") {
    const a = fmtGiven(first);
    const b = fmtGiven(last);
    return a === b ? a : `${a} – ${b}`;
  }
  const a = roughPhrase(first);
  const b = roughPhrase(last);
  if (a.day === b.day) return a.part === b.part ? `about ${a.day} ${a.part}` : `about ${a.day} ${a.part} – ${b.part}`;
  return `about ${a.day} ${a.part} – ${b.day} ${b.part}`;
}

/** "Tue 17 – Thu 19": the days a stretch of the route covers. */
export function fmtDays(from: Instant, to: Instant): string {
  const a = fmtDay(from);
  const b = fmtDay(to);
  return a === b ? a : `${a} – ${b}`;
}

/** "+23 h", "−14 h", "+3.0 days". */
export const fmtMargin = fmtSlack;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** 0 → "N", 45 → "NE", … eight points. */
export function fmtCompass(headingDeg: number): string {
  const normal = ((headingDeg % 360) + 360) % 360;
  return COMPASS[Math.round(normal / 45) % 8];
}

/** "0 days old", "1 day old", "2 days old". */
export function fmtAge(hours: number): string {
  const days = Math.max(0, Math.floor(hours / 24));
  return `${days} ${days === 1 ? "day" : "days"} old`;
}

/** A <input type="datetime-local"> value, read in the browser's own zone, as an Instant. Null when empty or unreadable. */
export function fromLocalInput(value: string): Instant | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] ? Number(m[6]) : 0;
  const d = new Date(year, month - 1, day, hour, minute, second);
  // new Date rolls 31 Feb over into March; a value the input itself would never produce is refused.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return instant(d);
}

/** "−92.27, 34.77". */
export const fmtLonLat = (lon: number, lat: number) => `${fmtSigned(lon)}, ${fmtSigned(lat)}`;
const fmtSigned = (n: number) => (n < 0 ? `−${Math.abs(n).toFixed(2)}` : n.toFixed(2));
