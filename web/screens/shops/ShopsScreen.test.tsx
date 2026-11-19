// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvedOf, type FraId } from "../../../shared/places.ts";
import { clearQueryCache } from "../../data/query.ts";
import { installFakeServer, type FakeServer } from "../../testing/fakeServer.ts";
import { setNextMapClick } from "../../testing/FakeMapCanvas.tsx";
import { currentPath, openPage, pretendPhone } from "../../testing/page.tsx";

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
    expect(nlr).toHaveTextContent("North Little Rock, AREX-NLR-01");
    expect(nlr).toHaveTextContent("BNSF, UP");
    expect(screen.getByText("6 shops")).toBeInTheDocument();
    expect(screen.getByText("Map: 6 shops")).toBeInTheDocument();
  });

  it("search keeps the shops whose name or code matches", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    await screen.findByText("EX-NLR-01");
    await user.type(screen.getByRole("textbox", { name: "Search shops" }), "ex-c");
    expect(names()).toEqual(["Chicago, IL", "Calgary, AB"]);
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
    // A location just given is wired at once to where its track most likely joins the network.
    expect(await within(form).findByText("Temple · FRA 600001")).toBeInTheDocument();
    expect(within(form).queryByText("Suggested")).not.toBeInTheDocument();
    expect(within(form).getByText("On the network")).toBeInTheDocument();
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText("Temple yard shop")).toBeInTheDocument();
    expect(fake.calls.filter((call) => call.method === "POST" && call.path === "/api/shops").at(-1)?.body).toMatchObject({ links: [600001] });
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
    // Keep has focus, so Enter or a second click cannot delete.
    const confirm = () => screen.queryByRole("group", { name: "Delete this shop?" });
    expect(within(confirm()!).getByRole("button", { name: "Keep" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(confirm()).not.toBeInTheDocument();
    expect(fake.state.shops).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(confirm()!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(names()).not.toContain("Calgary, AB"));
    expect(fake.state.shops).toHaveLength(5);
  });

  it("a new shop is placed by a click on the map, and linked to the track there", async () => {
    const user = userEvent.setup();
    openPage("/shops/new");
    const form = await screen.findByRole("region", { name: "Add shop" });
    expect(within(form).getByRole("combobox", { name: "Location" })).toHaveAttribute("placeholder", "e.g. Kansas City, MO, or click the map");
    expect(screen.queryByRole("button", { name: /Pick on map/ })).not.toBeInTheDocument();
    setNextMapClick(-97.362, 31.121);
    await user.click(screen.getByRole("button", { name: "Click the map" }));
    expect(await within(form).findByDisplayValue("-97.362, 31.121")).toBeInTheDocument();
    expect(await within(form).findByText("TEMPLE, TX wye · FRA 358070")).toBeInTheDocument();
    expect(screen.getByText("Map: 6 shops, link 1")).toBeInTheDocument();
    expect(screen.getByText("Handles: New shop, Move link 1, Add link")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toHaveAttribute("data-focus", "place");
    // Placed, the shop's pin moves by dragging it; a click on the map places nothing more.
    expect(screen.queryByRole("button", { name: "Click the map" })).not.toBeInTheDocument();
  });

  describe("track links", () => {
    const links = () => screen.getByRole("group", { name: "Track links" });
    const lastSent = () => fake.calls.filter((call) => call.method === "PUT").at(-1)?.body as { links: unknown[] } | undefined;
    const rows = () => within(links()).queryAllByRole("button", { name: /^Remove link/ }).length;
    const tapMap = async (user: ReturnType<typeof userEvent.setup>, lon: number, lat: number) => {
      setNextMapClick(lon, lat);
      await user.click(screen.getByRole("button", { name: "Click the map" }));
    };
    const dragOnMap = async (user: ReturnType<typeof userEvent.setup>, handle: string, lon: number, lat: number) => {
      setNextMapClick(lon, lat);
      await user.click(screen.getByRole("button", { name: `Drag ${handle}` }));
    };

    it("say only what each link is: no Pick on map, no ⌖, no sentence about cars", async () => {
      openPage("/shops/shop-ex-1");
      const form = await screen.findByRole("region", { name: "Edit shop" });
      await within(links()).findByText("North Little Rock · FRA 600002");
      expect(within(form).queryByRole("button", { name: /Pick on map|Click the map/ })).not.toBeInTheDocument();
      expect(form.querySelector(".pick-btn")).toBeNull();
      expect(form).not.toHaveTextContent(/cars|No links/);
    });

    it("an unlinked shop offers the suggestion faint; Save keeps the shop as it was, Use then Save wires it", async () => {
      const user = userEvent.setup();
      openPage("/shops/shop-ex-1");
      const form = await screen.findByRole("region", { name: "Edit shop" });
      expect(await within(links()).findByText("North Little Rock · FRA 600002")).toBeInTheDocument();
      expect(within(links()).getByText("Suggested")).toBeInTheDocument();
      // The edited shop is its pin, a handle: the map's squares are the other five.
      expect(screen.getByText("Map: 5 shops, link 1 offered")).toBeInTheDocument();
      expect(screen.getByText("Handles: North Little Rock, AR, Suggested link 1")).toBeInTheDocument();
      await user.click(within(form).getByRole("button", { name: "Save shop" }));
      await waitFor(() => expect(lastSent()).toMatchObject({ links: [] }));

      await user.click(await screen.findByRole("button", { name: "Edit North Little Rock, AR" }));
      await user.click(await within(links()).findByRole("button", { name: "Use" }));
      expect(within(links()).queryByText("Suggested")).not.toBeInTheDocument();
      expect(await within(links()).findByText("North Little Rock · FRA 600002")).toBeInTheDocument();
      expect(rows()).toBe(1);
      await user.click(within(screen.getByRole("region", { name: "Edit shop" })).getByRole("button", { name: "Save shop" }));
      await waitFor(() => expect(lastSent()).toMatchObject({ links: [600002] }));
      expect(fake.state.shops[0].links).toEqual([600002]);
    });

    it("a shop dragged on the map takes the suggestion there as link 1 while it has none, and keeps a link a person set", async () => {
      const user = userEvent.setup();
      openPage("/shops/shop-ex-1");
      const form = await screen.findByRole("region", { name: "Edit shop" });
      await within(links()).findByText("Suggested");
      await dragOnMap(user, "North Little Rock, AR", -97.362, 31.121);
      expect(await within(form).findByDisplayValue("-97.362, 31.121")).toBeInTheDocument();
      expect(await within(links()).findByText("TEMPLE, TX wye · FRA 358070")).toBeInTheDocument();
      expect(within(links()).queryByText("Suggested")).not.toBeInTheDocument();

      await user.click(within(links()).getByRole("button", { name: "Move link 1" }));
      await tapMap(user, -97.346, 31.095);
      expect(await within(links()).findByText("Temple · FRA 357961")).toBeInTheDocument();
      await dragOnMap(user, "North Little Rock, AR", -97.35, 31.1);
      expect(await within(form).findByDisplayValue("-97.35, 31.1")).toBeInTheDocument();
      expect(within(links()).getByText("Temple · FRA 357961")).toBeInTheDocument();
      expect(rows()).toBe(1);
    });

    it("a pressed ring sets its link where the map is tapped next; a tap far from track is refused and changes nothing; Esc lets go", async () => {
      const user = userEvent.setup();
      openPage("/shops/shop-ex-1");
      await user.click(await within(await screen.findByRole("group", { name: "Track links" })).findByRole("button", { name: "Use" }));
      const ring = await within(links()).findByRole("button", { name: "Move link 1" });
      expect(screen.queryByRole("button", { name: "Click the map" })).not.toBeInTheDocument();

      await user.click(ring);
      expect(ring).toHaveAttribute("aria-pressed", "true");
      expect(within(links()).getByText("Click the map to set link 1")).toBeInTheDocument();
      await tapMap(user, -140, 10);
      expect(await within(links()).findByText("No track near there")).toBeInTheDocument();
      expect(within(links()).getByText("North Little Rock · FRA 600002")).toBeInTheDocument();
      expect(ring).toHaveAttribute("aria-pressed", "true");

      await tapMap(user, -92.3, 34.8);
      // The fake's way in is the nearest node: here the same one, so nothing changes and the ring lets go.
      await waitFor(() => expect(ring).toHaveAttribute("aria-pressed", "false"));
      expect(within(links()).queryByText("No track near there")).not.toBeInTheDocument();

      await user.click(ring);
      expect(screen.getByRole("button", { name: "Click the map" })).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(ring).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByRole("button", { name: "Click the map" })).not.toBeInTheDocument();
    });

    it("the ＋ adds link 2 where it is dropped, not at link 1's node; × and Delete remove links; Undo and Redo walk the changes; Save sends them in order", async () => {
      const user = userEvent.setup();
      const shop = fake.state.shops[0];
      fake.state.shops[0] = { ...shop, location: { lon: -97.35, lat: 31.1 }, place: { ok: true, place: { ...resolvedOf(shop.place)!, lon: -97.35, lat: 31.1 } } };
      openPage("/shops/shop-ex-1");
      await user.click(await within(await screen.findByRole("group", { name: "Track links" })).findByRole("button", { name: "Use" }));
      expect(await within(links()).findByText("Temple · FRA 357961")).toBeInTheDocument();

      // Dropped where link 1 joins: refused.
      await dragOnMap(user, "Add link", -97.346, 31.095);
      expect(await within(links()).findByText("Link 1 joins there")).toBeInTheDocument();
      expect(rows()).toBe(1);
      await dragOnMap(user, "Add link", -97.362, 31.121);
      expect(await within(links()).findByText("TEMPLE, TX wye · FRA 358070")).toBeInTheDocument();
      expect(rows()).toBe(2);
      expect(within(links()).queryByRole("button", { name: "Add link" })).not.toBeInTheDocument();
      expect(screen.getByText("Map: 5 shops, link 1, link 2")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Undo link change" }));
      await waitFor(() => expect(rows()).toBe(1));
      await user.click(screen.getByRole("button", { name: "Redo link change" }));
      expect(await within(links()).findByText("TEMPLE, TX wye · FRA 358070")).toBeInTheDocument();

      await user.click(within(links()).getByRole("button", { name: "Remove link 1" }));
      expect(rows()).toBe(1);
      expect(await within(links()).findByText("TEMPLE, TX wye · FRA 358070")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Undo link change" }));
      await waitFor(() => expect(rows()).toBe(2));
      within(links()).getByRole("button", { name: "Move link 2" }).focus();
      await user.keyboard("{Delete}");
      expect(rows()).toBe(1);
      await user.click(screen.getByRole("button", { name: "Undo link change" }));
      await waitFor(() => expect(rows()).toBe(2));

      await user.click(within(screen.getByRole("region", { name: "Edit shop" })).getByRole("button", { name: "Save shop" }));
      await waitFor(() => expect(lastSent()).toMatchObject({ links: [357961, 358070] }));
    });

    it("a shop at a network node gets no suggestion", async () => {
      const shop = fake.state.shops[0];
      const fraId = 358070 as FraId;
      fake.state.shops[0] = { ...shop, location: { fraId, railroad: null }, place: { ok: true, place: { ...resolvedOf(shop.place)!, fraId } } };
      openPage("/shops/shop-ex-1");
      await screen.findByRole("region", { name: "Edit shop" });
      expect(await within(links()).findByRole("button", { name: "Add link" })).toBeInTheDocument();
      expect(within(links()).queryByText("Suggested")).not.toBeInTheDocument();
      expect(fake.calls.some((call) => call.path.startsWith("/api/places/links"))).toBe(false);
    });

    it("a click on a shop square opens that shop", async () => {
      const user = userEvent.setup();
      openPage("/shops/shop-ex-1");
      await screen.findByRole("region", { name: "Edit shop" });
      await user.click(screen.getByRole("button", { name: "Shop square Kansas City, MO" }));
      expect(currentPath()).toBe("/shops/shop-ex-2");
    });

    it("pressing a ring scrolls the page to the top, as on a phone the panel may have slid up over the map", async () => {
      const user = userEvent.setup();
      const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      const original = window.matchMedia;
      pretendPhone(true);
      try {
        openPage("/shops/shop-ex-1");
        await user.click(await within(await screen.findByRole("group", { name: "Track links" })).findByRole("button", { name: "Use" }));
        scrollTo.mockClear();
        await user.click(await within(links()).findByRole("button", { name: "Add link" }));
        expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
      } finally {
        scrollTo.mockRestore();
        window.matchMedia = original;
      }
    });
  });

  it("Edit on a phone scrolls the form's top into view, as 'nearest' left its heading cut off", async () => {
    const user = userEvent.setup();
    const original = window.matchMedia;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    pretendPhone(true);
    try {
      openPage("/shops");
      await user.click(await screen.findByRole("button", { name: "Edit Kansas City, MO" }));
      const form = screen.getByRole("region", { name: "Edit shop" });
      const call = scrollIntoView.mock.contexts.indexOf(form);
      expect(call).toBeGreaterThan(-1);
      expect(scrollIntoView.mock.calls[call][0]).toEqual({ block: "start" });
    } finally {
      window.matchMedia = original;
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("a link to a shop that is not in the list opens the list at /shops", async () => {
    openPage("/shops/does-not-exist");
    expect(await screen.findByText("EX-NLR-01")).toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toBe("/shops"));
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

  it("a second file that fails replaces the first file's preview, so Save cannot write the old file", async () => {
    const user = userEvent.setup();
    openPage("/shops");
    const card = await screen.findByRole("region", { name: "Import shop list" });
    const csv = "name,lon,lat\nShop at Omaha,-95.94,41.26\n";
    await user.upload(within(card).getByLabelText("Choose CSV file"), new File([csv], "good.csv", { type: "text/csv" }));
    expect(await within(card).findByRole("region", { name: "Import preview" })).toHaveTextContent("good.csv · 1 ready");

    await user.upload(within(card).getByLabelText("Choose CSV file"), new File([""], "empty.csv", { type: "text/csv" }));
    expect(await within(card).findByRole("alert")).toBeInTheDocument();
    expect(within(card).queryByRole("region", { name: "Import preview" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
    expect(fake.state.shops).toHaveLength(6);
  });
});
