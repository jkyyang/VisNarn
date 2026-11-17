// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueryCache } from "../../data/query.ts";
import { toLocalInput } from "../../format.ts";
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

const group = (name: string) => screen.getByRole("region", { name });
const summary = () => document.querySelector(".parse-summary");
const rowIds = (region: HTMLElement) => within(region).queryAllByRole("link").map((a) => a.querySelector(".car-id")?.textContent);

describe("Cars screen", () => {
  it("groups the EXAMPLE batch under Act now / Check first / OK with the counts on the chips, OK folded", async () => {
    openPage("/cars");
    expect(await screen.findByRole("heading", { name: /^Morning list · Tue Nov 17$/ })).toBeInTheDocument();
    expect(summary()).toHaveTextContent("6 rows read · 0 need fixing · reports 0 days old");
    const chips = screen.getByRole("group", { name: "Filter by group" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Act now 2", "Check first 2", "OK 2"]);
    expect(rowIds(group("Act now"))).toEqual(["551930", "402196"]);
    expect(rowIds(group("Check first"))).toEqual(["104233", "318045"]);
    const ok = within(group("OK")).getByRole("button", { name: /^OK · 2/ });
    expect(ok).toHaveAttribute("aria-expanded", "false");
    expect(rowIds(group("OK"))).toEqual([]);
    expect(screen.getByRole("link", { name: /^Cars/ })).toHaveTextContent("Cars2");
  });

  it("every status is a word and a shape, and a car with a route problem never says On time", async () => {
    openPage("/cars");
    const row = await screen.findByRole("link", { name: /318045/ });
    expect(within(row).getByText("Check route").querySelector("svg.shape")).not.toBeNull();
    expect(within(row).queryByText("On time")).not.toBeInTheDocument();
    expect(row).toHaveTextContent("Timing looks fine, but 2 turn-backs: Hamilton, ON and Chicago, IL.");
    expect(within(await screen.findByRole("link", { name: /402196/ })).getAllByText(/At risk|Check route/).map((p) => p.textContent)).toEqual(["At risk", "Check route"]);
  });

  it("selects the most urgent car first and shows its card over the map", async () => {
    openPage("/cars");
    const card = await screen.findByRole("region", { name: "Selected car 551930" });
    expect(card).toHaveTextContent("Prep may end too late: the car can arrive about 14 h before prep ends.");
    expect(await within(card).findByText(/Minneapolis, MN → shop Kansas City, MO/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /551930/ })).toHaveAttribute("aria-current", "true");
  });

  it("walks the list with the keys: ↑ ↓ move, Enter opens the route, F opens Fix route", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Selected car 551930" });

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("link", { name: /402196/ })).toHaveAttribute("aria-current", "true"));
    expect(currentPath()).toBe("/cars/batch-example?car=2");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("link", { name: /318045/ })).toHaveAttribute("aria-current", "true"));
    // OK is folded, so the walk stops at the last row it can see.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: /318045/ })).toHaveAttribute("aria-current", "true");
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getByRole("link", { name: /104233/ })).toHaveAttribute("aria-current", "true"));

    await user.keyboard("f");
    expect(currentPath()).toBe("/route/batch-example/0/fix");
    expect(await screen.findByRole("heading", { name: "Fix route" })).toBeInTheDocument();
    window.history.back();
    await waitFor(() => expect(currentPath()).toBe("/cars/batch-example?car=0"));
    await screen.findByRole("region", { name: "Selected car 104233" });
    await user.keyboard("{Enter}");
    expect(currentPath()).toBe("/route/batch-example/0");
    expect(await screen.findByRole("combobox", { name: "B, next node (optional)" })).toHaveValue("Temple, TX");
  });

  it("the list keys stay in the list: Enter on a tab or on a focused row does what that link says", async () => {
    const user = userEvent.setup();
    openPage("/cars?car=4");
    await screen.findByRole("region", { name: "Act now" });
    // Enter on a row opens that row, not the selected one.
    const row = screen.getByRole("link", { name: /402196/ });
    row.focus();
    await user.keyboard("{Enter}");
    expect(currentPath()).toBe("/route/batch-example/2");
    window.history.back();
    await waitFor(() => expect(currentPath()).toBe("/cars?car=4"));
    await screen.findByRole("region", { name: "Act now" });
    // F and the arrows on the tabs are the tabs' own: the selected car does not open, the list does not move.
    const shopsTab = screen.getByRole("link", { name: "Shops" });
    shopsTab.focus();
    await user.keyboard("f{ArrowDown}");
    expect(currentPath()).toBe("/cars?car=4");
    expect(shopsTab).toHaveFocus();
  });

  it("C copies a note about the selected car", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Selected car 551930" });
    await user.keyboard("c");
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("551930 → Kansas City, MO: Can arrive about 14 h before prep ends. (rough estimate)"));
    expect(await screen.findByText(/^Copied: 551930/)).toBeInTheDocument();
  });

  it("the chips hide a group and the shop filter keeps one shop's cars; both are in the URL", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    await user.click(screen.getByRole("button", { name: /^Act now 2/ }));
    expect(screen.getByRole("button", { name: /^Act now 2/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Act now" })).not.toBeInTheDocument();
    expect(currentPath()).toBe("/cars/batch-example?hide=act-now");

    await user.click(screen.getByRole("button", { name: /^Act now 2/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Shop" }), "Kansas City, MO");
    expect(rowIds(group("Act now"))).toEqual(["551930"]);
    expect(rowIds(group("Check first"))).toEqual([]);
    expect(currentPath()).toBe("/cars/batch-example?shop=Kansas+City%2C+MO");
  });

  it("'Copy at-risk list' puts the act-now cars, grouped by shop, on the clipboard and shows what it copied", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    await user.click(screen.getByRole("button", { name: "Copy at-risk list" }));
    const text = await navigator.clipboard.readText();
    expect(text.split("\n")[0]).toBe("At-risk cars, Tue Nov 17 (rough estimate, EXAMPLE)");
    expect(text).toContain("Birmingham, AL (EXAMPLE shop)\n  402196  can arrive ~13 h before prep ends");
    expect(text).not.toContain("104233");
    expect(screen.getByText("Copied")).toBeInTheDocument();
    expect(screen.getByText(/^At-risk cars, Tue Nov 17/)).toBeInTheDocument();
  });

  it("rows still being routed show as being checked, with progress, never as OK", async () => {
    fake.state.pendingReads = 1;
    openPage("/cars");
    await waitFor(() => expect(summary()).toHaveTextContent("Checking 0 of 6…"));
    const pending = screen.getByRole("region", { name: "Still being checked" });
    expect(within(pending).getAllByText("Checking…")).toHaveLength(6);
    expect(within(screen.getByRole("group", { name: "Filter by group" })).getByRole("button", { name: /^OK/ })).toHaveTextContent("OK 0");
    // The list reads again on its own until every row is checked.
    await waitFor(() => expect(summary()).toHaveTextContent("6 rows read"), { timeout: 3000 });
    expect(screen.queryByRole("region", { name: "Still being checked" })).not.toBeInTheDocument();
  });

  it("a click on a car marker selects that car", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await user.click(await screen.findByRole("button", { name: "Car 663012 on the map" }));
    expect(await screen.findByRole("region", { name: "Selected car 663012" })).toBeInTheDocument();
  });

  it("uploads a CSV as a new batch and shows it", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    await user.click(screen.getByRole("button", { name: "Upload batch" }));
    const dialog = screen.getByRole("dialog", { name: "Upload batch" });
    expect(dialog).toHaveTextContent("Columns car_id, last_node, next_node, shop, reported_at, prep_end");
    const csv = ["car_id,last_node,next_node,reported_at,shop,prep_end", '777001,"Fargo, ND","Minneapolis, MN",2026-11-17T08:00:00Z,EX-KCY-01,2026-11-19T00:00:00Z', "777002,Nowhere,Somewhere,2026-11-17T08:00:00Z,EX-KCY-01,2026-11-19T00:00:00Z"].join("\n");
    await user.upload(within(dialog).getByLabelText("CSV file"), new File([csv], "cars-nov18.csv", { type: "text/csv" }));
    expect(within(dialog).getByRole("textbox", { name: "Batch name" })).toHaveValue("cars-nov18");
    await user.click(within(dialog).getByRole("button", { name: "Upload and check" }));

    expect(await screen.findByRole("link", { name: /777001/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const unreadable = screen.getByRole("link", { name: /777002/ });
    expect(within(unreadable).getByText("Cannot check")).toBeInTheDocument();
    expect(within(group("Check first")).getByRole("link", { name: /777002/ })).toBeInTheDocument();
  });

  it("the upload dialog keeps focus inside, leaves the list alone, and gives focus back to Upload batch", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    const opener = screen.getByRole("button", { name: "Upload batch" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Upload batch" });
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `Tab ${i + 1}`).toBe(true);
    }
    await user.keyboard("{ArrowDown}");
    expect(currentPath()).toBe("/cars");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("Enter in 'How files are read' saves those settings; it does not upload with the change unsaved", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    await user.click(screen.getByRole("button", { name: "Upload batch" }));
    const dialog = screen.getByRole("dialog", { name: "Upload batch" });
    await user.upload(within(dialog).getByLabelText("CSV file"), new File(["car_id\n1"], "cars.csv", { type: "text/csv" }));
    await user.click(within(dialog).getByRole("button", { name: "Change how files are read" }));
    expect(within(dialog).getByRole("button", { name: "Upload and check" })).toBeDisabled();
    const column = within(dialog).getByLabelText("Car id column");
    await user.clear(column);
    await user.type(column, "wagon{Enter}");
    expect(screen.getByRole("dialog", { name: "Upload batch" })).toBeInTheDocument();
    await waitFor(() => expect(dialog).toHaveTextContent(/Columns wagon, last_node/));
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/api/batches")).toEqual([]);
    expect(within(dialog).getByRole("button", { name: "Upload and check" })).toBeEnabled();
  });

  it("deletes a batch after asking, and shows the next one", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    await user.click(screen.getByRole("button", { name: "Delete this batch" }));
    const ask = screen.getByRole("group", { name: "Delete this batch" });
    expect(within(ask).getByRole("button", { name: "Keep it" })).toHaveFocus();
    await user.click(within(ask).getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("heading", { name: "No batch yet" })).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/batches/batch-example")).toBe(true);
  });

  it("the summary says how old the oldest report is, and how many are too old to trust", async () => {
    const user = userEvent.setup();
    openPage("/cars");
    await screen.findByRole("region", { name: "Act now" });
    await user.click(screen.getByRole("button", { name: "Upload batch" }));
    const dialog = screen.getByRole("dialog", { name: "Upload batch" });
    const csv = [
      "car_id,last_node,next_node,reported_at,shop,prep_end",
      '777010,"Fargo, ND","Minneapolis, MN",2026-11-17T12:00:00Z,EX-KCY-01,2026-11-24T00:00:00Z',
      '777011,"Fargo, ND","Minneapolis, MN",2026-11-20T06:00:00Z,EX-KCY-01,2026-11-24T00:00:00Z',
    ].join("\n");
    await user.upload(within(dialog).getByLabelText("CSV file"), new File([csv], "cars-nov20.csv", { type: "text/csv" }));
    fireEvent.change(within(dialog).getByLabelText("Positions as of"), { target: { value: toLocalInput(new Date("2026-11-20T12:00:00Z")) } });
    await user.click(within(dialog).getByRole("button", { name: "Upload and check" }));

    await screen.findByRole("link", { name: /777010/ });
    await waitFor(() => expect(summary()).toHaveTextContent("2 rows read · 0 need fixing · reports up to 3 days old · 1 too old to trust"));
  });

  it("with no batch at all, offers the upload", async () => {
    fake.state.batches = [];
    openPage("/cars");
    expect(await screen.findByRole("heading", { name: "No batch yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload batch" })).toBeInTheDocument();
  });
});
