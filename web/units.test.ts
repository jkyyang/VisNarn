// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDistanceUnit } from "./units.ts";

const KEY = "visnarn.distance-unit";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useDistanceUnit", () => {
  it("starts in km, and reads back what this browser saved; anything else is km", () => {
    expect(renderHook(() => useDistanceUnit()).result.current[0]).toBe("km");
    localStorage.setItem(KEY, "mi");
    expect(renderHook(() => useDistanceUnit()).result.current[0]).toBe("mi");
    localStorage.setItem(KEY, "furlongs");
    expect(renderHook(() => useDistanceUnit()).result.current[0]).toBe("km");
  });

  it("a choice is saved and every part of the page that shows distances follows it", () => {
    const panel = renderHook(() => useDistanceUnit());
    const map = renderHook(() => useDistanceUnit());
    act(() => panel.result.current[1]("mi"));
    expect(localStorage.getItem(KEY)).toBe("mi");
    expect(panel.result.current[0]).toBe("mi");
    expect(map.result.current[0]).toBe("mi");
  });

  it("with storage blocked, the page still shows km and the switch still works until it closes", () => {
    const storage = Object.getPrototypeOf(localStorage) as Storage;
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { result } = renderHook(() => useDistanceUnit());
    expect(result.current[0]).toBe("km");
    act(() => result.current[1]("mi"));
    expect(result.current[0]).toBe("mi");
    act(() => result.current[1]("km"));
    expect(result.current[0]).toBe("km");
  });
});
