// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedRouteId } from "../../../shared/plans.ts";
import { clearQueryCache } from "../../data/query.ts";
import { installFakeServer, type FakeServer } from "../../testing/fakeServer.ts";
import { currentPath, openPage } from "../../testing/page.tsx";

vi.mock("../../map/MapCanvas.tsx", () => import("../../testing/FakeMapCanvas.tsx"));

let fake: FakeServer;

beforeEach(() => {
  fake = installFakeServer();
});
afterEach(() => {
  fake.restore();
  clearQueryCache();
});

const field = (name: "Start" | "Destination") => screen.getByRole("combobox", { name });
const hint = () => screen.getByRole("status", { name: "" });
const routeRows = () => within(screen.getByRole("region", { name: "Routes" })).getAllByRole("button");
const stopRows = () => within(screen.getByRole("list", { name: "Stops" })).getAllByRole("listitem");
const legend = () => within(screen.getByRole("list", { name: "Railroad colors" })).getAllByRole("listitem").map((item) => item.textContent);

/** Temple, TX typed with Enter; North Little Rock, AR picked from the suggestions (the EXAMPLE shop). */
async function planTempleToLittleRock(user: ReturnType<typeof userEvent.setup>) {
  openPage("/route");
  await user.type(field("Start"), "Temple, TX{Enter}");
  await user.type(field("Destination"), "north little");
  await user.click(await screen.findByRole("option", { name: /North Little Rock, AR.*Your shop/ }));
  await waitFor(() => expect(routeRows()).toHaveLength(2));
}

describe("Route planner", () => {
  it("starts empty, with one hint line and the saved routes when there are any", async () => {
    fake.state.savedRoutes.push({
      id: "route-9" as SavedRouteId,
      name: "EXAMPLE Omaha → North Platte",
      plan: { start: { kind: "text", text: "Omaha, NE" }, stops: [], destination: { kind: "text", text: "North Platte, NE" } },
      option: null,
    });
    openPage("/route");
    expect(field("Start")).toHaveValue("");
    expect(field("Destination")).toHaveValue("");
    expect(hint()).toHaveTextContent("Click the start on the map, or type it.");
    expect(screen.queryByRole("region", { name: "Routes" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "EXAMPLE Omaha → North Platte" })).toHaveAttribute("href", "/route/saved/route-9");
  });

  it("a typed start and a chosen destination give the routes at once; the legend lists only the selected route's railroads", async () => {
    const user = userEvent.setup();
    openPage("/route");
    expect(await screen.findByText("EXAMPLE DATA")).toBeInTheDocument();
    await user.type(field("Start"), "Temple, TX{Enter}");
    expect(hint()).toHaveTextContent("Click the destination.");
    await user.type(field("Destination"), "north little");
    await user.click(await screen.findByRole("option", { name: /North Little Rock, AR.*Your shop · EX-NLR-01/ }));
    expect(field("Destination")).toHaveValue("North Little Rock, AR");

    await waitFor(() => expect(routeRows()).toHaveLength(2));
    const [pick, shortest] = routeRows();
    expect(pick).toHaveAttribute("aria-pressed", "true");
    expect(pick).toHaveTextContent("1,046 km");
    expect(shortest).toHaveTextContent("839 km · 1 interchange");
    expect(legend()).toEqual(["BNSF", "↩Turn-back"]);
    expect(hint()).toHaveTextContent("Click the map to add a stop.");
    expect(fake.state.lastPlan).toEqual({ start: { kind: "text", text: "Temple, TX" }, stops: [], destination: { kind: "shop", shopId: "shop-ex-1" } });
  });

  it("a click on the map adds a stop; Undo takes it away and Redo brings it back", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    expect(await within(stopRows()[0]).findByText("TEMPLE, TX wye")).toBeInTheDocument();
    await waitFor(() => expect(routeRows()).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(screen.queryByRole("list", { name: "Stops" })).not.toBeInTheDocument();
    await waitFor(() => expect(routeRows()).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Redo route change" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
  });

  it("where two railroads meet, the stop offers Any | BNSF | UP; the choice is sent, and Undo puts Any back", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    const lines = await screen.findByRole("radiogroup", { name: "Line at stop 1" });
    expect(within(lines).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Any", "BNSF", "UP"]);
    expect(within(lines).getByRole("radio", { name: "Any" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(lines).getByRole("radio", { name: "UP" }));
    await waitFor(() => expect(fake.state.lastPlan?.stops).toEqual([{ kind: "node", fraId: 358070, railroad: "UP" }]));
    expect(screen.getByRole("radio", { name: "UP" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(screen.getByRole("radio", { name: "Any" })).toHaveAttribute("aria-checked", "true");
  });

  it("a pill or a grey route on the map selects that route: the URL and the pressed row follow", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    expect(screen.getByRole("button", { name: "Route 1,046 km, selected" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Route −207 km · 1 more interchange" }));
    expect(currentPath()).toBe("/route?option=shortest");
    expect(routeRows()[1]).toHaveAttribute("aria-pressed", "true");
    expect(legend()).toEqual(["BNSF", "UP"]);

    await user.click(screen.getByRole("button", { name: "Grey route pick" }));
    expect(currentPath()).toBe("/route?option=pick");
    expect(routeRows()[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("a turn-back shows as ↩ on its row and an amber mark with two lines on hover; a stop that removes it removes both", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    expect(routeRows()[0]).toHaveTextContent("1 turn-back");
    const mark = screen.getByRole("button", { name: "Turn-back at Temple, TX" });
    await user.hover(mark);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Temple, TX · yard track (stub end)");
    expect(tooltip).toHaveTextContent("arrives on Lampasas Sub heading S · leaves heading N");
    expect(mark).toHaveAccessibleDescription(/Temple, TX · yard track/);
    await user.unhover(mark);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(routeRows()).toHaveLength(1));
    expect(routeRows()[0]).not.toHaveTextContent("turn-back");
    expect(screen.queryByRole("button", { name: /^Turn-back at/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(await screen.findByRole("button", { name: "Turn-back at Temple, TX" })).toBeInTheDocument();
  });

  it("a place that cannot be found shows its one line under its field, and no routes", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.type(field("Start"), "Nowhere Junction{Enter}");
    await user.type(field("Destination"), "Chicago, IL{Enter}");
    expect(await screen.findByText(/No place called “Nowhere Junction”/)).toBeInTheDocument();
    expect(field("Start")).toHaveAttribute("aria-invalid", "true");
    expect(field("Destination")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("region", { name: "Routes" })).not.toBeInTheDocument();
  });

  it("saves a route, lists it, saves a change, reopens it from the list and deletes it after a confirm", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    const save = screen.getByRole("form", { name: "Save route" });
    expect(within(save).getByRole("textbox", { name: "Route name" })).toHaveValue("Temple → North Little Rock");
    await user.click(within(save).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(currentPath()).toBe("/route/saved/route-1"));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Temple → North Little Rock" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("EXAMPLE DATA")).not.toBeInTheDocument();

    // A change to the plan makes it worth saving again.
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(routeRows()).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.savedRoutes[0].plan.stops).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();

    // New starts an empty plan; the list opens the saved one again, stops and all.
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(currentPath()).toBe("/route");
    await waitFor(() => expect(field("Start")).toHaveValue(""));
    await user.click(screen.getByRole("link", { name: "Temple → North Little Rock" }));
    expect(currentPath()).toBe("/route/saved/route-1");
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    expect(field("Start")).toHaveValue("Temple, TX");

    await user.click(screen.getByRole("button", { name: "Delete Temple → North Little Rock" }));
    const confirm = screen.getByRole("group", { name: "Delete Temple → North Little Rock" });
    expect(within(confirm).getByRole("button", { name: "Keep" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fake.state.savedRoutes).toEqual([]));
    await waitFor(() => expect(currentPath()).toBe("/route"));
  });

  it("Enter takes the text as typed; only a suggestion reached with the arrow keys is taken on Enter", async () => {
    const user = userEvent.setup();
    openPage("/route");
    const start = field("Start");
    await user.type(start, "kansas");
    await screen.findByRole("option", { name: /Kansas City, MO.*Your shop · EX-KCY-01/ });
    expect(start).not.toHaveAttribute("aria-activedescendant");
    await user.keyboard("{Enter}");
    expect(start).toHaveValue("kansas");
    await waitFor(() => expect(fake.state.lastPlan?.start).toEqual({ kind: "text", text: "kansas" }));

    await user.clear(start);
    await user.type(start, "kansas");
    await screen.findByRole("option", { name: /Kansas City, MO.*Your shop · EX-KCY-01/ });
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(fake.state.lastPlan?.start).toEqual({ kind: "shop", shopId: "shop-ex-2" }));
    expect(start).toHaveValue("Kansas City, MO");
  });

  it("⌖ sends the next click to its field, and Esc turns it off", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Pick on the map: Start" }));
    expect(hint()).toHaveTextContent("Click the map to set the start.");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Pick on the map: Start" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Pick on the map: Start" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(fake.state.lastPlan?.start).toEqual({ kind: "node", fraId: 358070, railroad: null }));
    expect(screen.queryByRole("list", { name: "Stops" })).not.toBeInTheDocument();
  });

  it("the panel says no time, date or verdict anywhere", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(routeRows()).toHaveLength(1));
    const text = document.querySelector(".panel")?.textContent ?? "";
    expect(text).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\d{1,2}:\d{2}|prep|margin|on time|act now|check first|\bA to B\b|not live/i);
  });
});
