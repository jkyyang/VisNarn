import { describe, expect, it } from "vitest";
import type { LngLat } from "../../shared/geo.ts";
import { mapLook, subsolarPoint, sunPosition } from "./daylight.ts";

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

describe("how the map looks", () => {
  const sun = (altitudeDeg: number, azimuthDeg = 250) => ({ altitudeDeg, azimuthDeg });

  it("Auto: day colours with the sun up, the dark colours after dusk", () => {
    expect(mapLook("auto", sun(40))).toEqual({ base: "day", phase: "day" });
    expect(mapLook("auto", sun(-20))).toEqual({ base: "night", phase: "night" });
  });

  it("Auto: sunset around sunset, and sunrise when the sun is in the east", () => {
    const sunset = mapLook("auto", sun(-1, 250));
    expect(sunset.phase).toBe("sunset");
    expect(sunset.base).toBe("day");
    expect(mapLook("auto", sun(2, 110)).phase).toBe("sunrise");
  });

  it("Auto: through dusk the look goes day, sunset, then night, and never back", () => {
    const order = ["day", "sunset", "night"];
    let step = 0;
    for (let alt = 12; alt >= -12; alt -= 0.5) {
      const look = mapLook("auto", sun(alt));
      const at = order.indexOf(look.phase);
      expect(at, `phase at ${alt}°`).toBeGreaterThanOrEqual(step);
      step = at;
      // The dark colours turn on where the night tiles are half lit.
      expect(look.base).toBe(alt < -3 ? "night" : "day");
    }
    expect(step).toBe(2);
  });

  it("Day and Night stay as chosen whatever the sun does", () => {
    for (const alt of [60, 0, -40]) {
      expect(mapLook("day", sun(alt))).toEqual({ base: "day", phase: "day" });
      expect(mapLook("night", sun(alt))).toEqual({ base: "night", phase: "night" });
    }
  });
});
