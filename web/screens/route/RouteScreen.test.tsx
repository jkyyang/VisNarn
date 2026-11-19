// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopId } from "../../../shared/places.ts";
import type { SavedRouteId } from "../../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../../shared/railroads.ts";
import { clearQueryCache } from "../../data/query.ts";
import { setNextMapClick } from "../../testing/FakeMapCanvas.tsx";
import { installFakeServer, type FakeServer } from "../../testing/fakeServer.ts";
import { currentPath, openPage } from "../../testing/page.tsx";

vi.mock("../../map/MapCanvas.tsx", () => import("../../testing/FakeMapCanvas.tsx"));

let fake: FakeServer;

beforeEach(() => {
  fake = installFakeServer();
});
afterEach(() => {
  setNextMapClick();
  fake.restore();
  clearQueryCache();
  localStorage.clear();
});

const field = (name: "Start" | "Destination") => screen.getByRole("combobox", { name });
const hint = () => screen.getByRole("status", { name: "" });
const routeRows = () => within(screen.getByRole("region", { name: "Routes" })).getAllByRole("button");
/** How many routes were found: a row each when there are two or more, else the one result card. */
const routeCount = () => (screen.queryByRole("region", { name: "Routes" }) ? routeRows().length : screen.queryByRole("region", { name: "Route" }) ? 1 : 0);
/** Route options folds; open it to reach its switches. */
async function routeOptions(user: ReturnType<typeof userEvent.setup>) {
  const options = screen.getByRole("region", { name: "Route options" });
  const head = within(options).getByRole("button", { name: /^Route options/ });
  if (head.getAttribute("aria-expanded") !== "true") await user.click(head);
  return options;
}
const placeRows = () => within(screen.getByRole("region", { name: "Places" })).getAllByRole("listitem");
const stopRows = () => placeRows().slice(1, -1);
/** What each place row shows, in order. */
const rowValues = () => placeRows().map((row) => (within(row).getByRole("combobox") as HTMLInputElement).value);
/** The railroads the selected route runs on, in the order its legs in the result card name them. */
const selectedRailroads = () => [...new Set([...screen.getByRole("region", { name: "Route" }).querySelectorAll(".leg-carrier")].map((cell) => cell.textContent))];

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
      plan: { places: [{ kind: "text", text: "Omaha, NE" }, { kind: "text", text: "North Platte, NE" }], include: DEFAULT_INCLUDE, turnAtStops: false },
      option: null,
      routeString: "",
    });
    openPage("/route");
    expect(field("Start")).toHaveValue("");
    expect(field("Destination")).toHaveValue("");
    expect(hint()).toHaveTextContent("Click the map to set Start · Esc to cancel");
    expect(screen.queryByRole("region", { name: "Routes" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "EXAMPLE Omaha → North Platte" })).toHaveAttribute("href", "/route/saved/route-9");
  });

  it("a typed start and a chosen destination give the routes at once; the result card names the selected route's railroads and turn-backs", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.type(field("Start"), "Temple, TX{Enter}");
    expect(hint()).toHaveTextContent("Click the map to set Destination · Esc to cancel");
    await user.type(field("Destination"), "north little");
    await user.click(await screen.findByRole("option", { name: /North Little Rock, AR.*Your shop · EX-NLR-01/ }));
    expect(field("Destination")).toHaveValue("North Little Rock, AR");

    await waitFor(() => expect(routeRows()).toHaveLength(2));
    const [pick, shortest] = routeRows();
    expect(pick).toHaveAttribute("aria-pressed", "true");
    expect(pick).toHaveTextContent("1,046 km");
    // A row per route, as in the Shops list: its carriers; its interchanges, turn-backs and why it is offered; its length.
    expect(shortest).toHaveAccessibleName("BNSF · UP 1 interchange · shortest 839 km");
    // The result card under them is the selected route: its length, carriers and interchanges.
    expect(screen.getByRole("region", { name: "Route" })).toHaveTextContent(/1,046 km1 carrier · 0 interchanges · 1 turn-back/);
    expect(selectedRailroads()).toEqual(["BNSF"]);
    // Every row is set: a click on the map places nothing.
    expect(screen.queryByRole("button", { name: "Click the map" })).not.toBeInTheDocument();
    expect(fake.state.lastPlan).toEqual({ places: [{ kind: "text", text: "Temple, TX" }, { kind: "shop", shopId: "shop-ex-1" }], include: DEFAULT_INCLUDE, turnAtStops: false });
  });

  it("Add stop, then a click on the map, sets a stop; Undo takes it away and Redo brings it back", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    expect(await within(stopRows()[0]).findByDisplayValue("TEMPLE, TX wye")).toBeInTheDocument();
    await waitFor(() => expect(routeCount()).toBe(1));

    // One Undo empties the stop with its ⌖ on again, the next takes the row away.
    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(screen.getByRole("button", { name: "Pick on the map: Stop 1" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(stopRows()).toHaveLength(0);
    await waitFor(() => expect(routeCount()).toBe(2));
    await user.click(screen.getByRole("button", { name: "Redo route change" }));
    await user.click(screen.getByRole("button", { name: "Redo route change" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
  });

  it("a stop's row and its pin on the map pick each other: the row flies to it, the pin also turns its ⌖ on", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    const row = await within(screen.getByRole("list", { name: "Sections" })).findByRole("button", { name: /^Stop 1: / });
    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("map")).toHaveAttribute("data-fly", "place");
    await user.keyboard("{Escape}");
    expect(row).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Pin TEMPLE, TX wye" }));
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("map")).toHaveAttribute("data-fly", "none");
    expect(screen.getByRole("button", { name: "Pick on the map: Stop 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("where two railroads meet, Route options offers the carrier from there: a click goes Router's pick → BNSF → UP → Router's pick; the choice is sent and summed up, and Undo puts it back", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    const options = await routeOptions(user);
    const carrier = () => within(options).getByRole("button", { name: /^Carrier from TEMPLE, TX wye/ });
    expect(await within(options).findByRole("button", { name: "Carrier from TEMPLE, TX wye: Router's pick" })).toBeInTheDocument();

    await user.click(carrier());
    expect(carrier()).toHaveAccessibleName("Carrier from TEMPLE, TX wye: BNSF");
    await user.click(carrier());
    expect(carrier()).toHaveAccessibleName("Carrier from TEMPLE, TX wye: UP");
    await waitFor(() => expect(fake.state.lastPlan?.places[1]).toEqual({ kind: "node", fraId: 358070, railroad: "UP" }));
    await user.click(screen.getByRole("button", { name: /^Route options/ }));
    expect(screen.getByRole("button", { name: /^Route options/ })).toHaveTextContent("Class I · Passenger · UP from TEMPLE, TX wye");

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(screen.getByRole("button", { name: /^Route options/ })).toHaveTextContent("Class I · Passenger · BNSF from TEMPLE, TX wye");
  });

  it("shows the chosen route as a row per carrier, from where to where; Copy route string copies its carriers and junctions", async () => {
    const user = userEvent.setup();
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
    await planTempleToLittleRock(user);
    await user.click(routeRows()[1]);
    const legs = () => within(screen.getByRole("list", { name: "Sections" })).getAllByRole("button");
    await waitFor(() => expect(legs().map((leg) => leg.textContent)).toEqual([expect.stringMatching(/^BNSFTemple → Fort Worth/), expect.stringMatching(/^UPFort Worth → North Little Rock/)]));
    await user.click(screen.getByRole("button", { name: "Route actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy route string" }));
    expect(copied).toEqual(["BNSF – [Fort Worth, TX] – UP"]);
    // ⋯ says it worked with a ✓ for a moment.
    await waitFor(() => expect(screen.getByRole("button", { name: "Route actions" }).querySelector(".dot")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Route actions" }).querySelector(".dot")).not.toBeNull(), { timeout: 2000 });
  });

  it("Save saves a route with a railroad change; Reverse route flips the ends", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.type(field("Start"), "Kansas City, MO{Enter}");
    await user.type(field("Destination"), "Chicago, IL{Enter}");
    await screen.findByRole("region", { name: "Route" });
    await user.click(screen.getByRole("button", { name: "Route actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Save route" }));
    await waitFor(() => expect(fake.state.savedRoutes).toHaveLength(1));
    expect(fake.state.savedRoutes[0].routeString).toMatch(/^BNSF-\[\d+ km from [^\]]+\]-CN$/);

    const there = fake.state.lastPlan;
    await user.click(screen.getByRole("button", { name: "Route actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Reverse route" }));
    expect(field("Start")).toHaveValue("Chicago, IL");
    expect(field("Destination")).toHaveValue("Kansas City, MO");
    await waitFor(() => expect(fake.state.lastPlan?.places).toEqual(there?.places.toReversed()));
  });

  it("Class I is always on; ticking Short lines plans again with short lines included, and Undo unticks it", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    // Folded, the card says what is on.
    expect(screen.getByRole("button", { name: /^Route options/ })).toHaveTextContent("Route optionsClass I · Passenger");
    const track = await routeOptions(user);
    expect(track).toHaveTextContent(/Class I linesAlways on/);
    expect(within(track).getAllByRole("switch").map((on) => [on.textContent, on.getAttribute("aria-checked")])).toEqual([
      ["Regional lines", "false"],
      ["Short lines", "false"],
      ["Passenger lines", "true"],
      ["Turn at stops", "false"],
    ]);

    await user.click(within(track).getByRole("switch", { name: "Short lines" }));
    await waitFor(() => expect(fake.state.lastPlan?.include).toEqual({ regional: false, shortLine: true, passenger: true }));

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(within(track).getByRole("switch", { name: "Short lines" })).toHaveAttribute("aria-checked", "false");
  });

  it("Turn at stops plans again with turning at stops, and Undo unticks it", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    const turn = within(await routeOptions(user)).getByRole("switch", { name: "Turn at stops" });
    expect(turn).toHaveAttribute("title", "The route may leave a stop in either direction");
    await user.click(turn);
    await waitFor(() => expect(fake.state.lastPlan?.turnAtStops).toBe(true));
    await user.click(screen.getByRole("button", { name: /^Route options/ }));
    expect(screen.getByRole("button", { name: /^Route options/ })).toHaveTextContent("Class I · Passenger · Turn at stops");
    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(screen.getByRole("button", { name: /^Route options/ })).toHaveTextContent(/Class I · Passenger$/);
  });

  it("Units in the Layers card shows every distance in miles, and back in km; this browser keeps the choice", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: /^Map layers/ }));
    const units = screen.getByRole("radiogroup", { name: "Units" });
    expect(within(units).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["km", "mi"]);
    expect(within(units).getByRole("radio", { name: "km" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(units).getByRole("radio", { name: "mi" }));
    expect(localStorage.getItem("visnarn.distance-unit")).toBe("mi");
    expect(routeRows()[0]).toHaveTextContent(/650 mi$/);
    expect(routeRows()[1]).toHaveTextContent(/521 mi$/);
    expect(screen.getByRole("button", { name: "Route 650 mi, selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Route −129 mi · 1 more interchange" })).toBeInTheDocument();
    const sections = within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem");
    expect(sections.filter((row) => /\d mi$/.test(row.textContent ?? ""))).not.toHaveLength(0);
    expect(sections.filter((row) => /\d km$/.test(row.textContent ?? ""))).toHaveLength(0);

    await user.click(within(units).getByRole("radio", { name: "km" }));
    expect(routeRows()[0]).toHaveTextContent(/1,046 km$/);
    expect(localStorage.getItem("visnarn.distance-unit")).toBe("km");

    // The card is a popover: Escape closes it.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radiogroup", { name: "Units" })).not.toBeInTheDocument();
  });

  it("a pill on the map selects that route: the URL and the pressed row follow", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    expect(screen.getByRole("button", { name: "Route 1,046 km, selected" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Route −207 km · 1 more interchange" }));
    expect(currentPath()).toBe("/route?option=shortest");
    expect(routeRows()[1]).toHaveAttribute("aria-pressed", "true");
    expect(selectedRailroads()).toEqual(["BNSF", "UP"]);

    await user.click(screen.getByRole("button", { name: /^Route \+207 km/ }));
    expect(currentPath()).toBe("/route?option=pick");
    expect(routeRows()[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("a click on a grey route selects it; while ⌖ is on, it sets the row at that line's nearest node and keeps the selected route", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Grey route shortest" }));
    expect(currentPath()).toBe("/route?option=shortest");
    expect(stopRows()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Grey route pick" }));
    expect(currentPath()).toBe("/route?option=pick");

    await user.click(screen.getByRole("button", { name: "Add stop" }));
    // On the grey route's track 17 km north of Waco: too far for a click on the map to snap to any node.
    setNextMapClick(-97.1615, 31.7);
    await user.click(screen.getByRole("button", { name: "Grey route shortest" }));
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    expect(within(stopRows()[0]).getByRole("combobox")).toHaveValue("Waco, TX");
    expect(currentPath()).toBe("/route?option=pick");
  });

  it("a turn-back shows as ↩ on its row and an amber mark with two lines on hover; a stop that removes it removes both", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    expect(routeRows()[0]).toHaveTextContent("1 turn-back");
    const mark = within(screen.getByTestId("map")).getByRole("button", { name: "Turn-back at Temple, TX" });
    await user.hover(mark);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Temple, TX · yard track (stub end)");
    expect(tooltip).toHaveTextContent("Lampasas Sub S → N");
    expect(mark).toHaveAccessibleDescription(/Temple, TX · yard track/);
    await user.unhover(mark);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add stop" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(routeCount()).toBe(1));
    expect(screen.getByRole("region", { name: "Route" })).not.toHaveTextContent("turn-back");
    expect(screen.queryByRole("button", { name: /^Turn-back at/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(await within(screen.getByTestId("map")).findByRole("button", { name: "Turn-back at Temple, TX" })).toBeInTheDocument();
  });

  it("a turn-back's row and its mark on the map pick each other; picked in the panel it is flown to, on the map the camera stays", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    const map = screen.getByTestId("map");
    const row = within(screen.getByRole("list", { name: "Sections" })).getByRole("button", { name: "Turn-back at Temple, TX" });
    const mark = within(map).getByRole("button", { name: "Turn-back at Temple, TX" });

    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(mark).toHaveAttribute("aria-pressed", "true");
    expect(map).toHaveAttribute("data-fly", "place");
    await user.click(row);
    expect(mark).toHaveAttribute("aria-pressed", "false");

    await user.click(mark);
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(map).toHaveAttribute("data-fly", "none");
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
      plan: { places: [{ kind: "shop", shopId: "shop-ex-2" as ShopId }, { kind: "shop", shopId: "shop-gone" as ShopId }], include: DEFAULT_INCLUDE, turnAtStops: false },
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
    const menu = async (item: string) => {
      await user.click(screen.getByRole("button", { name: "Route actions" }));
      return screen.getByRole("menuitem", { name: item });
    };
    await user.click(await menu("Save route"));

    await waitFor(() => expect(currentPath()).toBe("/route/saved/route-1"));
    expect(fake.state.savedRoutes[0].name).toBe("Temple → North Little Rock");
    await waitFor(async () => expect(await menu("Saved")).toBeDisabled());
    await user.keyboard("{Escape}");
    // Saved routes opens on its row, lit once; the open route is renamed there.
    expect(screen.getByRole("button", { name: /^Saved routes/ })).toHaveAttribute("aria-expanded", "true");
    const name = screen.getByRole("textbox", { name: "Route name" });
    expect(name.closest(".saved-row")).toHaveClass("is-lit");
    expect(name).toHaveValue("Temple → North Little Rock");
    await user.clear(name);
    await user.type(name, "Temple run{Enter}");
    await waitFor(() => expect(fake.state.savedRoutes[0].name).toBe("Temple run"));

    // A change to the plan makes it worth saving again.
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(routeCount()).toBe(1));
    await user.click(await menu("Save route"));
    await waitFor(() => expect(fake.state.savedRoutes[0].plan.places).toHaveLength(3));

    // New starts an empty plan; the list opens the saved one again, stops and all.
    await user.click(await menu("New route"));
    expect(currentPath()).toBe("/route");
    await waitFor(() => expect(field("Start")).toHaveValue(""));
    await user.click(screen.getByRole("link", { name: "Temple run" }));
    expect(currentPath()).toBe("/route/saved/route-1");
    await waitFor(() => expect(stopRows()).toHaveLength(1));
    expect(field("Start")).toHaveValue("Temple, TX");

    await user.click(screen.getByRole("button", { name: "Delete Temple run" }));
    const confirm = screen.getByRole("group", { name: "Delete Temple run" });
    expect(within(confirm).getByRole("button", { name: "Keep" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fake.state.savedRoutes).toEqual([]));
    await waitFor(() => expect(currentPath()).toBe("/route"));
  });

  it("on the public site a saved route opens, plans and copies, with nothing to save, rename or delete", async () => {
    fake.state.readOnly = true;
    fake.state.savedRoutes.push({
      id: "route-9" as SavedRouteId,
      name: "EXAMPLE Temple run",
      plan: { places: [{ kind: "text", text: "Temple, TX" }, { kind: "shop", shopId: "shop-ex-1" as ShopId }], include: DEFAULT_INCLUDE, turnAtStops: false },
      option: null,
      routeString: "",
    });
    const user = userEvent.setup();
    openPage("/route/saved/route-9");
    await waitFor(() => expect(routeRows()).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: /^Saved routes/ }));
    expect(screen.getByRole("link", { name: "EXAMPLE Temple run" })).toHaveAttribute("href", "/route/saved/route-9");
    expect(screen.queryByRole("textbox", { name: "Route name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete EXAMPLE Temple run" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Route actions" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Reverse route", "Copy route string", "New route"]);
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
    expect(hint()).toHaveTextContent("Click the map to set Start · Esc to cancel");
    // On screen the pressed ⌖ shows it, and the crosshair on the map.
    expect(screen.getByRole("button", { name: "Pick on the map: Start" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Pick on the map: Start" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Pick on the map: Start" }));
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    await waitFor(() => expect(fake.state.lastPlan?.places[0]).toEqual({ kind: "node", fraId: 358070, railroad: null }));
    expect(stopRows()).toHaveLength(0);
  });

  it("with no ⌖ on, a shop square is found as with the search, and one of the plan's pins turns its row's ⌖ on", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getAllByRole("button", { name: /^Shop square / })[0]);
    // The card opens where the camera is: no flight.
    expect(await screen.findByText(/^Found: /)).toHaveAttribute("data-fly", "false");
    expect(rowValues()).toEqual(["Temple, TX", "North Little Rock, AR"]);
    await user.click(screen.getByRole("button", { name: "Pin Temple, TX" }));
    expect(screen.getByRole("button", { name: "Pick on the map: Start" })).toHaveAttribute("aria-pressed", "true");
    // The second click of a double click lands on the pin just set: it changes nothing.
    await user.click(screen.getByRole("button", { name: "Pin Temple, TX" }));
    expect(screen.getByRole("button", { name: "Pick on the map: Start" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an old or unknown link (/cars, /batch) opens the planner and the address bar says /route", async () => {
    for (const path of ["/cars", "/cars/new", "/batch", "/nowhere"]) {
      const page = openPage(path);
      expect(field("Start")).toHaveValue("");
      await waitFor(() => expect(currentPath(), path).toBe("/route"));
      page.unmount();
    }
  });

  it("every place is one row with the same buttons: Add stop, remove, and a handle that reorders by keyboard", async () => {
    const user = userEvent.setup();
    await planTempleToLittleRock(user);
    await user.click(screen.getByRole("button", { name: "Add stop" }));
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

    // Add stop opens an empty row before the destination with ⌖ on; the route still runs through the set rows.
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    expect(placeRows()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Pick on the map: Stop 2" })).toHaveAttribute("aria-pressed", "true");
    expect(hint()).toHaveTextContent("Click the map to set Stop 2 · Esc to cancel");
    await user.click(screen.getByRole("button", { name: "Remove Stop 2" }));
    expect(placeRows()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Remove Stop 1" }));
    expect(placeRows()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Start" })).toBeInTheDocument();
  });
});
