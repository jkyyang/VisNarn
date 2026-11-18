// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapStage, MapStageProvider } from "./MapStage.tsx";

vi.mock("./MapCanvas.tsx", () => import("../testing/FakeMapCanvas.tsx"));

// The map is judged at the middle of the network (Kansas) until it reports its own centre.
const KANSAS_NOON = new Date("2026-11-17T18:15:00Z");
const KANSAS_2AM = new Date("2026-11-18T08:00:00Z");

beforeEach(() => {
  (window as unknown as Record<string, unknown>).WebGLRenderingContext ??= function WebGLRenderingContext() {};
});
afterEach(() => {
  vi.useRealTimers();
});

async function openMap(now: Date) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(now);
  render(
    <MapStageProvider network={null}>
      <MapStage />
    </MapStageProvider>,
  );
  const layersButton = await screen.findByRole("button", { name: /^Map layers/ });
  return { map: screen.getByRole("region", { name: "Map" }), layersButton };
}

describe("day and night on the map", () => {
  it("Auto follows the clock: a day map at noon, a night map at 2 a.m.", async () => {
    const noon = await openMap(KANSAS_NOON);
    expect(noon.map).toHaveAttribute("data-look", "day");
    expect(noon.layersButton).toHaveAccessibleName("Map layers: Map · Day");
  });

  it("at 2 a.m. Auto shows the night map", async () => {
    const night = await openMap(KANSAS_2AM);
    expect(night.map).toHaveAttribute("data-look", "night");
    expect(night.layersButton).toHaveAccessibleName("Map layers: Map · Night");
  });

  it("Auto changes the map by itself as the evening goes on: day, then sunset, then night", async () => {
    const { map, layersButton } = await openMap(new Date("2026-11-17T21:30:00Z"));
    expect(map).toHaveAttribute("data-look", "day");
    act(() => void vi.advanceTimersByTime(80 * 60_000));
    expect(layersButton).toHaveAccessibleName("Map layers: Map · Sunset");
    act(() => void vi.advanceTimersByTime(90 * 60_000));
    expect(map).toHaveAttribute("data-look", "night");
    expect(layersButton).toHaveAccessibleName("Map layers: Map · Night");
  });

  it("the Time of day switch in the layers card: Night at noon, Day at 2 a.m., and back to Auto", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { map, layersButton } = await openMap(KANSAS_NOON);
    await user.click(layersButton);
    expect(screen.getByRole("radiogroup", { name: "Time of day" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "Night" }));
    expect(map).toHaveAttribute("data-look", "night");
    expect(layersButton).toHaveAccessibleName("Map layers: Map · Night");
    expect(screen.getByRole("radio", { name: "Night" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "Auto" }));
    expect(map).toHaveAttribute("data-look", "day");

    act(() => {
      vi.setSystemTime(KANSAS_2AM);
      vi.advanceTimersByTime(60_000);
    });
    expect(map).toHaveAttribute("data-look", "night");
    await user.click(screen.getByRole("radio", { name: "Day" }));
    expect(map).toHaveAttribute("data-look", "day");
    expect(layersButton).toHaveAccessibleName("Map layers: Map · Day");
  });
});
