// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopId } from "../../../shared/places.ts";
import type { SavedRouteId } from "../../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../../shared/railroads.ts";
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
const placeRows = () => within(screen.getByRole("region", { name: "Places" })).getAllByRole("listitem");
const stopRows = () => placeRows().slice(1, -1);
/** What each place row shows, in order. */
const rowValues = () => placeRows().map((row) => (within(row).getByRole("combobox") as HTMLInputElement).value);
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
      plan: { places: [{ kind: "text", text: "Omaha, NE" }, { kind: "text", text: "North Platte, NE" }], include: DEFAULT_INCLUDE },
      option: null,
      routeString: "",
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
    expect(hint()).toHaveTextContent("Click the map to set the destination.");
    await user.type(field("Destination"), "north little");
    await user.click(await screen.findByRole("option", { name: /North Little Rock, AR.*Your shop · EX-NLR-01/ }));
    expect(field("Destination")).toHaveValue("North Little Rock, AR");

    await waitFor(() => expect(routeRows()).toHaveLength(2));
    const [pick, shortest] = routeRows();
    expect(pick).toHaveAttribute("aria-pressed", "true");
    expect(pick).toHaveTextContent("1,046 km");
    // One line on a phone: km plus a short ⇄ chip; the word is only for screen readers and the tooltip.
    expect(shortest).toHaveAccessibleName("BNSF UP 839 km 1 interchange");
    expect(within(shortest).queryByText(/interchange/, { ignore: ".visually-hidden, script, style" })).toBeNull();
    expect(within(shortest).getByTitle("1 interchange")).toHaveClass("ix-chip");
    expect(legend()).toEqual(["BNSF", "↩Turn-back"]);
    expect(hint()).toHaveTextContent("Click the map to add a stop.");
    expect(fake.state.lastPlan).toEqual({ places: [{ kind: "text", text: "Temple, TX" }, { kind: "shop", shopId: "shop-ex-1" }], include: DEFAULT_INCLUDE });
  });

  it("a click on the map adds a stop; Undo takes it away and Redo brings it back", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    expect(await within(stopRows()[0]).findByDisplayValue("TEMPLE, TX wye")).toBeInTheDocument();
    await waitFor(() => expect(routeRows()).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(stopRows()).toHaveLength(0);
    await waitFor(() => expect(routeRows()).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Redo route change" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
  });

  it("where two railroads meet, the stop offers the next carrier: Router's pick | BNSF | UP; the choice is sent, and Undo puts Router's pick back", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    const lines = await screen.findByRole("radiogroup", { name: "Next carrier at Stop 1" });
    expect(within(lines).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Router's pick", "BNSF", "UP"]);
    expect(within(lines).getByRole("radio", { name: "Router's pick" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(lines).getByRole("radio", { name: "UP" }));
    await waitFor(() => expect(fake.state.lastPlan?.places[1]).toEqual({ kind: "node", fraId: 358070, railroad: "UP" }));
    expect(screen.getByRole("radio", { name: "UP" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(screen.getByRole("radio", { name: "Router's pick" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the chosen route as a route string, carriers and junctions only", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    const string = screen.getByRole("region", { name: "Route string" });
    expect(string).toHaveTextContent("BNSF");
    expect(string).not.toHaveTextContent("–");

    await user.click(routeRows()[1]);
    await waitFor(() => expect(screen.getByRole("region", { name: "Route string" })).toHaveTextContent("BNSF – [Fort Worth, TX] – UP"));
    expect(within(screen.getByRole("list", { name: "Sections" })).getByText("router's pick")).toBeInTheDocument();
  });

  it("Save saves a route with a railroad change; Reverse route flips the ends", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.type(field("Start"), "Kansas City, MO{Enter}");
    await user.type(field("Destination"), "Chicago, IL{Enter}");
    const string = await screen.findByRole("region", { name: "Route string" });
    expect(string).toHaveTextContent(/^BNSF – \[\d+ km from [^\]]+\] – CN/);

    const save = screen.getByRole("form", { name: "Save route" });
    await user.click(within(save).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.state.savedRoutes).toHaveLength(1));
    expect(fake.state.savedRoutes[0].routeString).toMatch(/^BNSF-\[\d+ km from [^\]]+\]-CN$/);

    const there = fake.state.lastPlan;
    await user.click(screen.getByRole("button", { name: "Reverse route" }));
    expect(field("Start")).toHaveValue("Chicago, IL");
    expect(field("Destination")).toHaveValue("Kansas City, MO");
    await waitFor(() => expect(fake.state.lastPlan?.places).toEqual(there?.places.toReversed()));
  });

  it("Class I is always on; ticking Short lines plans again with short lines included, and Undo unticks it", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    const track = screen.getByRole("group", { name: "Track" });
    expect(within(track).getAllByRole("checkbox").map((box) => [box.parentElement?.textContent, (box as HTMLInputElement).checked])).toEqual([
      ["Class I", true],
      ["Regional", false],
      ["Short lines", false],
      ["Passenger / commuter lines", true],
    ]);
    expect(within(track).getByRole("checkbox", { name: "Class I" })).toBeDisabled();

    await user.click(within(track).getByRole("checkbox", { name: "Short lines" }));
    await waitFor(() => expect(fake.state.lastPlan?.include).toEqual({ regional: false, shortLine: true, passenger: true }));

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(within(track).getByRole("checkbox", { name: "Short lines" })).not.toBeChecked();
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
    expect(tooltip).toHaveTextContent("Lampasas Sub S → N");
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
    // With no route there is no stop to add: the field's own line says what is wrong.
    expect(hint()).toBeEmptyDOMElement();
  });

  it("a saved route whose shop was deleted leaves that field empty with its one line", async () => {
    fake.state.savedRoutes.push({
      id: "route-9" as SavedRouteId,
      name: "EXAMPLE Kansas City → gone shop",
      plan: { places: [{ kind: "shop", shopId: "shop-ex-2" as ShopId }, { kind: "shop", shopId: "shop-gone" as ShopId }], include: DEFAULT_INCLUDE },
      option: null,
      routeString: "",
    });
    openPage("/route/saved/route-9");
    await waitFor(() => expect(field("Destination")).toHaveAttribute("aria-invalid", "true"));
    expect(field("Destination")).toHaveValue("");
    expect(field("Start")).toHaveValue("Kansas City, MO");
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
    await waitFor(() => expect(fake.state.savedRoutes[0].plan.places).toHaveLength(3));
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

  it("Enter takes the highlighted suggestion, else the first one, else the text as typed", async () => {
    const user = userEvent.setup();
    openPage("/route");
    const start = field("Start");
    await user.type(start, "kansas");
    await screen.findByRole("option", { name: /Kansas City, MO.*Your shop · EX-KCY-01/ });
    expect(start).not.toHaveAttribute("aria-activedescendant");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fake.state.lastPlan?.places[0]).toEqual({ kind: "shop", shopId: "shop-ex-2" }));
    expect(start).toHaveValue("Kansas City, MO");

    const destination = field("Destination");
    await user.type(destination, "Nowhere Junction{Enter}");
    await waitFor(() => expect(fake.state.lastPlan?.places[1]).toEqual({ kind: "text", text: "Nowhere Junction" }));
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
    await waitFor(() => expect(fake.state.lastPlan?.places[0]).toEqual({ kind: "node", fraId: 358070, railroad: null }));
    expect(stopRows()).toHaveLength(0);
  });

  it("an old or unknown link (/cars, /batch) opens the planner and the address bar says /route", async () => {
    for (const path of ["/cars", "/cars/new", "/batch", "/nowhere"]) {
      const page = openPage(path);
      expect(field("Start")).toHaveValue("");
      await waitFor(() => expect(currentPath(), path).toBe("/route"));
      page.unmount();
    }
  });

  it("every place is one row with the same buttons: + Add stop, remove, and a handle that reorders by keyboard", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(placeRows()).toHaveLength(3));
    for (const row of placeRows()) {
      expect(within(row).getByRole("combobox")).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^Pick on the map/ })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^Remove/ })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /^Move/ })).toBeInTheDocument();
    }

    // Space grabs the start, ↓ moves it below the stop, Space drops it: the stop is the start now.
    screen.getByRole("button", { name: "Move Start" }).focus();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Move Start" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(rowValues()).toEqual(["TEMPLE, TX wye", "Temple, TX", "North Little Rock, AR"]));
    expect(screen.getByRole("button", { name: "Move Stop 1" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Move Stop 1" })).toHaveAttribute("aria-pressed", "false");

    // Escape puts a grabbed row back where it was.
    screen.getByRole("button", { name: "Move Destination" }).focus();
    await user.keyboard(" {ArrowUp}{ArrowUp}");
    await waitFor(() => expect(rowValues()).toEqual(["North Little Rock, AR", "TEMPLE, TX wye", "Temple, TX"]));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(rowValues()).toEqual(["TEMPLE, TX wye", "Temple, TX", "North Little Rock, AR"]));

    // + Add stop opens an empty row before the destination with ⌖ on; the route still runs through the set rows.
    await user.click(screen.getByRole("button", { name: "+ Add stop" }));
    expect(placeRows()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Pick on the map: Stop 2" })).toHaveAttribute("aria-pressed", "true");
    expect(hint()).toHaveTextContent("Click the map to set stop 2.");
    await user.click(screen.getByRole("button", { name: "Remove Stop 2" }));
    expect(placeRows()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Remove Stop 1" }));
    expect(placeRows()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Start" })).toBeInTheDocument();
  });
});
