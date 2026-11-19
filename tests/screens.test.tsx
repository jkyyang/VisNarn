// @vitest-environment jsdom
/**
 * The screens, rendered from real answers of the real back end: the page's own App, in jsdom,
 * talking over HTTP to `node server/main.ts` started on a temp data folder (with the EXAMPLE shops) and a free port. Only the
 * map canvas is replaced, because jsdom has no WebGL. The assertions hold for any network build: they
 * check what every answer must look like on screen.
 */
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RequestArgs, Res, Route } from "../shared/api.ts";
import { callApi, clearQueryCache } from "../web/data/query.ts";
import { openPage } from "../web/testing/page.tsx";
import { EXAMPLE_SHOPS } from "./fixtures.ts";

vi.mock("../web/map/MapCanvas.tsx", () => import("../web/testing/FakeMapCanvas.tsx"));
// Real routing in worker threads: a long continental route can take a few seconds the first time.
vi.setConfig({ testTimeout: 90_000 });

const ROUTING_MS = 30_000;

/**
 * The server in its own process. In a jsdom test Vite serves modules the browser way, which the
 * engine's file paths do not survive; a child process runs the server exactly as `npm start` does.
 */
function startServer(dataDir: string): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/main.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, VISNARN_PORT: "0", VISNARN_DATA_DIR: dataDir, VISNARN_ROUTE_WORKERS: "2" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`The server did not start in 60 s:\n${output}`)), 60_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /Shop Arrival Check: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve({ url: match[1], child });
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The server stopped (code ${code}):\n${output}`));
    });
  });
}

let origin: string;
let server: ChildProcess | null = null;
let dataDir: string;
const nodeFetch = globalThis.fetch;

const api = <R extends Route>(route: R, ...request: RequestArgs<R>): Promise<Res<R>> => callApi(origin, route, request[0] as never);

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "visnarn-screens-"));
  const started = await startServer(dataDir);
  origin = started.url;
  server = started.child;
  for (const shop of EXAMPLE_SHOPS) await api("POST /api/shops", { body: shop });
  // The page asks for "/api/…" on its own origin; here that origin is the test server. jsdom's
  // AbortSignal is not one Node's fetch accepts, so a superseded read finishes unheard.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = url.startsWith("/api/") ? origin + url : url.startsWith(origin) ? url : null;
    if (!target) return Promise.resolve(new Response("", { status: 404 }));
    return nodeFetch(target, { method: init?.method, headers: init?.headers, body: init?.body });
  }) as typeof fetch;
}, 150_000);

afterAll(async () => {
  globalThis.fetch = nodeFetch;
  if (server && server.exitCode === null) {
    const stopped = new Promise((done) => server!.once("exit", done));
    server.kill("SIGTERM");
    await stopped;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  clearQueryCache();
});

const field = (name: "Start" | "Destination") => screen.getByRole("combobox", { name });
/** The routes found: a row each when there are two or more; with one, its result card alone. */
const routeRows = () => {
  const list = screen.queryByRole("region", { name: "Routes" });
  return list ? within(list).getAllByRole("button") : screen.queryAllByRole("region", { name: "Route" });
};

/** Taylor, TX to the EXAMPLE shop at North Little Rock (by its code), both typed with Enter. */
async function planExample(user: ReturnType<typeof userEvent.setup>) {
  openPage("/route");
  await user.type(field("Start"), "Taylor, TX{Enter}");
  await user.type(field("Destination"), "EX-NLR-01{Enter}");
  await waitFor(() => expect(routeRows().length).toBeGreaterThan(0), { timeout: ROUTING_MS });
}

describe("Route planner", () => {
  it("routes a typed start and destination: one row per route, one pressed, and its sections from start to destination", async () => {
    const user = userEvent.setup();
    await planExample(user);
    const rows = routeRows();
    if (rows.length > 1) expect(rows.filter((row) => row.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    for (const row of rows) expect(row).toHaveTextContent(/[\d,]+ km/);
    // A row per carrier leg, from the start to the destination.
    const legs = within(screen.getByRole("list", { name: "Sections" })).getAllByRole("button");
    expect(legs[0]).toHaveTextContent(/^(BNSF|UP|CSXT|NS|CN|CPKC)Taylor → /);
    expect(legs.at(-1)).toHaveTextContent(/→ North Little Rock[\d,]+ km$/);

    // Each leg in its railroad's colour.
    for (const leg of legs) expect(leg.querySelector<HTMLElement>(".section-bar")?.style.background).toBe(`var(--rr-${leg.querySelector(".leg-carrier")?.textContent})`);
  });

  it("Add stop, then a click on the map, sets a stop, which the route then runs through", async () => {
    const user = userEvent.setup();
    await planExample(user);
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    const places = screen.getByRole("region", { name: "Places" });
    await waitFor(() => expect(within(places).getAllByRole("listitem")).toHaveLength(3), { timeout: ROUTING_MS });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem").some((row) => row.querySelector("svg text")?.textContent === "1")).toBe(true), {
      timeout: ROUTING_MS,
    });
  });

  it("a place that cannot be found marks its row, and no routes", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.type(field("Start"), "Nowhere Junction XYZ{Enter}");
    await user.type(field("Destination"), "EX-NLR-01{Enter}");
    await waitFor(() => expect(field("Start")).toHaveAttribute("aria-invalid", "true"), { timeout: ROUTING_MS });
    // No sentence on screen: the row's edge, with the reason on hover and for screen readers.
    expect(field("Start").closest(".place-box")).toHaveAttribute("title", expect.stringMatching(/Nowhere Junction XYZ/));
    expect(field("Start")).toHaveAccessibleDescription(/Nowhere Junction XYZ/);
    expect(screen.queryByRole("region", { name: "Routes" })).not.toBeInTheDocument();
  });

  it("saves the plan, and the saved route is listed", async () => {
    const user = userEvent.setup();
    await planExample(user);
    await user.click(screen.getByRole("button", { name: "Route actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Save route" }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/route\/saved\//), { timeout: ROUTING_MS });
    const [saved] = await api("GET /api/saved-routes");
    expect(saved.name).toBe("Taylor → North Little Rock");
    expect(saved.plan.places).toHaveLength(2);
    expect(window.location.pathname).toBe(`/route/saved/${saved.id}`);
    await api("DELETE /api/saved-routes/:routeId", { params: { routeId: saved.id } });
  });
});

describe("Shops", () => {
  it("lists each shop with its code and the railroads found from its node", async () => {
    openPage("/shops");
    const list = await screen.findByRole("region", { name: "Shop list" });
    const shops = await api("GET /api/shops");
    for (const shop of shops) {
      const row = (await within(list).findByText(shop.name)).closest("li")!;
      if (shop.code) expect(row).toHaveTextContent(shop.code);
      if (shop.place.ok) expect(within(row).getByRole("img", { name: `Carriers: ${shop.place.place.railroads.join(", ")}` })).toBeInTheDocument();
    }
  });
});
