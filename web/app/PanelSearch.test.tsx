// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlaceSuggestion } from "../../shared/places.ts";
import { clearQueryCache } from "../data/query.ts";
import { installFakeServer, type FakeServer } from "../testing/fakeServer.ts";
import { moveActive } from "../ui/combobox.tsx";
import { PanelSearch } from "./PanelSearch.tsx";

describe("moveActive", () => {
  it("goes round the list; from no row, ↓ takes the first and ↑ the last", () => {
    expect(moveActive(-1, "ArrowDown", 3)).toBe(0);
    expect(moveActive(-1, "ArrowUp", 3)).toBe(2);
    expect(moveActive(0, "ArrowDown", 3)).toBe(1);
    expect(moveActive(2, "ArrowDown", 3)).toBe(0);
    expect(moveActive(0, "ArrowUp", 3)).toBe(2);
    expect(moveActive(1, "ArrowDown", 0)).toBe(-1);
  });
});

describe("the panel's search", () => {
  let fake: FakeServer;
  beforeEach(() => {
    fake = installFakeServer();
  });
  afterEach(() => {
    fake.restore();
    clearQueryCache();
  });

  const chosen: (PlaceSuggestion | null)[] = [];
  function Search() {
    const [value, setValue] = useState<PlaceSuggestion | null>(null);
    const [text, setText] = useState<string | null>(null);
    return (
      <PanelSearch
        chosen={value}
        problem={null}
        text={text}
        onText={setText}
        onChoose={(suggestion) => {
          chosen.push(suggestion);
          setValue(suggestion);
        }}
      />
    );
  }

  it("lists each place with what it is and its railroads; ↓ ↑ Enter choose, Esc closes and then clears", async () => {
    chosen.length = 0;
    const user = userEvent.setup();
    render(<Search />);
    const box = screen.getByRole("combobox", { name: "Search shops and cities" });
    // Plain words only: no FRA node id jargon, and short enough for a 360 px phone.
    expect(box).toHaveAttribute("placeholder", "Search shops and cities");

    await user.type(box, "temple");
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Temple, TX");
    expect(within(options[0]).getByText("City")).toBeInTheDocument();
    expect(within(options[0]).getByText("BNSF")).toBeInTheDocument();
    expect(within(options[0]).getByText("UP")).toBeInTheDocument();

    // Enter with nothing highlighted takes the first suggestion.
    await user.keyboard("{Enter}");
    expect(chosen.at(-1)?.label).toBe("Temple, TX");
    expect(box).toHaveValue("Temple, TX");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "little rock");
    const rows = await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // The first Esc only closed the list: what was chosen is still shown, and a second Esc clears it.
    expect(box).toHaveValue("Temple, TX");
    await user.keyboard("{Escape}");
    expect(chosen.at(-1)).toBeNull();
    expect(box).toHaveValue("");

    await user.type(box, "atlantis");
    expect(await screen.findByText("No shop, code or city called “atlantis”.")).toBeInTheDocument();
  });

  it("groups what it finds: Your shops, then cities", async () => {
    const user = userEvent.setup();
    render(<Search />);
    await user.type(screen.getByRole("combobox", { name: "Search shops and cities" }), "kansas");
    const groups = await screen.findAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Shops", "Cities"]);
    expect(within(groups[0]).getAllByRole("option")[0]).toHaveTextContent("Kansas City, MO");
    expect(within(groups[1]).getAllByRole("option")[0]).toHaveTextContent(/Kansas City.*City/);
  });

  it('"/" outside a text field puts the cursor in the search', async () => {
    const user = userEvent.setup();
    render(<Search />);
    await user.keyboard("/");
    expect(screen.getByRole("combobox", { name: "Search shops and cities" })).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Search shops and cities" })).toHaveValue("");
  });
});
