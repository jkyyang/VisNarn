import { expression, featureFilter, type Feature } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { realTrackLayers } from "./RealTracks.tsx";

const [service, main] = realTrackLayers(false);

/** Which Real tracks layer draws an OpenMapTiles transportation line with these properties. */
function drawnBy(properties: Record<string, string>): string[] {
  const feature = { type: 2, properties } as Feature;
  return [service, main].filter((layer) => featureFilter(layer.filter).filter({ zoom: 14 }, feature)).map((layer) => layer.id);
}

function widthAt(layer: typeof main, zoom: number): number {
  const width = expression.createExpression(layer.paint?.["line-width"]);
  if (width.result !== "success") throw new Error(`${layer.id} has a bad line-width`);
  return width.value.evaluate({ zoom }) as number;
}

describe("Real tracks", () => {
  it("draws main and branch lines solid, and yard, siding, spur and crossover track dashed", () => {
    expect(drawnBy({ class: "rail", subclass: "rail" })).toEqual(["real-tracks-main"]);
    for (const kind of ["yard", "siding", "spur", "crossover"]) {
      expect(drawnBy({ class: "rail", subclass: "rail", service: kind })).toEqual(["real-tracks-service"]);
    }
    expect(service.paint?.["line-dasharray"]).toBeDefined();
    expect(main.paint?.["line-dasharray"]).toBeUndefined();
  });

  it("leaves out subways, trams and light rail, which no railcar runs on, and roads", () => {
    for (const subclass of ["subway", "tram", "light_rail"]) expect(drawnBy({ class: "transit", subclass })).toEqual([]);
    expect(drawnBy({ class: "primary" })).toEqual([]);
  });

  it("keeps the lines thin: a hairline zoomed out, about 2 px at street level", () => {
    expect(widthAt(main, 8)).toBe(0.5);
    expect(widthAt(main, 9.5)).toBeLessThan(1);
    expect(widthAt(main, 15.5)).toBeGreaterThanOrEqual(1.5);
    expect(widthAt(main, 18)).toBeLessThanOrEqual(2.5);
    expect(widthAt(service, 15.5)).toBeLessThan(widthAt(main, 15.5));
  });

  it("draws light lines on a dark ground and dark lines on the day map", () => {
    const [, onDark] = realTrackLayers(true);
    expect(onDark.paint?.["line-color"]).toBe("#e8eaed");
    expect(main.paint?.["line-color"]).toBe("#3c4043");
  });
});
