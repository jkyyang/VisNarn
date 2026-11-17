// @vitest-environment jsdom
/**
 * The five screens, rendered from real answers of the real back end: the page's own App, in jsdom,
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
import type { BatchView } from "../shared/cars.ts";
import { callApi, clearQueryCache } from "../web/data/query.ts";
import { openPage, pretendPhone } from "../web/testing/page.tsx";
import { PILL_LABELS, STRATEGY_LABELS } from "../web/words.ts";

vi.mock("../web/map/MapCanvas.tsx", () => import("../web/testing/FakeMapCanvas.tsx"));
// Real routing in worker threads: a long continental route can take a few seconds the first time.
vi.setConfig({ testTimeout: 90_000 });

const ROUTING_MS = 30_000;
const HEADLINES = [
  "Check the route before using this result",
  "Prep may end too late",
  "Arrives after prep ends, with little room to spare",
  "Arrives after prep ends, with room to spare",
];
const PILL_WORDS = Object.values(PILL_LABELS);

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
let view: BatchView;
let exampleRow: number;
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
  const [batch] = await api("GET /api/batches");
  const deadline = Date.now() + 90_000;
  for (;;) {
    view = await api("GET /api/batches/:batchId", { params: { batchId: batch.id } });
    if (view.progress.checked === view.progress.total) break;
    if (Date.now() > deadline) throw new Error("The EXAMPLE batch was not checked in 90 s.");
    await new Promise((done) => setTimeout(done, 100));
  }
  exampleRow = view.cars.find((car) => car.carId.endsWith("104233"))!.row;
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

const verdictHeading = () => screen.findByRole("heading", { name: (name) => HEADLINES.includes(name) }, { timeout: ROUTING_MS });

describe("Main (Route)", () => {
  it("shows the EXAMPLE car's verdict headline, pills, the two position bounds, margin and assumption chips", async () => {
    openPage("/route");
    await verdictHeading();
    const verdict = screen.getByRole("region", { name: "Verdict" });
    const pills = [...verdict.querySelectorAll(".pill")];
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) expect(PILL_WORDS).toContain(pill.textContent);
    for (const label of ["If the car is at B now", "If the car just passed A", "Prep ends", "Margin at the earliest arrival"]) expect(within(verdict).getByText(label)).toBeInTheDocument();
    expect(within(verdict).getByText("Margin at the earliest arrival").nextElementSibling?.textContent).toMatch(/^[+−]\d/);
    expect(within(verdict).getByRole("button", { name: "400 km/day placeholder" })).toBeInTheDocument();
    expect(within(verdict).getByRole("button", { name: "+24 h per interchange" })).toBeInTheDocument();
  });

  it("lists every route option with its tags; the selected one is pressed", async () => {
    openPage("/route");
    await verdictHeading();
    const routes = screen.getByRole("region", { name: "Routes" });
    const cards = within(routes).getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed"));
    const count = Number(/^(\d+) routes?$/.exec(within(routes).getByRole("heading").textContent ?? "")?.[1]);
    expect(cards).toHaveLength(count);
    expect(cards.filter((card) => card.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    for (const card of cards) expect([...card.querySelectorAll(".tag")].some((tag) => Object.values(STRATEGY_LABELS).includes(tag.textContent ?? ""))).toBe(true);
    expect(within(cards[0]).getByText("Router’s pick")).toBeInTheDocument();
  });

  it("reads the steps from A to the shop, with the turn-back row linking to Fix route", async () => {
    openPage("/route");
    await verdictHeading();
    const steps = screen.getByRole("region", { name: "Steps" });
    const rows = within(steps).getAllByRole("listitem").filter((li) => li.classList.contains("step"));
    expect(rows[0]).toHaveTextContent("A · last passed");
    expect(rows[1]).toHaveTextContent(/Car is somewhere here · [\d,]+ km/);
    expect(rows[2]).toHaveTextContent("B · next node");
    expect(rows.some((row) => /Shop/.test(row.textContent ?? ""))).toBe(true);
    expect(rows.at(-1)).toHaveTextContent(/Route [\d,]+ km vs straight line [\d,]+ km/);
    const turnBacks = rows.filter((row) => row.classList.contains("step--warn"));
    expect(turnBacks.length).toBeGreaterThan(0);
    for (const row of turnBacks) {
      expect(row).toHaveTextContent(/Turns back .* \(yard track\): check/);
      expect(within(row).getByRole("link", { name: "Fix route" })).toHaveAttribute("href", expect.stringMatching(/^\/route\/fix\?at=\d+$/));
    }
  });

  it("a car that cannot be checked shows the problem at its field and no verdict, no times", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await verdictHeading();
    const b = screen.getByRole("combobox", { name: "B, next node (optional)" });
    await user.clear(b);
    await user.type(b, "Nowhere Junction XYZ");
    await user.click(screen.getByRole("button", { name: "Check with these changes" }));
    expect(await screen.findByRole("heading", { name: "Cannot check this car" }, { timeout: ROUTING_MS })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Verdict" })).toHaveTextContent(/B \(next node\):/);
    expect(b).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("If the car is at B now")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Routes" })).not.toBeInTheDocument();
  });

  it("while the speed is a placeholder no time shows minutes and the badge says Rough estimate", async () => {
    openPage("/route");
    await verdictHeading();
    expect(within(screen.getByRole("region", { name: "Verdict" })).getByText("Rough estimate")).toBeInTheDocument();
    const rough = [...document.querySelectorAll(".rough")].map((el) => el.textContent ?? "").filter(Boolean);
    expect(rough.length).toBeGreaterThan(3);
    for (const text of rough) expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("Cars", () => {
  it("groups the EXAMPLE batch under Act now / Check first / OK with the counts on the chips", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await waitFor(() => expect(document.querySelector(".parse-summary")).toHaveTextContent(`${view.cars.length} rows read`), { timeout: ROUTING_MS });
    const chips = within(screen.getByRole("group", { name: "Filter by group" })).getAllByRole("button");
    const counts = chips.map((chip) => Number(/(\d+)$/.exec(chip.textContent ?? "")?.[1]));
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(view.cars.length);
    await user.click(within(screen.getByRole("region", { name: "OK" })).getByRole("button"));
    ["Act now", "Check first", "OK"].forEach((name, i) => expect(within(screen.getByRole("region", { name })).queryAllByRole("link")).toHaveLength(counts[i]));
  });

  it("every status is a word and a shape, never colour alone; a car with a route problem is never On time", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await waitFor(() => expect(document.querySelector(".parse-summary")).toHaveTextContent("rows read"), { timeout: ROUTING_MS });
    await user.click(within(screen.getByRole("region", { name: "OK" })).getByRole("button"));
    const rows = screen.getAllByRole("link").filter((a) => a.classList.contains("car-row"));
    expect(rows).toHaveLength(view.cars.length);
    for (const row of rows) {
      const pills = [...row.querySelectorAll(".pill")];
      expect(pills.length).toBeGreaterThan(0);
      for (const pill of pills) {
        expect(PILL_WORDS).toContain(pill.textContent);
        expect(pill.querySelector("svg.shape")).not.toBeNull();
      }
      const words = pills.map((pill) => pill.textContent);
      if (words.includes("Check route") || words.includes("Cannot check")) expect(words).not.toContain("On time");
    }
  });

  it("the at-risk text groups act-now cars by shop and says the estimate is rough", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await waitFor(() => expect(document.querySelector(".parse-summary")).toHaveTextContent("rows read"), { timeout: ROUTING_MS });
    await user.click(screen.getByRole("button", { name: "Copy at-risk list" }));
    const text = await navigator.clipboard.readText();
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^(At-risk|No at-risk) cars, \w{3} \w{3} \d+ \(rough estimate, EXAMPLE\)$/);
    expect(lines.at(-1)).toBe("Assumes 400 km/day placeholder · +24 h per interchange · buffer 24 h");
    // The EXAMPLE shops are made-up locations, and the list the shop planner reads says so.
    for (const car of view.cars.filter((c) => c.group === "act-now")) expect(text).toContain(`${car.shop}${car.shopExample ? " (EXAMPLE shop)" : ""}\n  ${car.carId}`);
    expect(view.cars.filter((c) => c.group === "act-now").every((c) => c.shopExample)).toBe(true);
    for (const car of view.cars.filter((c) => c.group !== "act-now")) expect(text).not.toContain(car.carId);
  });

  it("pending rows show as being checked, with progress, not as OK", async () => {
    const csv = ["car_id,last_node,next_node,reported_at,shop,prep_end", 'PENDING 1,"Seattle, WA","Portland, OR",2026-11-17T08:00:00Z,EX-NPL-01,2026-11-25T00:00:00Z', 'PENDING 2,"Spokane, WA","Pasco, WA",2026-11-17T08:00:00Z,EX-CHI-01,2026-11-25T00:00:00Z'].join("\n");
    const batch = await api("POST /api/batches", { body: { name: "pending-check", asOf: "2026-11-17T12:00:00.000Z" as never, source: { kind: "csv", fileName: "pending.csv", text: csv } } });
    openPage(`/cars/${batch.id}`);
    await waitFor(() => expect(document.querySelector(".parse-summary")).toHaveTextContent(/Checking \d of 2…/), { timeout: ROUTING_MS });
    const pending = screen.getByRole("region", { name: "Still being checked" });
    expect(within(pending).getAllByText("Checking…").length).toBeGreaterThan(0);
    expect(within(pending).queryByText("On time")).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".parse-summary")).toHaveTextContent("2 rows read"), { timeout: ROUTING_MS });
  });
});

describe("Fix route", () => {
  it("shows Before / With your stop for length, interchanges, turn-backs, earliest arrival and status", async () => {
    const user = userEvent.setup();
    openPage(`/route/${view.batch.id}/${exampleRow}/fix`);
    await user.click(await screen.findByRole("button", { name: "Add a stop" }, { timeout: ROUTING_MS }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    // Where railroads meet, the page asks which line first; elsewhere the stop is added at once.
    const asked = () => screen.queryByRole("region", { name: "Which line?" });
    await waitFor(() => expect(asked() ?? screen.queryByRole("columnheader", { name: "With your stop" })).not.toBeNull(), { timeout: ROUTING_MS });
    const which = asked();
    if (which) await user.click(within(which).getAllByRole("radio")[0]);
    const changed = screen.getByRole("region", { name: "What changed" });
    await waitFor(() => expect(within(changed).getByRole("columnheader", { name: "With your stop" })).toBeInTheDocument(), { timeout: ROUTING_MS });
    const rows = within(changed).getAllByRole("rowheader").map((th) => th.textContent);
    expect(rows).toEqual(["Route length", "Interchanges", "Turn-backs", "Earliest arrival", "Status"]);
    for (const th of within(changed).getAllByRole("rowheader")) expect(th.closest("tr")!.querySelectorAll("td")).toHaveLength(2);
  });

  it("the junction inspector states subdivisions, headings, the angle and the track kind", async () => {
    openPage(`/route/${view.batch.id}/${exampleRow}/fix?at=0`);
    const inspector = await screen.findByRole("region", { name: "Junction inspector" }, { timeout: ROUTING_MS });
    expect(inspector).toHaveTextContent(/Arrives(on .+ )?heading (N|NE|E|SE|S|SW|W|NW)/);
    expect(inspector).toHaveTextContent(/Leaves.*heading (N|NE|E|SE|S|SW|W|NW)/);
    expect(inspector).toHaveTextContent(/Turn\d+°/);
    expect(inspector).toHaveTextContent(/Trackyard track/);
    expect(screen.getByTestId("map")).toHaveAttribute("data-tracks", "on");
  });

  it("'Use for this batch row' is offered for a batch row and not for a typed car", async () => {
    openPage(`/route/${view.batch.id}/${exampleRow}/fix`);
    expect(await screen.findByRole("button", { name: /for this batch row/ }, { timeout: ROUTING_MS })).toBeInTheDocument();
    clearQueryCache();
    document.body.innerHTML = "";
    openPage("/route/fix");
    await screen.findByRole("region", { name: "Stops" });
    await screen.findByText(/^EXAMPLE 104233 · /, {}, { timeout: ROUTING_MS });
    expect(screen.queryByRole("button", { name: /for this batch row/ })).not.toBeInTheDocument();
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
  it("the compact panel folds the inputs into one summary row and keeps verdict, route and steps", async () => {
    pretendPhone(true);
    const user = userEvent.setup();
    openPage("/route");
    await verdictHeading();
    const summary = screen.getByRole("button", { name: "Edit car position, shop and times" });
    expect(summary).toHaveTextContent("· A, last passed");
    expect(summary).toHaveTextContent("· B, next");
    expect(summary).toHaveTextContent("· shop");
    expect(screen.queryByRole("combobox", { name: "B, next node (optional)" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Routes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Steps" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Preview, not available yet" })).not.toBeInTheDocument();

    await user.click(summary);
    expect(screen.getByRole("combobox", { name: "B, next node (optional)" })).toBeInTheDocument();
  });
});
