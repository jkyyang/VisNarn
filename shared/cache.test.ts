import { describe, expect, it } from "vitest";
import { createCache } from "./cache.ts";

describe("the bounded cache", () => {
  it("never holds more entries than its bound", () => {
    const cache = createCache<number, string>({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) cache.set(i, `v${i}`);
    expect(cache.size).toBe(3);
    expect([...cache.values()]).toEqual(["v7", "v8", "v9"]);
  });

  it("evicts the least recently used first: a read counts as a use", () => {
    const cache = createCache<string, number>({ maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    cache.set("d", 4);
    expect(cache.get("b")).toBeUndefined();
    expect([...cache.values()]).toEqual([3, 1, 4]);
  });

  it("never holds more than its size bound, and keeps the newest value even when it alone is over", () => {
    const cache = createCache<string, string>({ maxEntries: 100, maxSize: 10, sizeOf: (v) => v.length });
    cache.set("a", "1234");
    cache.set("b", "1234");
    cache.set("c", "1234");
    expect([...cache.values()]).toHaveLength(2);
    expect(cache.get("a")).toBeUndefined();
    cache.set("big", "12345678901");
    expect([...cache.values()]).toEqual(["12345678901"]);
    cache.set("small", "1");
    expect([...cache.values()]).toEqual(["1"]);
  });

  it("replacing a value counts its new size once", () => {
    const cache = createCache<string, string>({ maxEntries: 10, maxSize: 6, sizeOf: (v) => v.length });
    cache.set("a", "123");
    cache.set("a", "123");
    cache.set("b", "123");
    expect(cache.size).toBe(2);
  });

  it("deletes and clears", () => {
    const cache = createCache<string, string>({ maxEntries: 5, maxSize: 5, sizeOf: (v) => v.length });
    cache.set("a", "xx");
    cache.set("b", "yyy");
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    cache.set("c", "xx");
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    cache.set("d", "12345");
    expect(cache.get("d")).toBe("12345");
  });
});
