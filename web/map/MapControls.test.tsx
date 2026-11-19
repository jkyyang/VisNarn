// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MapControls } from "./MapControls.tsx";

const controls = (history: Parameters<typeof MapControls>[0]["history"]) =>
  render(
    <MapControls
      layers={{ basemap: "map", network: true, tracks: false, light: "auto" }}
      onLayers={() => {}}
      look={{ base: "day", phase: "day" }}
      onZoom={() => {}}
      onFit={() => {}}
      history={history}
    />,
  );

describe("map controls: undo and redo", () => {
  it("name what they undo: a link change on Shops, a route change on the planner", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    controls({ what: "link change", undo, redo: null });
    await user.click(screen.getByRole("button", { name: "Undo link change" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Redo link change" })).toBeDisabled();
    controls({ what: "route change", undo: null, redo: null });
    expect(screen.getByRole("button", { name: "Undo route change" })).toBeDisabled();
  });

  it("are left out with no history", () => {
    controls(null);
    expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
  });
});
