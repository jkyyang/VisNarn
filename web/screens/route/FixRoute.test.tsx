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
  fake = installFakeServer();
});
afterEach(() => {
  fake.restore();
  clearQueryCache();
});

/** Row 0 of the EXAMPLE batch is car 104233, the one that turns back at Temple. */
const ROW_FIX = "/route/batch-example/0/fix?at=0";

async function addWyeStop(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Add a stop" }));
  await user.click(screen.getByRole("button", { name: "Click the map" }));
  await user.click(within(await screen.findByRole("region", { name: "Which line?" })).getByRole("radio", { name: "BNSF" }));
}

describe("Fix route", () => {
  it("shows the step with the problem and the junction inspector, with real tracks forced on", async () => {
    openPage(ROW_FIX);
    const problem = await screen.findByRole("region", { name: "The step with the problem" });
    expect(problem).toHaveTextContent("Turns back at Temple, TX (yard track): check");
    expect(problem).toHaveTextContent("Arrives on Lampasas Sub heading S, leaves heading N");
    expect(screen.getByRole("heading", { name: "Fix route" })).toBeInTheDocument();
    expect(screen.getByText(/^104233 · Temple, TX → North Little Rock, AR$/)).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Junction inspector" })).toHaveTextContent("Turn176°");
    expect(screen.getByTestId("map")).toHaveAttribute("data-tracks", "on");
    await userEvent.setup().click(screen.getByRole("button", { name: /^Map layers/ }));
    expect(screen.getByRole("checkbox", { name: "Real tracks" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Real tracks" })).toHaveAttribute("aria-disabled", "true");
  });

  it("a stop at the wye shows Before / With your stop, and the delta balloon's Undo takes it back", async () => {
    const user = userEvent.setup();
    openPage(ROW_FIX);
    await addWyeStop(user);

    const changed = screen.getByRole("region", { name: "What changed" });
    const row = async (name: string) => (await within(changed).findByRole("rowheader", { name })).closest("tr")!;
    expect(await row("Route length")).toHaveTextContent("1,046 km926 km");
    expect(await row("Turn-backs")).toHaveTextContent("10");
    expect(await row("Interchanges")).toHaveTextContent("00");
    expect(within(await row("Status")).getByText("Check route")).toBeInTheDocument();

    const balloon = screen.getByText("Grey dashed line = the old route").closest("[role=status]") as HTMLElement;
    expect(balloon).toHaveTextContent("−120 km · same interchanges · now:");
    expect(screen.getByText(/ghost shown/)).toBeInTheDocument();

    await user.click(within(balloon).getByRole("button", { name: "Undo" }));
    expect(await within(screen.getByRole("region", { name: "What changed" })).findByText(/Add a stop where the route should pass/)).toBeInTheDocument();
    expect(screen.queryByText("Grey dashed line = the old route")).not.toBeInTheDocument();
  });

  it("a stop can be typed instead of clicked: the place snaps to the network as a click there would", async () => {
    const user = userEvent.setup();
    openPage(ROW_FIX);
    await user.click(await screen.findByRole("button", { name: "Add a stop" }));
    const field = screen.getByRole("combobox", { name: "Or type the stop: a node, code or city" });
    await user.type(field, "Temple");
    await screen.findByRole("option", { name: /Temple, TX/ });
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByRole("region", { name: "Stops" })).toHaveTextContent(/Via Temple, TX.*Added by you/));
    expect(screen.queryByRole("combobox", { name: "Or type the stop: a node, code or city" })).not.toBeInTheDocument();
  });

  it("a check that fails says so instead of 'Checking the route…' for ever", async () => {
    fake.state.down = true;
    openPage("/route/fix");
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /Couldn't check this car/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("Checking the route…")).not.toBeInTheDocument();
  });

  it("a batch row that cannot be loaded says so, with no form and no 'Saved for this batch row'", async () => {
    for (const path of ["/route/nope/3", "/route/nope/3/fix", "/route/batch-example/99/fix"]) {
      const page = openPage(path);
      const alert = await screen.findByRole("alert");
      expect(alert, path).toHaveTextContent("This batch row could not be loaded.");
      expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(within(alert).getByRole("link", { name: "Back to Cars" })).toHaveAttribute("href", "/cars");
      expect(screen.queryByRole("form", { name: "Car position and shop" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Saved for this batch row|uses the router's own route/)).not.toBeInTheDocument();
      page.unmount();
      clearQueryCache();
    }
  });

  it("'Use for this batch row' saves the stops on the server, and the list then says Route set by you", async () => {
    const user = userEvent.setup();
    openPage(ROW_FIX);
    const use = await screen.findByRole("button", { name: "Saved for this batch row" });
    expect(use).toBeDisabled();
    await addWyeStop(user);

    const save = await screen.findByRole("button", { name: "Use for this batch row" });
    expect(screen.getByText(/Row 1 of “EXAMPLE cars-nov17.csv” will show the tag Route set by you/)).toBeInTheDocument();
    await user.click(save);

    expect(await screen.findByRole("button", { name: "Saved for this batch row" })).toBeDisabled();
    expect(fake.state.fixes.get("batch-example/0")?.stops).toEqual([{ place: { kind: "node", fraId: 358070, railroad: "BNSF" }, note: null }]);
    expect(within(screen.getByRole("region", { name: "Stops" })).getByText("Route set by you")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Back to route" }));
    await user.click(screen.getByRole("link", { name: /^Cars/ }));
    expect(currentPath()).toBe("/cars");
    const row = await screen.findByRole("link", { name: /104233/ });
    expect(row).toHaveTextContent("Route set by you");
  });

  it("'Keep' puts the delta balloon away and keeps the stop", async () => {
    const user = userEvent.setup();
    openPage(ROW_FIX);
    await addWyeStop(user);
    const balloon = (await screen.findByText("Grey dashed line = the old route")).closest("[role=status]") as HTMLElement;
    await user.click(within(balloon).getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Grey dashed line = the old route")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Stops" })).toHaveTextContent("Via TEMPLE, TX wye");
    expect(currentPath()).toBe("/route/batch-example/0/fix");
  });

  it("is not offered for a car typed by hand: there is no batch row to save to", async () => {
    openPage("/route/fix");
    await screen.findByRole("region", { name: "The step with the problem" });
    expect(screen.queryByRole("button", { name: /batch row/ })).not.toBeInTheDocument();
  });

  it("the back arrow returns to the whole route and keeps the stops added here", async () => {
    const user = userEvent.setup();
    openPage("/route/fix?at=0");
    await addWyeStop(user);
    await user.click(screen.getByRole("link", { name: "Back to route" }));
    expect(currentPath()).toBe("/route");
    const form = await screen.findByRole("form", { name: "Car position and shop" });
    expect(await within(form).findByText(/Via TEMPLE, TX wye/)).toBeInTheDocument();
  });
});
