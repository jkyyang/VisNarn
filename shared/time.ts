/**
 * One moment in time, as an ISO-8601 UTC string ("2026-11-17T15:00:00.000Z").
 *
 * Every time in the domain is an Instant, never a Date and never text without a zone. That makes the
 * domain types plain JSON (what the server computes is what the browser receives, with no mapping
 * layer), and it means a time whose zone is unknown cannot enter the system: it is turned into an
 * Instant, or into a problem, at the edge where it was read.
 */
export type Instant = string & { readonly __brand: "Instant" };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function instant(date: Date): Instant {
  return date.toISOString() as Instant;
}

/** Accepts only text that already carries its zone ("…Z" or "…+05:00"). Null otherwise. */
export function asInstant(text: string): Instant | null {
  const parts = parse(text.trim());
  if (!parts || parts.offsetMin === null) return null;
  return instant(new Date(parts.wallMs - parts.offsetMin * 60_000));
}

/** What to do with a time that has no zone, such as "2026-11-17 09:00" in a company export. */
export type ZonelessRule = "reject" | { zone: string };

export type TimeReading = { ok: true; at: Instant } | { ok: false; why: "empty" | "unreadable" | "no-zone" };

/**
 * Reads a time written by a person or an export. The rule decides zone-less text; nothing here ever
 * falls back to the zone of the machine that happens to run the code.
 */
export function readTime(text: string, rule: ZonelessRule): TimeReading {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, why: "empty" };
  const parts = parse(trimmed);
  if (!parts) return { ok: false, why: "unreadable" };
  if (parts.offsetMin !== null) return { ok: true, at: instant(new Date(parts.wallMs - parts.offsetMin * 60_000)) };
  if (rule === "reject") return { ok: false, why: "no-zone" };
  return { ok: true, at: instant(new Date(wallTimeToUtc(parts.wallMs, rule.zone))) };
}

/** True when `zone` is an IANA zone name this runtime knows ("America/Chicago", "UTC"). */
export function isTimeZone(zone: string): boolean {
  if (zone.trim() === "") return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

export function hoursBetween(from: Instant, to: Instant): number {
  return (Date.parse(to) - Date.parse(from)) / HOUR_MS;
}

export function addHours(at: Instant, hours: number): Instant {
  return instant(new Date(Math.round(Date.parse(at) + hours * HOUR_MS)));
}

// ---- reading ----

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** The wall-clock fields as if they were UTC, and the written offset in minutes (null: none written). */
function parse(text: string): { wallMs: number; offsetMin: number | null } | null {
  const m = PATTERN.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] ? Number(m[6]) : 0;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const zone = m[8];
  if (zone === undefined) return { wallMs, offsetMin: null };
  if (zone.toUpperCase() === "Z") return { wallMs, offsetMin: 0 };
  const sign = zone[0] === "-" ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const oh = Number(digits.slice(0, 2));
  const om = digits.length > 2 ? Number(digits.slice(2)) : 0;
  if (oh > 18 || om > 59) return null;
  return { wallMs, offsetMin: sign * (oh * 60 + om) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---- zones ----

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The zone's offset from UTC at that moment, in ms (wall clock minus UTC). */
function offsetAt(zone: string, utcMs: number): number {
  const whole = Math.floor(utcMs / 1000) * 1000;
  const fields: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(whole))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const wall = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  return wall - whole;
}

/**
 * The instant at which the zone's clocks show `wallMs`. Offsets are taken a day either side, which
 * spans any one DST change: a repeated hour (autumn) gives its first occurrence, and a skipped hour
 * (spring) is read with the offset before the change, so 02:30 becomes 03:30 of the new offset.
 */
function wallTimeToUtc(wallMs: number, zone: string): number {
  const before = offsetAt(zone, wallMs - DAY_MS);
  const after = offsetAt(zone, wallMs + DAY_MS);
  const fits = [...new Set([before, after])].map((offset) => wallMs - offset).filter((utc) => utc + offsetAt(zone, utc) === wallMs);
  return fits.length ? Math.min(...fits) : wallMs - before;
}
