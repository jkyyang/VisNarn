// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueryCache } from "../../data/query.ts";
import { installFakeServer, type FakeServer } from "../../testing/fakeServer.ts";
import { currentPath, openPage } from "../../testing/page.tsx";

vi.mock("../../map/MapCanvas.tsx", () => import("../../testing/FakeMapCanvas.tsx"));

let fake: FakeServer;

beforeEach(() => {
  // A fixed morning, so the EXAMPLE car's times (and its pills) are the same on every run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 17, 9, 30));
  fake = installFakeServer();
});
afterEach(() => {
  fake.restore();
  clearQueryCache();
  vi.useRealTimers();
});

const routeCard = (name: RegExp) => screen.getByRole("button", { name });

describe("Route screen (Main)", () => {
  it("shows the EXAMPLE car's verdict with both routes, and choosing the other route changes the verdict, the steps and the URL", async () => {
    const user = userEvent.setup();
    openPage("/route");

    expect(await screen.findByRole("heading", { name: "Check the route before using this result" })).toBeInTheDocument();
    const verdict = screen.getByRole("region", { name: "Verdict" });
    expect(within(verdict).getByText("Check route")).toBeInTheDocument();
    expect(within(verdict).getByText("Rough estimate")).toBeInTheDocument();
    expect(within(verdict).getByText("If the car is at B now").nextElementSibling?.textContent).toMatch(/^about \w{3} \d+ (early|morning|afternoon|evening|night)$/);
    expect(screen.getByRole("heading", { name: "2 routes" })).toBeInTheDocument();

    const pick = routeCard(/^BNSF via Lampasas and Little Rock subs/);
    const other = routeCard(/^UP via Fort Worth/);
    expect(pick).toHaveAttribute("aria-pressed", "true");
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(within(other).getByText(/^−207 km, 1 more interchange, about \d+ h later$/)).toBeInTheDocument();
    expect(within(pick).getByText("Router’s pick")).toBeInTheDocument();

    await user.click(other);

    expect(routeCard(/^UP via Fort Worth/)).toHaveAttribute("aria-pressed", "true");
    expect(currentPath()).toBe("/route?option=shortest");
    expect(screen.getByRole("heading", { name: "Arrives after prep ends, with room to spare" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Steps · UP via Fort Worth" })).toBeInTheDocument();
    expect(screen.getByText("Change railroad BNSF → UP at Fort Worth, TX")).toBeInTheDocument();
    expect(screen.getByText("Map: route shortest, 1 grey, ghost none, 3 pins")).toBeInTheDocument();
  });

  it("a click on the grey route on the map selects it too", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await user.click(await screen.findByRole("button", { name: "Grey route shortest" }));
    expect(routeCard(/^UP via Fort Worth/)).toHaveAttribute("aria-pressed", "true");
  });

  it("reads the steps from A to the shop, and a leg's subdivisions open and close", async () => {
    const user = userEvent.setup();
    openPage("/route");
    const steps = await screen.findByRole("region", { name: "Steps" });
    const rows = within(steps).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toMatch(/Taylor, TX.*A · last passed/);
    expect(rows[1]).toMatch(/Car is somewhere here · \d+ km/);
    expect(rows[2]).toMatch(/Temple, TX.*B · next node/);
    expect(rows[3]).toMatch(/Turns back at Temple, TX \(yard track\): check/);
    expect(rows.some((row) => row.includes("Yard turn-back time: not counted"))).toBe(true);
    expect(rows.some((row) => /Route 1,046 km vs straight line \d+ km/.test(row))).toBe(true);

    const toggle = within(steps).getByRole("button", { name: "7 subdivisions" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(steps).queryByText("Lampasas Sub")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(steps).getByText("Lampasas Sub")).toBeInTheDocument();
    expect(within(steps).getByText("Little Rock Sub")).toBeInTheDocument();
    await user.click(toggle);
    expect(within(steps).queryByText("Lampasas Sub")).not.toBeInTheDocument();
  });

  it("adds a stop from the map, asks which line where two railroads meet, and Undo takes it back", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });

    await user.click(screen.getByRole("button", { name: "Add stop (pass through a node)" }));
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Click the map to add a stop");
    await user.click(screen.getByRole("button", { name: "Click the map" }));

    const which = await screen.findByRole("region", { name: "Which line?" });
    expect(which).toHaveTextContent("Snaps to TEMPLE, TX wye");
    expect(which).toHaveTextContent("Which line? Two railroads meet here.");
    await user.click(within(which).getByRole("radio", { name: "BNSF" }));

    const form = screen.getByRole("form", { name: "Car position and shop" });
    expect(await within(form).findByText(/Via TEMPLE, TX wye/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "1 route" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Routes" })).getByText("926 km")).toBeInTheDocument();
    expect(fake.calls.filter((c) => c.path === "/api/check").at(-1)?.body).toMatchObject({ report: { stops: [{ place: { kind: "node", fraId: 358070, railroad: "BNSF" } }] } });

    await user.click(screen.getByRole("button", { name: "Undo route change" }));
    expect(await screen.findByRole("heading", { name: "2 routes" })).toBeInTheDocument();
    expect(within(form).queryByText(/Via TEMPLE, TX wye/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Redo route change" }));
    expect(await within(form).findByText(/Via TEMPLE, TX wye/)).toBeInTheDocument();
  });

  it("Esc cancels picking on the map", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });
    const addStop = screen.getByRole("button", { name: "Add stop (pass through a node)" });
    await user.click(addStop);
    expect(screen.getByRole("button", { name: "Click the map" })).toBeInTheDocument();
    expect(screen.getByText(/to cancel/)).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Click the map" })).not.toBeInTheDocument();
    expect(screen.queryByText(/to cancel/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add stop (pass through a node)" })).toHaveAttribute("aria-pressed", "false");
  });

  it("a place that cannot be found shows the problem at its field, and no verdict or times", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });
    const b = screen.getByRole("combobox", { name: "B, next node (optional)" });
    await user.clear(b);
    await user.type(b, "Nowhere Junction");
    await user.click(screen.getByRole("button", { name: "Check with these changes" }));

    expect(await screen.findByRole("heading", { name: "Cannot check this car" })).toBeInTheDocument();
    expect(screen.getByText(/No place called “Nowhere Junction”/, { selector: "li" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "B, next node (optional)" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("If the car is at B now")).not.toBeInTheDocument();
    expect(screen.queryByText("On time")).not.toBeInTheDocument();
  });

  it("suggests places while typing, and a suggestion becomes the place", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });
    const shop = screen.getByRole("combobox", { name: "Shop · from Your shops" });
    await user.clear(shop);
    await user.type(shop, "kansas");
    const option = await screen.findByRole("option", { name: /Kansas City, MO.*Your shop · EX-KCY-01/ });
    await user.click(option);
    expect(shop).toHaveValue("Kansas City, MO");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Enter checks the text as typed; only a suggestion reached with the arrow keys is taken on Enter", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });
    const shop = screen.getByRole("combobox", { name: "Shop · from Your shops" });
    await user.clear(shop);
    await user.type(shop, "kansas");
    await screen.findByRole("option", { name: /Kansas City, MO.*Your shop · EX-KCY-01/ });
    expect(shop).not.toHaveAttribute("aria-activedescendant");
    await user.keyboard("{Enter}");
    expect(shop).toHaveValue("kansas");
    await waitFor(() => expect(fake.calls.filter((c) => c.path === "/api/check").at(-1)?.body).toMatchObject({ report: { shop: { kind: "text", text: "kansas" } } }));

    await user.clear(shop);
    await user.type(shop, "kansas");
    await screen.findByRole("option", { name: /Kansas City, MO.*Your shop · EX-KCY-01/ });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(shop).toHaveValue("Kansas City, MO");
  });

  it("swaps A and B in one click, and checks again at once", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });
    await user.click(screen.getByRole("button", { name: "Swap A and B" }));
    expect(screen.getByRole("combobox", { name: "Car is between · A, last passed" })).toHaveValue("Temple, TX");
    expect(screen.getByRole("combobox", { name: "B, next node (optional)" })).toHaveValue("Taylor, TX");
    await waitFor(() => expect(fake.calls.filter((c) => c.path === "/api/check").at(-1)?.body).toMatchObject({ report: { a: { text: "Temple, TX" }, b: { text: "Taylor, TX" } } }));
  });

  it("Show on map opens Fix route at the turn-back with the junction inspector and real tracks", async () => {
    const user = userEvent.setup();
    openPage("/route");
    const steps = await screen.findByRole("region", { name: "Steps" });
    await user.click(within(steps).getByRole("button", { name: "Show on map" }));

    expect(currentPath()).toBe("/route/fix?at=0");
    const inspector = await screen.findByRole("region", { name: "Junction inspector" });
    expect(inspector).toHaveTextContent("on Lampasas Sub heading S");
    expect(inspector).toHaveTextContent("176°");
    expect(inspector).toHaveTextContent("yard track (stub end)");
    expect(screen.getByTestId("map")).toHaveAttribute("data-tracks", "on");
    expect(screen.getByTestId("map")).toHaveAttribute("data-focus", "place");
  });

  it("the assumption chips open an editor, and saving a new speed re-times the car", async () => {
    const user = userEvent.setup();
    openPage("/route");
    await screen.findByRole("heading", { name: "Check the route before using this result" });
    await user.click(screen.getByRole("button", { name: "400 km/day placeholder" }));
    const editor = screen.getByRole("form", { name: "Edit assumptions" });
    const speed = within(editor).getByRole("textbox", { name: "Speed" });
    await user.clear(speed);
    await user.type(speed, "800");
    await user.click(within(editor).getByRole("button", { name: "Save assumptions" }));

    expect(await screen.findByRole("button", { name: "800 km/day placeholder" })).toBeInTheDocument();
    expect(fake.state.assumptions.timing.speedKmPerDay).toBe(800);
    expect(screen.queryByRole("form", { name: "Edit assumptions" })).not.toBeInTheDocument();
  });
});
