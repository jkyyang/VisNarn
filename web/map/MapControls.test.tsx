// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { MapLayerChoice } from "./MapCanvas.tsx";
import { MapControls } from "./MapControls.tsx";

/** The controls over a map that keeps their choices, with the carrier the map would preview. */
function Controls(props: { onReset?: () => void; onZoom?: (step: 1 | -1) => void }) {
  const [layers, setLayers] = useState<MapLayerChoice>({ basemap: "map", network: true, tracks: false, light: "auto", carrier: null });
  const [preview, setPreview] = useState<Railroad | null>(null);
  return (
    <div data-testid="map" data-carrier={preview ?? layers.carrier ?? undefined} data-tracks={layers.tracks ? "on" : "off"}>
      <MapControls layers={layers} onLayers={setLayers} look={{ base: "day", phase: "day" }} onPreview={setPreview} onZoom={props.onZoom ?? (() => {})} onReset={props.onReset ?? (() => {})} />
    </div>
  );
}

const layersButton = () => screen.getByRole("button", { name: /^Map layers/ });
const card = () => screen.getByRole("dialog", { name: "Layers" });
const carriers = () => within(card()).getByRole("group", { name: "Carriers" });
const row = (railroad: Railroad) => within(carriers()).getByRole("button", { name: new RegExp(`^${railroad}`) });

describe("map controls", () => {
  it("are, top to bottom: Layers, zoom in and out, Reset view; undo and redo live in the panel", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const zoom = vi.fn();
    render(<Controls onReset={reset} onZoom={zoom} />);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Map layers: Map · Day",
      "Zoom in",
      "Zoom out",
      "Reset view to the whole network",
    ]);
    await user.click(screen.getByRole("button", { name: "Reset view to the whole network" }));
    expect(reset).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoom).toHaveBeenCalledWith(-1);
  });

  it("Layers opens one card: Carriers, Basemap, Time of day, Units, Overlays; Escape or a press outside closes it", async () => {
    const user = userEvent.setup();
    render(<Controls />);
    await user.click(layersButton());
    expect(layersButton()).toHaveAttribute("aria-expanded", "true");
    const sections = [
      within(card()).getByRole("group", { name: "Carriers" }),
      within(card()).getByRole("radiogroup", { name: "Basemap" }),
      within(card()).getByRole("radiogroup", { name: "Time of day" }),
      within(card()).getByRole("radiogroup", { name: "Units" }),
      within(card()).getByRole("group", { name: "Overlays" }),
    ];
    for (const [above, below] of sections.slice(0, -1).map((section, i) => [section, sections[i + 1]])) {
      expect(above.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Layers" })).not.toBeInTheDocument();

    await user.click(layersButton());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Layers" })).not.toBeInTheDocument();

    // A press inside the card keeps it open; the button closes it again.
    await user.click(layersButton());
    await user.click(within(card()).getByRole("radio", { name: "Satellite" }));
    expect(card()).toBeInTheDocument();
    await user.click(layersButton());
    expect(screen.queryByRole("dialog", { name: "Layers" })).not.toBeInTheDocument();
  });

  it("only one popover is open on the page: opening one closes the other", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Controls />
        <Controls />
      </>,
    );
    const [first, second] = screen.getAllByRole("button", { name: /^Map layers/ });
    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    await user.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("dialog", { name: "Layers" })).toHaveLength(1);
  });

  it("a carrier row shows that carrier alone and says Only; the Layers button carries a dot; again, or Show all, shows them all", async () => {
    const user = userEvent.setup();
    render(<Controls />);
    await user.click(layersButton());
    expect(within(carriers()).getAllByRole("button", { pressed: false }).map((button) => button.textContent)).toEqual([...RAILROADS]);
    expect(within(carriers()).queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();

    await user.click(row("CPKC"));
    expect(row("CPKC")).toHaveAttribute("aria-pressed", "true");
    expect(row("CPKC")).toHaveTextContent("CPKCOnly");
    expect(screen.getByTestId("map")).toHaveAttribute("data-carrier", "CPKC");
    expect(layersButton()).toHaveAttribute("data-filtered");
    expect(layersButton()).toHaveAccessibleName("Map layers: Map · Day · CPKC only");

    await user.click(row("CPKC"));
    expect(row("CPKC")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("map")).not.toHaveAttribute("data-carrier");
    expect(layersButton()).not.toHaveAttribute("data-filtered");

    await user.click(row("UP"));
    await user.click(within(carriers()).getByRole("button", { name: "Show all" }));
    expect(within(carriers()).queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getByTestId("map")).not.toHaveAttribute("data-carrier");
  });

  it("a pointer resting on a carrier previews it; leaving, or closing the card, ends the preview", async () => {
    const user = userEvent.setup();
    render(<Controls />);
    await user.click(layersButton());
    await user.hover(row("BNSF"));
    expect(screen.getByTestId("map")).toHaveAttribute("data-carrier", "BNSF");
    await user.unhover(row("BNSF"));
    expect(screen.getByTestId("map")).not.toHaveAttribute("data-carrier");

    await user.hover(row("NS"));
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("map")).not.toHaveAttribute("data-carrier");
  });

  it("Overlays are switches", async () => {
    const user = userEvent.setup();
    render(<Controls />);
    await user.click(layersButton());
    expect(within(card()).getByRole("switch", { name: "Rail network" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(card()).getByRole("switch", { name: "Real tracks" }));
    expect(within(card()).getByRole("switch", { name: "Real tracks" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("map")).toHaveAttribute("data-tracks", "on");
  });
});
