import type { Layer, PickingInfo } from "deck.gl";
import { beforeAll, describe, expect, it } from "vitest";
import type { CarReport, CheckedCar } from "../../shared/cars.ts";
import type { Instant } from "../../shared/time.ts";
import { createFakeState, installFakeServer } from "../testing/fakeServer.ts";
import type { RGBA, ThemeColors } from "../theme.ts";
import { LAYER, networkLayer, sceneLayers, sceneTarget, sceneTooltip } from "./layers.ts";
import { fleetScene, routeScene, shopsScene, type MapScene } from "./scene.ts";

const grey: RGBA = [90, 100, 110, 255];
const colors: ThemeColors = {
  dark: false,
  fg: [0, 0, 0, 255],
  muted: grey,
  accent: [26, 115, 232, 255],
  warn: [176, 96, 0, 255],
  panel: [255, 255, 255, 255],
  route: [26, 115, 232, 255],
  alternative: [154, 160, 166, 255],
  casing: [255, 255, 255, 255],
  rail: { BNSF: [1, 0, 0, 255], UP: [2, 0, 0, 255], CSXT: [3, 0, 0, 255], NS: [4, 0, 0, 255], CN: [5, 0, 0, 255], CPKC: [6, 0, 0, 255] },
  status: { "at-risk": [197, 34, 31, 255], tight: [176, 96, 0, 255], "on-time": [24, 128, 56, 255], "check-route": [123, 31, 162, 255], "cannot-check": grey },
};

const ASOF = "2026-11-17T15:00:00.000Z" as Instant;
const report = (stops: CarReport["stops"] = []): CarReport => ({
  carId: "EXAMPLE 104233",
  a: { kind: "text", text: "Taylor, TX" },
  b: { kind: "text", text: "Temple, TX" },
  shop: { kind: "text", text: "North Little Rock, AR" },
  stops,
  reportedAt: "2026-11-17T12:00:00.000Z" as Instant,
  prepEnd: "2026-11-19T06:00:00.000Z" as Instant,
});

let car: CheckedCar;
let fixed: CheckedCar;

async function checkOf(r: CarReport): Promise<CheckedCar> {
  const response = await fetch("/api/check", { method: "POST", body: JSON.stringify({ report: r, asOf: ASOF }) });
  const result = (await response.json()) as CheckedCar;
  if (result.outcome !== "checked") throw new Error("the EXAMPLE car should check");
  return result;
}

beforeAll(async () => {
  const fake = installFakeServer({ state: createFakeState() });
  car = await checkOf(report());
  fixed = await checkOf(report([{ place: { kind: "node", fraId: 358070 as never, railroad: "BNSF" }, note: null }]));
  fake.restore();
});

describe("map scene", () => {
  it("routeScene pins A, B, stops and the shop on the track and frames every option", () => {
    const scene = routeScene(fixed, "pick", car.options[0]);
    if (scene.kind !== "route") throw new Error("route scene expected");
    expect(scene.pins.map((p) => p.kind)).toEqual(["a", "b", "stop", "shop"]);
    expect(scene.pins[1].position).toEqual(fixed.options[0].legs[0].path[0]);
    expect(scene.pins[3].position).toEqual(fixed.options[0].legs.at(-1)!.path.at(-1));
    expect(scene.pins[0].label).toBe("A · Taylor");
    const [west, south, east, north] = scene.bounds;
    for (const option of [...car.options, ...fixed.options])
      for (const leg of option.legs)
        for (const [lon, lat] of leg.path) {
          expect(lon).toBeGreaterThanOrEqual(west);
          expect(lon).toBeLessThanOrEqual(east);
          expect(lat).toBeGreaterThanOrEqual(south);
          expect(lat).toBeLessThanOrEqual(north);
        }
  });

  it("the selected option is on top, the others are alternatives, the ghost is the route before the stops", () => {
    const scene = routeScene(car, "shortest", null);
    if (scene.kind !== "route") throw new Error("route scene expected");
    expect(scene.selected.id).toBe("shortest");
    expect(scene.alternatives.map((r) => r.id)).toEqual(["pick"]);
    expect(scene.ghost).toBeNull();
    expect(scene.selected.interchanges).toEqual([expect.objectContaining({ from: "BNSF", to: "UP" })]);
    const ghosted = routeScene(fixed, "pick", car.options[0]);
    expect(ghosted.kind === "route" && ghosted.ghost?.id).toBe("pick");
  });

  it("puts a ring at every turn-back of the selected option, and chevrons along it pointing the way the car goes", () => {
    const scene = routeScene(car, "pick", null);
    if (scene.kind !== "route") throw new Error("route scene expected");
    expect(scene.turnBacks).toHaveLength(1);
    expect(scene.turnBacks[0].turnBack.at.near).toBe("Temple, TX");
    expect(scene.selected.chevrons.length).toBeGreaterThan(50);
    expect(scene.selected.chevrons.filter((c) => c.minZoom === 0).length).toBeGreaterThan(3);
    const first = scene.selected.chevrons[0];
    expect(first.bearingDeg).toBeGreaterThan(90);
    expect(first.bearingDeg).toBeLessThan(270);
  });

  it("fleetScene has one marker per checked car at its node B, with its pill", () => {
    const scene = fleetScene(
      [
        { row: 0, carId: "1", shop: "S", shopExample: false, fixed: false, check: { outcome: "checked", verdict: car.options[0].verdict, km: 1, straightKm: 1, railroads: ["BNSF"], at: [-97, 31], positionAgeH: 0 }, group: "check-first" },
        { row: 1, carId: "2", shop: "S", shopExample: false, fixed: false, check: { outcome: "pending" }, group: null },
        { row: 2, carId: "3", shop: "S", shopExample: false, fixed: false, check: { outcome: "cannot-check", problems: [{ field: "b", message: "x" }] }, group: "check-first" },
      ],
      0,
      car,
    );
    expect(scene.kind === "fleet" && scene.cars).toEqual([{ row: 0, carId: "1", position: [-97, 31], pill: "check-route", selected: true }]);
    expect(scene.kind === "fleet" && scene.selected?.id).toBe("pick");
  });

  it("fleetScene shows the selected car as on the Route screen: A, B and shop pins, the A → B line, the straight line to the shop", () => {
    const summary = { row: 0, carId: "EXAMPLE 104233", shop: "S", shopExample: false, fixed: false, check: { outcome: "checked" as const, verdict: car.options[0].verdict, km: 1, straightKm: 1, railroads: ["BNSF" as const], at: [-97, 31] as [number, number], positionAgeH: 0 }, group: "check-first" as const };
    const scene = fleetScene([summary], 0, car);
    if (scene.kind !== "fleet") throw new Error("not a fleet scene");
    expect(scene.pins.map((pin) => pin.label)).toEqual(["A · Taylor", "B · Temple", "Shop · North Little Rock"]);
    expect(scene.approach.length).toBeGreaterThan(0);
    expect(scene.straight?.label).toMatch(/^straight line [\d,]+ km$/);
    expect(scene.straight?.path[1]).toEqual(scene.pins[2].position);
    // Before its check has loaded, the selected car is a marker like the others.
    const loading = fleetScene([summary], 0, null);
    expect(loading.kind === "fleet" && [loading.pins, loading.straight]).toEqual([[], null]);
  });

  it("shopsScene pins only the shops that are on the network", () => {
    const state = createFakeState();
    const scene = shopsScene(state.shops, null);
    expect(scene.kind === "shops" && scene.pins.map((p) => p.label)).toEqual(state.shops.map((s) => s.name));
  });
});

describe("layers", () => {
  let scene: MapScene;
  let layers: Layer[];
  beforeAll(() => {
    scene = routeScene(fixed, "pick", car.options[0]);
    layers = sceneLayers(scene, colors, 5) as Layer[];
  });

  it("stacks alternatives under the selected route, with pins and labels on top; only real targets are pickable", () => {
    const ids = layers.map((l) => l.id);
    expect(ids.indexOf(LAYER.alternatives)).toBeLessThan(ids.indexOf(LAYER.route));
    expect(ids.indexOf(LAYER.ghost)).toBeLessThan(ids.indexOf(LAYER.routeCasing));
    expect(ids.indexOf(LAYER.routeCasing)).toBeLessThan(ids.indexOf(LAYER.route));
    expect(ids.indexOf(LAYER.route)).toBeLessThan(ids.indexOf(LAYER.chevrons));
    expect(ids.indexOf(LAYER.chevrons)).toBeLessThan(ids.indexOf(LAYER.pins));
    expect(ids.indexOf(LAYER.pins)).toBeLessThan(ids.indexOf(LAYER.labels));
    expect(layers.filter((l) => l.props.pickable).map((l) => l.id)).toEqual([LAYER.alternatives, LAYER.route, LAYER.interchanges, LAYER.turnBacks, LAYER.pins]);
  });

  it("shows fewer chevrons zoomed out than zoomed in", () => {
    const count = (zoom: number) => ((sceneLayers(scene, colors, zoom) as Layer[]).find((l) => l.id === LAYER.chevrons)!.props.data as unknown[]).length;
    expect(count(3)).toBeLessThan(count(7));
    expect(count(7)).toBeLessThan(count(10));
  });

  it("a click on a grey route selects it; a click on a turn-back ring opens it", () => {
    const pick = (id: string, object: unknown) => ({ layer: layers.find((l) => l.id === id), object }) as PickingInfo;
    const alternatives = (routeScene(car, "pick", null) as Extract<MapScene, { kind: "route" }>).alternatives;
    expect(sceneTarget(pick(LAYER.alternatives, { ...alternatives[0].legs[0], option: "shortest" }))).toEqual({ kind: "option", id: "shortest" });
    const ringed = routeScene(car, "pick", null) as Extract<MapScene, { kind: "route" }>;
    expect(sceneTarget(pick(LAYER.turnBacks, ringed.turnBacks[0]))).toEqual({ kind: "turn-back", index: 0 });
    expect(sceneTarget(pick(LAYER.route, {}))).toBeNull();
    expect(sceneTooltip(pick(LAYER.turnBacks, ringed.turnBacks[0]))?.text).toMatch(/^Turns back here: check\nTemple, TX · yard track \(stub end\)/);
    expect(sceneTooltip(pick(LAYER.routeCasing, {}))).toBeNull();
  });

  it("draws the old route and the A → B line dashed: square dash ends, so the gaps stay open", () => {
    for (const id of [LAYER.ghost, LAYER.approach]) {
      const props = layers.find((l) => l.id === id)!.props as unknown as { capRounded: boolean; getDashArray: [number, number] };
      expect(props.capRounded, id).toBe(false);
      expect(props.getDashArray[1], id).toBeGreaterThan(2);
    }
  });

  it("writes 'Turns back here: check' in a pill left of the ring, or right of it when the left side is off screen; shorter on a phone", () => {
    const ringed = routeScene(car, "pick", null);
    const label = (view?: Parameters<typeof sceneLayers>[3]) => {
      const layer = (sceneLayers(ringed, colors, 8, view) as Layer[]).find((l) => l.id === LAYER.turnBackLabels)!;
      const props = layer.props as unknown as { background: boolean; getText: () => string; getTextAnchor: (p: unknown) => string; data: unknown[] };
      return { background: props.background, text: props.getText(), anchor: props.getTextAnchor(props.data[0]) };
    };
    expect(label()).toEqual({ background: true, text: "Turns back here: check", anchor: "end" });
    expect(label({ compact: false, width: 900, screenX: () => 450 }).anchor).toBe("end");
    expect(label({ compact: false, width: 900, screenX: () => 60 }).anchor).toBe("start");
    expect(label({ compact: true, width: 390, screenX: () => 20 }).text).toBe("Turns back: check");
  });

  it("draws each car as a pill with its number, and its hover text says the place is node B from the report, not live", () => {
    const summary = (row: number, carId: string) => ({ row, carId, shop: "S", shopExample: false, fixed: false, check: { outcome: "checked" as const, verdict: car.options[0].verdict, km: 1, straightKm: 1, railroads: ["BNSF" as const], at: [-97 + row, 31] as [number, number], positionAgeH: 0 }, group: "check-first" as const });
    const fleet = fleetScene([summary(0, "EXAMPLE 104233"), summary(1, "EXAMPLE 663012")], 0, car);
    const drawn = sceneLayers(fleet, colors, 5) as Layer[];
    const pills = drawn.find((l) => l.id === LAYER.cars)!;
    const props = pills.props as unknown as { background: boolean; pickable: boolean; data: { carId: string }[]; getText: (c: { carId: string }) => string };
    expect(props.background && props.pickable).toBe(true);
    // The selected car is drawn by its pins, so only the other car has a pill.
    expect(props.data.map((c) => props.getText(c))).toEqual(["663012"]);
    const info = { layer: pills, object: (fleet as Extract<MapScene, { kind: "fleet" }>).cars.find((c) => c.carId === "EXAMPLE 663012") } as PickingInfo;
    expect(sceneTarget(info)).toEqual({ kind: "car", row: 1 });
    expect(sceneTooltip(info)?.text).toMatch(/Drawn at node B, its next node \(from the report, not live\)/);
    expect(drawn.map((l) => l.id)).toEqual(expect.arrayContaining([LAYER.pins, LAYER.approach, LAYER.straight]));
  });

  it("colours the network by owner and keeps it mounted while hidden", () => {
    const network = { type: "FeatureCollection" as const, features: [] };
    const hidden = networkLayer(network, false, true, colors) as Layer;
    expect(hidden.props).toMatchObject({ visible: false, opacity: 0.35 });
    const getLineColor = (hidden.props as unknown as { getLineColor: (f: { properties: { owner: string } }) => RGBA }).getLineColor;
    expect(getLineColor({ properties: { owner: "UP" } })).toBe(colors.rail.UP);
    expect(getLineColor({ properties: { owner: "KCTL" } })).toBe(grey);
    expect((networkLayer(network, true, false, colors) as Layer).props.opacity).toBeGreaterThan(0.5);
  });
});
