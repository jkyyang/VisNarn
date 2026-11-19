// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setCarrierFilter, shownCarrier, useCarrierFilter } from "./carrierFilter.ts";

describe("the carrier filter", () => {
  afterEach(() => setCarrierFilter({}));

  it("shows nothing by default; a hover previews its carrier over the one isolated", () => {
    expect(shownCarrier({})).toBeNull();
    expect(shownCarrier({ isolated: "CPKC" })).toBe("CPKC");
    expect(shownCarrier({ isolated: "CPKC", hovered: "BNSF" })).toBe("BNSF");
  });

  it("tells every reader when the Layers popover sets it", () => {
    const { result } = renderHook(() => useCarrierFilter());
    expect(result.current).toEqual({});
    act(() => setCarrierFilter({ isolated: "CN" }));
    expect(result.current).toEqual({ isolated: "CN" });
  });
});
