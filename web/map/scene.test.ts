import type { Layer, PickingInfo } from "deck.gl";
import { beforeAll, describe, expect, it } from "vitest";
import type { LngLat } from "../../shared/geo.ts";
import type { FraId, ShopView } from "../../shared/places.ts";
import { DEFAULT_INCLUDE, drawnClasses, NETWORK_CLASSES, RAILROADS, type Line, type NetworkClass } from "../../shared/railroads.ts";
import type { Plan, PlannedRoute } from "../../shared/plans.ts";
import type { RoutePath } from "../../shared/route.ts";
import { createFakeState, installFakeServer } from "../testing/fakeServer.ts";
import type { RGBA, ThemeColors } from "../theme.ts";
import { LABELS } from "./basemaps.ts";
import { LAYER, lineAt, networkLayers, sceneLayers, sceneTarget, sceneTooltip } from "./layers.ts";
import { legendFor } from "./Legend.tsx";
import { chosenRoute, pillAnchors, planScene, routePaths, shopsScene, withRoutePaths, type MapScene, type SceneLink, type SceneRoute } from "./scene.ts";

const grey: RGBA = [90, 100, 110, 255];
const colors: ThemeColors = {
  sans: "sans-serif",
  fg: [0, 0, 0, 255],
  accent: [255, 199, 44, 255],
  alternative: grey,
  casing: [255, 255, 255, 255],
  risk: [215, 0, 21, 255],
  rail: { BNSF: [1, 0, 0, 255], UP: [2, 0, 0, 255], CSXT: [3, 0, 0, 255], NS: [4, 0, 0, 255], CN: [5, 0, 0, 255], CPKC: [6, 0, 0, 255], regional: [7, 0, 0, 255], "short line": [8, 0, 0, 255], passenger: [9, 0, 0, 255] },
};

const TEMPLE_TO_NLR: Plan = { places: [{ kind: "text", text: "Temple, TX" }, { kind: "text", text: "North Little Rock, AR" }], include: DEFAULT_INCLUDE, turnAtStops: false };
const WITH_WYE: Plan = { ...TEMPLE_TO_NLR, places: [TEMPLE_TO_NLR.places[0], { kind: "node", fraId: 358070 as FraId, railroad: "BNSF" }, TEMPLE_TO_NLR.places[1]] };

let twoRoutes: PlannedRoute;
let oneRoute: PlannedRoute;
let startOnly: PlannedRoute;
let shops: ShopView[];

async function routeOf(plan: Plan): Promise<PlannedRoute> {
  const response = await fetch("/api/route", { method: "POST", body: JSON.stringify(plan) });
  return (await response.json()) as PlannedRoute;
}

beforeAll(async () => {
  const state = createFakeState();
  shops = state.shops;
  const fake = installFakeServer({ state });
  twoRoutes = await routeOf(TEMPLE_TO_NLR);
  oneRoute = await routeOf(WITH_WYE);
  startOnly = await routeOf({ ...TEMPLE_TO_NLR, places: [TEMPLE_TO_NLR.places[0], null] });
  fake.restore();
});

const routeScene = (planned: PlannedRoute | null, option: Parameters<typeof planScene>[0]["option"] = null, unit: Parameters<typeof planScene>[0]["unit"] = "km") => {
  const scene = planScene({ planned, option, shops, unit });
  if (scene.kind !== "route") throw new Error("route scene expected");
  return scene;
};
const routesOf = (planned: PlannedRoute): RoutePath[] => (planned.outcome === "routed" ? planned.routes : []);

describe("planScene", () => {
  it("pins the start, numbered stops and the destination, and every other shop as a square to click", () => {
    const scene = routeScene(oneRoute);
    expect(scene.pins.filter((p) => p.kind !== "shop").map((p) => [p.kind, p.glyph])).toEqual([
      ["start", ""],
      ["stop", "1"],
      ["destination", ""],
    ]);
    const squares = scene.pins.filter((p) => p.kind === "shop");
    expect(squares.length).toBeGreaterThan(0);
    for (const square of squares) expect(square.shopId).not.toBeNull();
    // The destination is the EXAMPLE shop at North Little Rock, typed as a city: it has no square.
    const usedAsEnd = planScene({ planned: { ...oneRoute, places: oneRoute.places.with(-1, { ok: true, place: { ...shopPlace("North Little Rock, AR") } }) }, option: null, shops, unit: "km" });
    expect(usedAsEnd.pins.filter((p) => p.kind === "shop").map((p) => p.label)).not.toContain("North Little Rock, AR");
  });

  it("shows a lone start pin before there is a route, with no bounds, so the camera stays put", () => {
    const scene = routeScene(startOnly);
    expect(scene.pins.filter((p) => p.kind !== "shop").map((p) => p.kind)).toEqual(["start"]);
    expect(scene.selected).toBeNull();
    expect(scene.bounds).toBeNull();
    expect(routeScene(null).pins.every((p) => p.kind === "shop")).toBe(true);
  });

  it("draws the chosen route by railroad on top, the others as alternatives, and frames them all", () => {
    const scene = routeScene(twoRoutes, "shortest");
    expect(scene.selected?.id).toBe("shortest");
    expect(scene.selected?.legs.map((leg) => leg.railroad)).toEqual(["BNSF", "UP"]);
    expect(scene.alternatives.map((r) => r.id)).toEqual(["pick"]);
    expect(scene.selected?.interchanges).toEqual([expect.objectContaining({ from: "BNSF", to: "UP" })]);
    const [west, south, east, north] = scene.bounds ?? [0, 0, 0, 0];
    for (const route of routesOf(twoRoutes))
      for (const leg of route.legs)
        for (const [lon, lat] of leg.path) {
          expect(lon).toBeGreaterThanOrEqual(west);
          expect(lon).toBeLessThanOrEqual(east);
          expect(lat).toBeGreaterThanOrEqual(south);
          expect(lat).toBeLessThanOrEqual(north);
        }
  });

  it("has a pill per route only when there are two or more, the chosen one first", () => {
    expect(routeScene(oneRoute).pills).toEqual([]);
    const scene = routeScene(twoRoutes);
    expect(scene.pills.map((p) => [p.id, p.selected, p.text])).toEqual([
      ["pick", true, "1,046 km"],
      ["shortest", false, "−207 km · 1 more interchange"],
    ]);
    expect(routeScene(twoRoutes, null, "mi").pills.map((p) => p.text)).toEqual(["650 mi", "−129 mi · 1 more interchange"]);
    expect(scene.pills[0].turnBacks).toBe(1);
    for (const pill of scene.pills) expect(pill.anchors.length).toBeGreaterThanOrEqual(3);
  });

  it("puts the turn-back marks of the chosen route only, and chevrons along it the way it runs", () => {
    expect(routeScene(twoRoutes).turnBacks.map((t) => t.turnBack.at.near)).toEqual(["Temple, TX"]);
    expect(routeScene(twoRoutes, "shortest").turnBacks).toEqual([]);
    const selected = routeScene(twoRoutes).selected;
    expect(selected?.chevrons.length).toBeGreaterThan(50);
    expect(selected?.chevrons.filter((c) => c.minZoom === 0).length).toBeGreaterThan(3);
  });

  it("chosenRoute is the route a strategy found, else the router's own", () => {
    const routes = routesOf(twoRoutes);
    expect(chosenRoute(routes, "no-turn-backs").strategies).toContain("no-turn-backs");
    expect(chosenRoute(routes, null)).toBe(routes[0]);
  });
});

describe("routes on the real track", () => {
  it("asks for the same paths whichever route is selected", () => {
    const pick = routePaths(routeScene(twoRoutes));
    expect(pick.length).toBeGreaterThan(1);
    expect(routePaths(routeScene(twoRoutes, "shortest"))).toEqual(pick);
    expect(routePaths(routeScene(startOnly))).toEqual([]);
  });

  it("swaps in the paths it is given, leg by leg, and puts the chevrons along them again", () => {
    const scene = routeScene(twoRoutes, "shortest");
    // Each leg one degree further east: easy to tell apart, the same shape and length.
    const moved = routePaths(scene).map((path) => path.map(([lon, lat]): LngLat => [lon + 1, lat]));
    const drawn = withRoutePaths(scene, moved);
    if (drawn.kind !== "route" || !drawn.selected || !scene.selected) throw new Error("route scene expected");
    expect(drawn.selected.id).toBe(scene.selected.id);
    expect(drawn.selected.legs.map((leg) => leg.path[0][0])).toEqual(scene.selected.legs.map((leg) => leg.path[0][0] + 1));
    expect(drawn.alternatives.map((route) => route.id)).toEqual(scene.alternatives.map((route) => route.id));
    expect(drawn.selected.chevrons[0].position[0]).toBeCloseTo(scene.selected.chevrons[0].position[0] + 1, 6);
    expect(routePaths(drawn)).toEqual(moved);
  });

  it("keeps the scene as it is when the paths do not fit it (an answer for another scene)", () => {
    const scene = routeScene(twoRoutes);
    expect(withRoutePaths(scene, routePaths(scene).slice(1))).toBe(scene);
  });
});

describe("pillAnchors", () => {
  const route = (id: SceneRoute["id"], path: LngLat[]): SceneRoute => ({ id, legs: [{ railroad: "BNSF", path }], chevrons: [], interchanges: [] });
  const line = (from: number, to: number, lat: number): LngLat[] => Array.from({ length: 41 }, (_, i) => [from + ((to - from) * i) / 40, lat]);

  it("lands on the stretch only this route runs, where the routes part", () => {
    // Both run west to east along 35°N; the second leaves the shared line between −96 and −94 to swing north.
    const shared = route("pick", line(-100, -90, 35));
    const swing = route("shortest", [...line(-100, -96, 35), ...line(-96, -94, 36.5), ...line(-94, -90, 35)]);
    const [middle, ...rest] = pillAnchors(swing, [shared]);
    expect(middle[1]).toBeCloseTo(36.5, 1);
    expect(middle[0]).toBeGreaterThan(-96.1);
    expect(middle[0]).toBeLessThan(-93.9);
    // Two more on the swing, then the whole route's own as a fallback.
    expect(rest.slice(0, 2).every(([, lat]) => lat > 36)).toBe(true);
    expect(rest.length).toBeGreaterThanOrEqual(4);
  });

  it("falls back to the route's own middle when every stretch is shared", () => {
    const one = route("pick", line(-100, -90, 35));
    const anchors = pillAnchors(one, [route("shortest", line(-100, -90, 35))]);
    expect(anchors).toHaveLength(3);
    expect(anchors[0][0]).toBeCloseTo(-95, 0);
  });
});

describe("shopsScene", () => {
  it("pins only the shops that are on the network", () => {
    const scene = shopsScene(shops, null);
    expect(scene.kind === "shops" && scene.pins.map((p) => p.label)).toEqual(shops.map((s) => s.name));
    expect(scene.kind === "shops" && scene.links).toEqual([]);
  });

  // Sarnia: link 1 along the plant's yard (shop, foot, two more nodes), link 2 straight to the main line, a drag's preview, a refused drop.
  const at: LngLat = [-82.3376, 42.9596];
  const along: SceneLink = { path: [at, [-82.3405, 42.9568], [-82.3398, 42.9562], [-82.33578, 42.95513]], look: "set" };
  const straight: SceneLink = { path: [at, [-82.34541, 42.95575]], look: "set" };
  const offered: SceneLink = { ...along, look: "offered" };
  const ghost: SceneLink = { ...along, look: "ghost" };
  const refused: SceneLink = { path: [at, [-82.35, 42.99]], look: "refused" };
  const edited = (links: SceneLink[]) => {
    const scene = shopsScene(shops, { shopId: shops[0].id, at, links });
    if (scene.kind !== "shops") throw new Error(`a ${scene.kind} scene`);
    return scene;
  };

  it("draws the edited shop's links as given, and no pin of its own: its pin and rings are handles on the map", () => {
    const scene = edited([along, straight, ghost, refused]);
    expect(scene.links).toEqual([along, straight, ghost, refused]);
    expect(scene.pins.map((pin) => pin.label)).toEqual(shops.slice(1).map((shop) => shop.name));
    expect(scene.pins.every((pin) => pin.kind === "shop")).toBe(true);
  });

  it("asks for the real track under each link's piece on track, of the shop's links and the suggestion only, and draws them along it", () => {
    const scene = edited([along, straight, offered, ghost, refused]);
    expect(routePaths(scene)).toEqual([along.path.slice(1), offered.path.slice(1)]);
    const curved = routePaths(scene).map((path) => [path[0], [-82.3401, 42.9565] as LngLat, ...path.slice(1)]);
    const drawn = withRoutePaths(scene, curved);
    if (drawn.kind !== "shops") throw new Error(`a ${drawn.kind} scene`);
    expect(drawn.links.map((link) => link.path)).toEqual([[at, ...curved[0]], straight.path, [at, ...curved[1]], ghost.path, refused.path]);
    expect(withRoutePaths(scene, curved.slice(1))).toBe(scene);
  });

  it("draws a link's first step dashed and the rest solid over a casing: a straight link all dashed; a suggestion and a preview faint, a refused drop in the risk colour", () => {
    const layers = sceneLayers(edited([along, straight, offered, refused]), colors, 15) as Layer[];
    const layer = (id: string) => layers.find((l) => l.id === id)!;
    const paths = (id: string) => (layer(id).props.data as { path: LngLat[] }[]).map((piece) => piece.path);
    expect(layers.map((l) => l.id).slice(0, 3)).toEqual([LAYER.linksCasing, LAYER.links, LAYER.linksOffTrack]);
    expect(paths(LAYER.linksOffTrack)).toEqual([along.path.slice(0, 2), straight.path, offered.path.slice(0, 2), refused.path]);
    expect(paths(LAYER.links)).toEqual([along.path.slice(1), offered.path.slice(1)]);
    expect(paths(LAYER.linksCasing)).toEqual(paths(LAYER.links));
    expect(layer(LAYER.linksOffTrack).props.extensions).toHaveLength(1);
    const colorOf = (layer(LAYER.links).props as unknown as { getColor: (piece: SceneLink) => RGBA }).getColor;
    expect(colorOf(along)).toEqual(colors.fg);
    expect(colorOf(offered)[3]).toBeLessThan(255);
    expect(colorOf(ghost)).toEqual(colorOf(offered));
    expect(colorOf(refused)).toEqual(colors.risk);
  });
});

describe("legend", () => {
  it("lists the selected route's railroads; with no route, the lines of the network classes drawn", () => {
    expect(legendFor(planScene({ planned: twoRoutes, option: null, shops, unit: "km" }), ["class_i"]).railroads).toEqual(twoRoutes.outcome === "routed" ? twoRoutes.routes[0].railroads : []);
    expect(legendFor(null, ["class_i"]).railroads).toEqual(RAILROADS);
    expect(legendFor(null, ["class_i", "short_line", "passenger"]).railroads).toEqual([...RAILROADS, "short line", "passenger"]);
    expect(legendFor(null, []).railroads).toEqual([]);
  });
});

describe("layers", () => {
  let scene: MapScene;
  let layers: Layer[];
  beforeAll(() => {
    scene = planScene({ planned: twoRoutes, option: null, shops, unit: "km" });
    layers = sceneLayers(scene, colors, 5) as Layer[];
  });

  it("stacks the thin alternatives under the selected route, with the pins on top and no text layer but the stop numbers", () => {
    const ids = layers.map((l) => l.id);
    expect(ids.indexOf(LAYER.alternatives)).toBeLessThan(ids.indexOf(LAYER.routeCasing));
    expect(ids.indexOf(LAYER.routeCasing)).toBeLessThan(ids.indexOf(LAYER.route));
    expect(ids.indexOf(LAYER.route)).toBeLessThan(ids.indexOf(LAYER.chevrons));
    expect(ids.indexOf(LAYER.chevrons)).toBeLessThan(ids.indexOf(LAYER.pins));
    expect(ids.at(-2)).toBe(LAYER.pins);
    expect(ids.at(-1)).toBe(LAYER.pinGlyphs);
    expect(layers.filter((l) => l.props.pickable).map((l) => l.id)).toEqual([LAYER.alternatives, LAYER.route, LAYER.interchanges, LAYER.pins]);
    const width = (id: string, railroad: Line) => {
      const getWidth = (layers.find((l) => l.id === id)!.props as unknown as { getWidth: number | ((leg: { railroad: Line }) => number) }).getWidth;
      return typeof getWidth === "number" ? getWidth : getWidth({ railroad });
    };
    expect(width(LAYER.alternatives, "UP")).toBeLessThan(width(LAYER.route, "UP"));
    // Regional and short-line sections are thinner than Class I ones, as in the legend.
    expect(width(LAYER.route, "short line")).toBeLessThan(width(LAYER.route, "UP"));
  });

  it("colours the selected route by railroad, section by section", () => {
    const route = layers.find((l) => l.id === LAYER.route)!;
    const getColor = (route.props as unknown as { getColor: (leg: { railroad: "BNSF" | "UP" }) => RGBA }).getColor;
    expect(getColor({ railroad: "BNSF" })).toBe(colors.rail.BNSF);
    expect(getColor({ railroad: "UP" })).toBe(colors.rail.UP);
  });

  it("shows fewer chevrons zoomed out than zoomed in", () => {
    const count = (zoom: number) => ((sceneLayers(scene, colors, zoom) as Layer[]).find((l) => l.id === LAYER.chevrons)!.props.data as unknown[]).length;
    expect(count(3)).toBeLessThan(count(7));
    expect(count(7)).toBeLessThan(count(10));
  });

  it("a grey route is a click on the map on that line; a shop square is a place; the plan's own pins and rings take the click and do nothing", () => {
    const pick = (id: string, object: unknown) => ({ layer: layers.find((l) => l.id === id), object }) as PickingInfo;
    const routeScene = scene as Extract<MapScene, { kind: "route" }>;
    const grey = pick(LAYER.alternatives, { ...routeScene.alternatives[0].legs[0], option: "shortest" });
    expect(sceneTarget(grey)).toBeNull();
    expect(lineAt(grey)).toBe("shortest");
    expect(lineAt(pick(LAYER.route, {}))).toBeNull();
    const square = routeScene.pins.find((p) => p.kind === "shop")!;
    expect(sceneTarget(pick(LAYER.pins, square))).toEqual({ kind: "place", ref: { kind: "shop", shopId: square.shopId }, position: square.position });
    expect(sceneTarget(pick(LAYER.pins, routeScene.pins.find((p) => p.kind === "start")))).toBe("inert");
    expect(sceneTarget(pick(LAYER.interchanges, {}))).toBe("inert");
    expect(sceneTarget(pick(LAYER.route, {}))).toBeNull();
    expect(sceneTarget({ layer: null, object: null } as unknown as PickingInfo)).toBeNull();
  });

  it("hover text names an interchange or a pin, and says nothing about routes", () => {
    const pick = (id: string, object: unknown) => ({ layer: layers.find((l) => l.id === id), object }) as PickingInfo;
    expect(sceneTooltip(pick(LAYER.interchanges, { from: "BNSF", to: "UP", place: "Fort Worth, TX" }))?.text).toBe("BNSF → UP · Fort Worth, TX");
    const square = (scene as Extract<MapScene, { kind: "route" }>).pins.find((p) => p.kind === "shop")!;
    expect(sceneTooltip(pick(LAYER.pins, square))?.text).toBe(square.label);
    expect(sceneTooltip(pick(LAYER.route, { railroad: "BNSF" }))).toBeNull();
    expect(sceneTooltip(pick(LAYER.alternatives, { railroad: "BNSF" }))).toBeNull();
  });

  it("draws Class I always and each other class only while its track box is ticked", () => {
    expect(drawnClasses(DEFAULT_INCLUDE)).toEqual(["class_i", "passenger"]);
    expect(drawnClasses({ regional: false, shortLine: true, passenger: false })).toEqual(["class_i", "short_line"]);
    expect(drawnClasses({ regional: true, shortLine: true, passenger: true })).toEqual(NETWORK_CLASSES);
  });


  it("gives each class its own layer, mounted while hidden, Class I coloured by owner and the rest in their route colour, under the place names", () => {
    const network = Object.fromEntries(NETWORK_CLASSES.map((c) => [c, []])) as unknown as Parameters<typeof networkLayers>[0];
    const byClass = (drawn: NetworkClass[], dimmed = false) => Object.fromEntries((networkLayers(network, drawn, dimmed, colors) as Layer[]).map((l) => [l.id, l.props]));
    const lineColor = (props: unknown, owner: string) => (props as { getLineColor: (f: { properties: { owner: string } }) => RGBA }).getLineColor({ properties: { owner } });

    const shown = byClass(["class_i", "short_line"]);
    expect(Object.keys(shown).at(-1)).toBe("network-class_i");
    expect(Object.fromEntries(Object.entries(shown).map(([id, props]) => [id, props.visible]))).toEqual({
      "network-passenger": false,
      "network-short_line": true,
      "network-regional": false,
      "network-class_i": true,
    });
    expect(lineColor(shown["network-class_i"], "UP")).toBe(colors.rail.UP);
    expect(lineColor(shown["network-class_i"], "KCTL")).toBe(grey);
    expect(lineColor(shown["network-short_line"], "KCTL")).toBe(colors.rail["short line"]);
    expect(lineColor(shown["network-regional"], "WSOR")).toBe(colors.rail.regional);
    expect(lineColor(shown["network-passenger"], "AMTK")).toBe(colors.rail.passenger);
    expect(shown["network-short_line"].opacity).toBeLessThan(shown["network-class_i"].opacity as number);
    expect(byClass([], true)["network-class_i"]).toMatchObject({ visible: false, opacity: 0.35 });
    expect(shown["network-class_i"]).toMatchObject({ beforeId: LABELS });
  });
});


/** One of the EXAMPLE shops, resolved as the server resolves a shop given as the destination. */
function shopPlace(name: string) {
  const shop = shops.find((s) => s.name === name);
  if (!shop?.place.ok) throw new Error(`no EXAMPLE shop ${name}`);
  return { ...shop.place.place, match: { ...shop.place.place.match, method: "shop" as const } };
}
