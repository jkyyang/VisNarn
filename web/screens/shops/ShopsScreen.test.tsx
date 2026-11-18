// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueryCache } from "../../data/query.ts";
import { installFakeServer, type FakeServer } from "../../testing/fakeServer.ts";
import { setNextMapClick } from "../../testing/FakeMapCanvas.tsx";
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

const table = () => screen.getByRole("table");
const names = () =>
  within(table())
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector(".shop-name")?.textContent);

describe("Shops screen", () => {
  it("lists each shop with its code and the railroads found from its node", async () => {
    openPage("/shops");
    expect(await screen.findByRole("heading", { name: "Your shops" })).toBeInTheDocument();
    expect(await screen.findByText("EX-NLR-01")).toBeInTheDocument();
    const nlr = screen.getByText("EX-NLR-01").closest("tr")!;
    expect(nlr).toHaveTextContent("North Little Rock, AREXAMPLE");
    expect(nlr).toHaveTextContent("BNSF, UP");
    expect(screen.getByText("6 shops · 6 EXAMPLE")).toBeInTheDocument();
    expect(screen.getByText("Map: 6 shops")).toBeInTheDocument();
  });

  it("search keeps the shops whose name or code matches", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    await screen.findByText("EX-NLR-01");
    await user.type(screen.getByRole("textbox", { name: "Search shops" }), "ex-c");
    expect(names()).toEqual(["Chicago, ILEXAMPLE", "Calgary, ABEXAMPLE"]);
  });

  it("adds a shop: Save stays off until the location is on the network", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    await user.click(await screen.findByRole("button", { name: "Add shop" }));
    expect(currentPath()).toBe("/shops/new");
    const form = screen.getByRole("region", { name: "Add shop" });
    const save = within(form).getByRole("button", { name: "Save shop" });
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "Temple yard shop");
    expect(save).toBeDisabled();

    await user.type(within(form).getByRole("combobox", { name: "Location" }), "-140, 70");
    expect(await within(form).findByText("No track near -140, 70.")).toBeInTheDocument();
    expect(save).toBeDisabled();

    const location = within(form).getByRole("combobox", { name: "Location" });
    await user.clear(location);
    await user.type(location, "-97.34, 31.10");
    expect(await within(form).findByText("On the network · BNSF, UP")).toBeInTheDocument();
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText("Temple yard shop")).toBeInTheDocument();
    expect(currentPath()).toBe("/shops");
    expect(fake.state.shops.map((s) => s.name)).toContain("Temple yard shop");
    expect(screen.queryByRole("region", { name: "Add shop" })).not.toBeInTheDocument();
  });

  it("Location suggests places as the planner does: a typed 'kansas' offers Kansas City, MO, and Enter takes it", async () => {
    const user = userEvent.setup();
    openPage("/shops/new");
    const form = await screen.findByRole("region", { name: "Add shop" });
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "x");
    const location = within(form).getByRole("combobox", { name: "Location" });
    await user.type(location, "kansas");
    expect(await within(form).findByRole("option", { name: /Kansas City, MO.*City/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(location).toHaveValue("Kansas City, MO");
    expect(within(form).queryByRole("listbox")).not.toBeInTheDocument();
    expect(await within(form).findByText(/^On the network/)).toBeInTheDocument();
    await waitFor(() => expect(within(form).getByRole("button", { name: "Save shop" })).toBeEnabled());
  });

  it("edits a shop's name, and refuses a code another shop already has", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    await user.click(await screen.findByRole("button", { name: "Edit Kansas City, MO" }));
    const form = screen.getByRole("region", { name: "Edit shop" });
    expect(screen.getByRole("button", { name: "Edit Kansas City, MO" })).toHaveTextContent("Editing");
    // The form takes focus at its first box, so on a phone, where it opens below the list, the tap visibly did something.
    expect(within(form).getByRole("textbox", { name: "Name" })).toHaveFocus();
    const code = within(form).getByRole("textbox", { name: /Shop code/ });
    await user.clear(code);
    await user.type(code, "EX-NLR-01");
    await waitFor(() => expect(within(form).getByRole("button", { name: "Save shop" })).toBeEnabled());
    await user.click(within(form).getByRole("button", { name: "Save shop" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent('The shop "North Little Rock, AR" already has the code EX-NLR-01. Give each shop its own code.');

    await user.clear(code);
    await user.type(code, "EX-KCY-02");
    const name = within(form).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Kansas City shop 2");
    await user.click(within(form).getByRole("button", { name: "Save shop" }));
    expect(await screen.findByText("Kansas City shop 2")).toBeInTheDocument();
    expect(screen.getByText("EX-KCY-02")).toBeInTheDocument();
  });

  it("deletes a shop after asking once more", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    await user.click(await screen.findByRole("button", { name: "Edit Calgary, AB" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    // A second click where "Delete" was, or Enter, cannot delete: that button is gone and "Keep it" has focus.
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("button", { name: "Yes, delete this shop" })).not.toBeInTheDocument();
    expect(fake.state.shops).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete this shop" }));
    await waitFor(() => expect(names()).not.toContain("Calgary, ABEXAMPLE"));
    expect(fake.state.shops).toHaveLength(5);
  });

  it("picks a shop's location on the map; Esc cancels picking", async () => {
    const user = userEvent.setup();
    openPage("/shops/new");
    const form = await screen.findByRole("region", { name: "Add shop" });
    await user.click(within(form).getByRole("button", { name: "Pick on map" }));
    expect(screen.getByText(/Click the map to set the shop/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/Click the map to set the shop/)).not.toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Pick on map" }));
    setNextMapClick(-97.362, 31.121);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    expect(await within(form).findByDisplayValue("TEMPLE, TX wye · FRA node 358070")).toBeInTheDocument();
    expect(await within(form).findByText("On the network · BNSF, UP")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-focus", "place");
  });

  it("Pick on map brings the map into view, as on a phone the list may have scrolled it away", async () => {
    const user = userEvent.setup();
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      openPage("/shops/new");
      const form = await screen.findByRole("region", { name: "Add shop" });
      scrolled.length = 0;
      await user.click(within(form).getByRole("button", { name: "Pick on map" }));
      expect(screen.getByText(/Click the map to set the shop/)).toBeInTheDocument();
      expect(scrolled).toContain(screen.getByRole("region", { name: "Map" }));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("the import preview lists the rows that will not be saved, with why; then saves the rest", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    const card = await screen.findByRole("region", { name: "Import shop list" });
    const csv = "name,lon,lat\nShop at Omaha,-95.94,41.26\nShop at Denver,-104.99,39.74\nShop in the sea,-140,10\n";
    await user.upload(within(card).getByLabelText("Choose CSV file"), new File([csv], "shops.csv", { type: "text/csv" }));

    const preview = await within(card).findByRole("region", { name: "Import preview" });
    expect(preview).toHaveTextContent("shops.csv · 2 ready · 1 not saved");
    expect(within(preview).getByRole("list", { name: "Rows to fix before saving" })).toHaveTextContent("Line 4: No track near -140, 10.");
    expect(fake.state.shops).toHaveLength(6);

    await user.click(within(preview).getByRole("button", { name: "Save 2 shops" }));
    expect(await within(card).findByText("Saved 2 shops.")).toBeInTheDocument();
    expect(await screen.findByText("Shop at Omaha")).toBeInTheDocument();
    expect(fake.state.shops).toHaveLength(8);
  });
});
