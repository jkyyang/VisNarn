import { describe, expect, it } from "vitest";
import type { LngLat } from "../../shared/geo.ts";
import { basemapFilter, mapLook, subsolarPoint, sunPosition, terminator } from "./daylight.ts";

const CHICAGO: LngLat = [-87.63, 41.88];
const at = (iso: string) => new Date(iso);

describe("where the sun is", () => {
  it("stands over the Tropic of Cancer at the June solstice and over the equator at the March equinox", () => {
    expect(subsolarPoint(at("2024-06-20T20:51:00Z"))[1]).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(at("2024-03-20T03:06:00Z"))[1]).toBeCloseTo(0, 1);
  });

  it("is over Greenwich near noon UTC, and over the Pacific when it is noon there", () => {
    expect(Math.abs(subsolarPoint(at("2024-06-21T12:00:00Z"))[0])).toBeLessThan(1);
    expect(Math.abs(subsolarPoint(at("2024-06-21T22:00:00Z"))[0] + 150)).toBeLessThan(1);
  });

  it("is highest at Chicago's solar noon in June: 90° less the latitude plus the tilt", () => {
    const noon = sunPosition(at("2024-06-21T17:50:00Z"), CHICAGO);
    expect(noon.altitudeDeg).toBeCloseTo(90 - 41.88 + 23.44, 0);
    expect(noon.azimuthDeg).toBeGreaterThan(170);
    expect(noon.azimuthDeg).toBeLessThan(190);
  });

  it("is on the horizon in the north-east at Chicago's published sunrise and in the north-west at sunset", () => {
    // Almanac times: sunrise 5:15 CDT, sunset 8:29 CDT on 21 June 2024 (refraction puts the sun's centre 0.83° below).
    const rise = sunPosition(at("2024-06-21T10:15:00Z"), CHICAGO);
    const set = sunPosition(at("2024-06-22T01:29:00Z"), CHICAGO);
    expect(rise.altitudeDeg).toBeCloseTo(-0.83, 0);
    expect(set.altitudeDeg).toBeCloseTo(-0.83, 0);
    expect(rise.azimuthDeg).toBeGreaterThan(45);
    expect(rise.azimuthDeg).toBeLessThan(70);
    expect(set.azimuthDeg).toBeGreaterThan(290);
    expect(set.azimuthDeg).toBeLessThan(315);
  });

  it("is far below the horizon at local midnight", () => {
    expect(sunPosition(at("2026-11-17T06:00:00Z"), CHICAGO).altitudeDeg).toBeLessThan(-30);
  });
});

describe("the day-night line", () => {
  it("runs right across the map, through places where the sun is on the horizon", () => {
    const when = at("2026-11-17T23:00:00Z");
    const line = terminator(when, 5);
    expect(line[0][0]).toBe(-180);
    expect(line[line.length - 1][0]).toBe(180);
    for (const point of line) expect(Math.abs(sunPosition(when, point).altitudeDeg)).toBeLessThan(0.01);
  });

  it("still has a place for every longitude at an equinox, when it runs from pole to pole", () => {
    const line = terminator(at("2024-03-20T03:06:00Z"), 10);
    for (const [, lat] of line) expect(Number.isFinite(lat)).toBe(true);
  });
});

describe("how the map looks", () => {
  const sun = (altitudeDeg: number, azimuthDeg = 250) => ({ altitudeDeg, azimuthDeg });

  it("Auto: day colours with the sun up, the dark map with city lights after dusk", () => {
    expect(mapLook("auto", sun(40))).toEqual({ base: "day", phase: "day", warm: 0, lights: 0 });
    expect(mapLook("auto", sun(-20))).toEqual({ base: "night", phase: "night", warm: 0, lights: 1 });
  });

  it("Auto: warm light around sunset, and sunrise when the sun is in the east", () => {
    const sunset = mapLook("auto", sun(-1, 250));
    expect(sunset.phase).toBe("sunset");
    expect(sunset.base).toBe("day");
    expect(sunset.warm).toBeGreaterThan(0.9);
    expect(mapLook("auto", sun(2, 110)).phase).toBe("sunrise");
  });

  it("Auto: the look changes gradually through dusk, never jumping straight from bright day to full night", () => {
    let last = mapLook("auto", sun(12));
    for (let alt = 12; alt >= -12; alt -= 0.5) {
      const next = mapLook("auto", sun(alt));
      expect(Math.abs(next.warm - last.warm)).toBeLessThan(0.1);
      expect(Math.abs(next.lights - last.lights)).toBeLessThan(0.1);
      last = next;
    }
    expect(mapLook("auto", sun(-5.5)).lights).toBeGreaterThan(0);
  });

  it("Day and Night stay as chosen whatever the sun does", () => {
    for (const alt of [60, 0, -40]) {
      expect(mapLook("day", sun(alt))).toEqual({ base: "day", phase: "day", warm: 0, lights: 0 });
      expect(mapLook("night", sun(alt))).toEqual({ base: "night", phase: "night", warm: 0, lights: 1 });
    }
  });

  it("tints the basemap only around sunrise and sunset, and darkens a satellite picture at night", () => {
    expect(basemapFilter(mapLook("day", sun(0)), false)).toBe("none");
    expect(basemapFilter(mapLook("auto", sun(-1)), false)).toMatch(/sepia/);
    expect(basemapFilter(mapLook("night", sun(0)), false)).toBe("none");
    expect(basemapFilter(mapLook("night", sun(0)), true)).toMatch(/brightness\(0\.5\)/);
  });
});
