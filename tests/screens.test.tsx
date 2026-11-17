// @vitest-environment jsdom
/**
 * The screens, rendered from real answers of the real back end: the page's own App, in jsdom,
 * talking over HTTP to `node server/main.ts` started on a temp data folder and a free port. Only the
 * map canvas is replaced, because jsdom has no WebGL. The assertions hold for any network build: they
 * check what every answer must look like on screen, not one route's numbers.
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
import { RAILROADS } from "../shared/railroads.ts";
import { callApi, clearQueryCache } from "../web/data/query.ts";
import { openPage, pretendPhone } from "../web/testing/page.tsx";

vi.mock("../web/map/MapCanvas.tsx", () => import("../web/testing/FakeMapCanvas.tsx"));
// Real routing in worker threads: a long continental route can take a few seconds the first time.
vi.setConfig({ testTimeout: 90_000 });

const ROUTING_MS = 30_000;
/** Words for times and verdicts, which the planner never says. */
const CLOCK_WORDS = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\d{1,2}:\d{2}|prep|margin|on time|act now|check first|\bA to B\b|not live/i;

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
  // The page asks for "/api/…" on its own origin; here that origin is the test server. jsdom's
  // AbortSignal is not one Node's fetch accepts, so a superseded read simply finishes unheard.
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
  pretendPhone(false);
});

const field = (name: "Start" | "Destination") => screen.getByRole("combobox", { name });
const routeRows = () => within(screen.getByRole("region", { name: "Routes" })).getAllByRole("button");

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
    expect(rows.filter((row) => row.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    for (const row of rows) expect(row).toHaveTextContent(/[\d,]+ km/);
    const sections = within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem");
    expect(sections[0]).toHaveTextContent("Taylor");
    expect(sections.at(-1)).toHaveTextContent("North Little Rock");
    expect(sections.some((row) => /\b(BNSF|UP|CSXT|NS|CN|CPKC)\b [\d,]+ km/.test(row.textContent ?? ""))).toBe(true);

    // The legend lists the selected route's railroads and no others.
    const pressed = rows.find((row) => row.getAttribute("aria-pressed") === "true");
    const onRoute = RAILROADS.filter((railroad) => within(pressed!).queryByText(railroad));
    const legend = within(screen.getByRole("list", { name: "Railroad colors" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(legend.filter((item) => item !== "↩Turn-back")).toEqual(onRoute);
    expect(document.querySelector(".panel")?.textContent).not.toMatch(CLOCK_WORDS);
  });

  it("a click on the map adds a stop, which the route then runs through", async () => {
    const user = userEvent.setup();
    await planExample(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    const stops = await screen.findByRole("list", { name: "Stops" }, { timeout: ROUTING_MS });
    expect(within(stops).getAllByRole("listitem")).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem").some((row) => row.querySelector("svg text")?.textContent === "1")).toBe(true), {
      timeout: ROUTING_MS,
    });
  });

  it("a place that cannot be found shows its one line at its field, and no routes", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.type(field("Start"), "Nowhere Junction XYZ{Enter}");
    await user.type(field("Destination"), "EX-NLR-01{Enter}");
    await waitFor(() => expect(field("Start")).toHaveAttribute("aria-invalid", "true"), { timeout: ROUTING_MS });
    expect(screen.getByText(/Nowhere Junction XYZ/, { selector: ".place-problem" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Routes" })).not.toBeInTheDocument();
  });

  it("saves the plan, and the saved route is listed", async () => {
    const user = userEvent.setup();
    await planExample(user);
    await user.click(within(screen.getByRole("form", { name: "Save route" })).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" }, { timeout: ROUTING_MS })).toBeDisabled();
    const [saved] = await api("GET /api/saved-routes");
    expect(saved).toMatchObject({ name: "Taylor → North Little Rock", plan: { start: { kind: "text", text: "Taylor, TX" } } });
    expect(window.location.pathname).toBe(`/route/saved/${saved.id}`);
    await api("DELETE /api/saved-routes/:routeId", { params: { routeId: saved.id } });
  });
});

describe("Shops", () => {
  it("lists each shop with its code, location and the railroads found from its node", async () => {
    openPage("/shops");
    const table = await screen.findByRole("table");
    const shops = await api("GET /api/shops");
    for (const shop of shops) {
      const row = within(table).getByText(shop.name).closest("tr")!;
      if (shop.code) expect(row).toHaveTextContent(shop.code);
      expect(row).toHaveTextContent(/[−\d.]+, [−\d.]+/);
      if (shop.place.ok) expect(row).toHaveTextContent(shop.place.place.railroads.join(", "));
    }
  });

  it("the import preview lists rows that match no node, to fix before saving", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    const card = await screen.findByRole("region", { name: "Import shop list" });
    const csv = "name,lon,lat\nOmaha shop,-95.94,41.26\nShop in the ocean,-140,10\n";
    await user.upload(within(card).getByLabelText("Choose CSV file"), new File([csv], "shops.csv", { type: "text/csv" }));
    const preview = await within(card).findByRole("region", { name: "Import preview" }, { timeout: ROUTING_MS });
    expect(preview).toHaveTextContent(/1 shop is ready in shops.csv · 1 row matches no node/);
    expect(within(preview).getByRole("list", { name: "Rows to fix before saving" })).toHaveTextContent(/Line 3/);
    expect((await api("GET /api/shops")).map((s) => s.name)).not.toContain("Omaha shop");
  });
});

describe("Phone", () => {
  it("the phone panel has the same rows in one column: places, routes and sections, nothing folded", async () => {
    pretendPhone(true);
    const user = userEvent.setup();
    await planExample(user);
    expect(field("Start")).toHaveValue("Taylor, TX");
    expect(screen.getByRole("list", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Mode" })).toHaveTextContent(/^RouteShops$/);
  });
});
