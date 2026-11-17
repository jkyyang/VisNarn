/**
 * EXAMPLE data for page tests: the six shops of the mockups and made-up track between a few cities.
 * Not company data, and never imported by the app.
 */
import type { LngLat } from "../../shared/geo.ts";
import type { FraId, NetworkNode } from "../../shared/places.ts";
import type { Railroad } from "../../shared/railroads.ts";
import type { RouteStrategy, TurnBack } from "../../shared/route.ts";

export interface City {
  name: string;
  at: LngLat;
  railroads: Railroad[];
}

export const CITIES: City[] = [
  { name: "Taylor, TX", at: [-97.41, 30.57], railroads: ["UP"] },
  { name: "Temple, TX", at: [-97.346, 31.095], railroads: ["BNSF", "UP"] },
  { name: "North Little Rock, AR", at: [-92.27, 34.77], railroads: ["BNSF", "UP"] },
  { name: "Fort Worth, TX", at: [-97.33, 32.75], railroads: ["BNSF", "UP"] },
  { name: "Fargo, ND", at: [-96.79, 46.88], railroads: ["BNSF", "CPKC"] },
  { name: "Minneapolis, MN", at: [-93.27, 44.98], railroads: ["BNSF", "UP", "CPKC"] },
  { name: "Kansas City, MO", at: [-94.58, 39.1], railroads: ["BNSF", "UP", "CPKC", "NS"] },
  { name: "Waycross, GA", at: [-82.35, 31.21], railroads: ["CSXT"] },
  { name: "Jacksonville, FL", at: [-81.66, 30.33], railroads: ["CSXT", "NS"] },
  { name: "Birmingham, AL", at: [-86.8, 33.52], railroads: ["CSXT", "NS", "BNSF"] },
  { name: "Toronto, ON", at: [-79.38, 43.65], railroads: ["CN", "CPKC"] },
  { name: "Hamilton, ON", at: [-79.87, 43.26], railroads: ["CN", "CPKC"] },
  { name: "Chicago, IL", at: [-87.63, 41.88], railroads: ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"] },
  { name: "Edmonton, AB", at: [-113.49, 53.55], railroads: ["CPKC", "CN"] },
  { name: "Red Deer, AB", at: [-113.81, 52.27], railroads: ["CPKC", "CN"] },
  { name: "Des Moines, IA", at: [-93.61, 41.59], railroads: ["UP", "CPKC"] },
  { name: "Calgary, AB", at: [-114.07, 51.05], railroads: ["CPKC", "CN"] },
  { name: "Omaha, NE", at: [-95.94, 41.26], railroads: ["UP", "BNSF"] },
  { name: "North Platte, NE", at: [-100.77, 41.12], railroads: ["UP"] },
  { name: "Denver, CO", at: [-104.99, 39.74], railroads: ["UP", "BNSF"] },
];

const node = (fraId: number, near: string, at: LngLat, railroads: Railroad[], yard: boolean): NetworkNode => ({
  fraId: fraId as FraId,
  lon: at[0],
  lat: at[1],
  near,
  railroads,
  yard,
  km: 0,
});

/** Nodes a map click can snap to: the city nodes, and the wye at Temple where BNSF and UP meet. */
export const NODES: NetworkNode[] = [
  node(357961, "Temple, TX", [-97.34607, 31.09534], ["BNSF"], true),
  node(358070, "TEMPLE, TX wye", [-97.362, 31.121], ["BNSF", "UP"], false),
  node(301500, "Waco, TX", [-97.15, 31.55], ["BNSF", "UP"], false),
  ...CITIES.map((city, i) => node(600000 + i, city.name, city.at, city.railroads, true)),
];

export interface ExampleShop {
  name: string;
  code: string;
  at: LngLat;
}

export const EXAMPLE_SHOPS: ExampleShop[] = [
  { name: "North Little Rock, AR", code: "EX-NLR-01", at: [-92.27, 34.77] },
  { name: "Kansas City, MO", code: "EX-KCY-01", at: [-94.58, 39.1] },
  { name: "Birmingham, AL", code: "EX-BHM-01", at: [-86.8, 33.52] },
  { name: "Chicago, IL", code: "EX-CHI-01", at: [-87.63, 41.88] },
  { name: "Calgary, AB", code: "EX-CAL-01", at: [-114.07, 51.05] },
  { name: "North Platte, NE", code: "EX-NPL-01", at: [-100.77, 41.12] },
];

export interface LegSpec {
  railroad: Railroad;
  points: LngLat[];
  subdivisions: string[];
}

export interface PathSpec {
  strategies: RouteStrategy[];
  /** Real track km, as the mockups have them. */
  km: number;
  legs: LegSpec[];
  /** Turn-backs, each before the leg with that index. */
  turnBacks: { beforeLeg: number; turnBack: TurnBack }[];
  /** Only offered when the plan has stops, or only without. */
  when?: "stops" | "no-stops";
}

const turnBack = (near: string, at: LngLat, railroad: Railroad, arrives: [string | null, number], leaves: [string | null, number], turnDeg: number, track: TurnBack["track"]): TurnBack => ({
  at: { fraId: 357961 as FraId, lon: at[0], lat: at[1], near },
  railroad,
  arrives: { subdivision: arrives[0], headingDeg: arrives[1] },
  leaves: { subdivision: leaves[0], headingDeg: leaves[1] },
  turnDeg,
  track,
});

const TEMPLE: LngLat = [-97.34607, 31.09534];
const NLR: LngLat = [-92.27, 34.77];
const BNSF_EAST: LngLat[] = [TEMPLE, [-97.23, 30.93], [-96.86, 30.71], [-96.09, 30.39], [-95.46, 30.31], [-95.09, 30.34], [-94.18, 30.35], [-93.89, 30.66], [-94.11, 31.53], [-94.24, 31.94], [-94.74, 32.5], [-94.05, 33.43], [-93.59, 33.67], [-93.05, 34.12], [-92.29, 34.75], NLR];
const BNSF_SUBS = ["LAMPASAS", "GALVESTON", "CONROE", "SILSBEE", "SAN AUGUSTINE", "LONGVIEW", "LITTLE ROCK"];

/** Routes by "start > destination" (city names). Anything else gets one straight-ish leg. */
export const ROUTES: Record<string, PathSpec[]> = {
  "Temple, TX > North Little Rock, AR": [
    {
      strategies: ["pick", "fewest-interchanges"],
      km: 1046,
      legs: [{ railroad: "BNSF", points: BNSF_EAST, subdivisions: BNSF_SUBS }],
      turnBacks: [{ beforeLeg: 0, turnBack: turnBack("Temple, TX", TEMPLE, "BNSF", ["LAMPASAS", 182], ["LAMPASAS", 6], 176, "stub-end") }],
      when: "no-stops",
    },
    {
      strategies: ["shortest", "no-turn-backs"],
      km: 839,
      legs: [
        { railroad: "BNSF", points: [TEMPLE, [-97.15, 31.55], [-97.2, 32.2], [-97.33, 32.75]], subdivisions: ["FORT WORTH"] },
        { railroad: "UP", points: [[-97.33, 32.75], [-96.8, 32.78], [-95.49, 32.66], [-94.05, 33.43], [-93.05, 34.12], [-92.29, 34.75], NLR], subdivisions: ["DALLAS", "MINEOLA", "TEXARKANA", "LITTLE ROCK"] },
      ],
      turnBacks: [],
      when: "no-stops",
    },
    {
      strategies: ["pick", "shortest", "fewest-interchanges", "no-turn-backs"],
      km: 926,
      legs: [{ railroad: "BNSF", points: [[-97.362, 31.121], ...BNSF_EAST.slice(1)], subdivisions: BNSF_SUBS.slice(1) }],
      turnBacks: [],
      when: "stops",
    },
  ],
  "Minneapolis, MN > Kansas City, MO": [
    { strategies: ["pick", "shortest", "fewest-interchanges", "no-turn-backs"], km: 985, legs: [{ railroad: "BNSF", points: [[-93.27, 44.98], [-93.37, 43.65], [-93.61, 41.59], [-94.2, 40.3], [-94.58, 39.1]], subdivisions: ["ALBERT LEA", "DES MOINES", "ST JOSEPH"] }], turnBacks: [] },
  ],
  "Jacksonville, FL > Birmingham, AL": [
    {
      strategies: ["pick", "shortest", "fewest-interchanges"],
      km: 780,
      legs: [
        { railroad: "CSXT", points: [[-81.66, 30.33], [-82.2, 30.6]], subdivisions: ["JESUP"] },
        { railroad: "CSXT", points: [[-82.2, 30.6], [-83.28, 30.83], [-84.39, 31.58], [-85.68, 32.6], [-86.8, 33.52]], subdivisions: ["FITZGERALD", "MANCHESTER", "LINEVILLE"] },
      ],
      turnBacks: [{ beforeLeg: 1, turnBack: turnBack("72 km from Jacksonville, FL", [-82.2, 30.6], "CSXT", ["JESUP", 300], ["JESUP", 120], 178, "yard") }],
    },
  ],
  "Hamilton, ON > Chicago, IL": [
    {
      strategies: ["pick", "shortest", "fewest-interchanges"],
      km: 830,
      legs: [
        { railroad: "CPKC", points: [[-79.87, 43.26], [-80.1, 43.2]], subdivisions: ["HAMILTON"] },
        { railroad: "CPKC", points: [[-80.1, 43.2], [-81.25, 42.98], [-83.05, 42.33], [-85.5, 41.95], [-87.4, 41.75]], subdivisions: ["GALT", "WINDSOR", "DETROIT"] },
        { railroad: "CPKC", points: [[-87.4, 41.75], [-87.63, 41.88]], subdivisions: ["CHICAGO"] },
      ],
      turnBacks: [
        { beforeLeg: 1, turnBack: turnBack("Hamilton, ON", [-80.1, 43.2], "CPKC", ["HAMILTON", 250], ["GALT", 70], 180, "yard") },
        { beforeLeg: 2, turnBack: turnBack("Chicago, IL", [-87.4, 41.75], "CPKC", ["DETROIT", 270], ["CHICAGO", 30], 120, "yard") },
      ],
    },
  ],
  "Red Deer, AB > Calgary, AB": [{ strategies: ["pick", "shortest", "fewest-interchanges", "no-turn-backs"], km: 152, legs: [{ railroad: "CPKC", points: [[-113.81, 52.27], [-113.9, 51.7], [-114.07, 51.05]], subdivisions: ["RED DEER"] }], turnBacks: [] }],
  "Omaha, NE > North Platte, NE": [{ strategies: ["pick", "shortest", "fewest-interchanges", "no-turn-backs"], km: 450, legs: [{ railroad: "UP", points: [[-95.94, 41.26], [-97.6, 41.1], [-99.08, 40.7], [-100.77, 41.12]], subdivisions: ["LANE", "KEARNEY"] }], turnBacks: [] }],
};
