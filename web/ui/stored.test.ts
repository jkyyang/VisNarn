// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storedChoice } from "./stored.ts";

const KEY = "visnarn.test-unit";
const useUnit = storedChoice(KEY, ["km", "mi"], () => "km");

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("storedChoice", () => {
  it("starts on the fallback, and reads back what this browser saved; anything else is the fallback", () => {
    expect(renderHook(() => useUnit()).result.current[0]).toBe("km");
    localStorage.setItem(KEY, "mi");
    expect(renderHook(() => useUnit()).result.current[0]).toBe("mi");
    localStorage.setItem(KEY, "furlongs");
    expect(renderHook(() => useUnit()).result.current[0]).toBe("km");
  });

  it("a choice is saved and every part of the page that shows it follows", () => {
    const panel = renderHook(() => useUnit());
    const map = renderHook(() => useUnit());
    act(() => panel.result.current[1]("mi"));
    expect(localStorage.getItem(KEY)).toBe("mi");
    expect(panel.result.current[0]).toBe("mi");
    expect(map.result.current[0]).toBe("mi");
  });

  it("with storage blocked, the page still shows the fallback and the switch still works until it closes", () => {
    const storage = Object.getPrototypeOf(localStorage) as Storage;
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { result } = renderHook(() => useUnit());
    expect(result.current[0]).toBe("km");
    act(() => result.current[1]("mi"));
    expect(result.current[0]).toBe("mi");
    act(() => result.current[1]("km"));
    expect(result.current[0]).toBe("km");
  });
});
