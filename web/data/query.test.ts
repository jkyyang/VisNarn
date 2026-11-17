/** The cache as plain functions over a fake transport (no DOM needed: useSyncExternalStore's store is testable on its own). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../../shared/api.ts";
import { AppError } from "../../shared/app.ts";
import type { SavedRouteDraft } from "../../shared/plans.ts";
import { callApi, createQueryCache, type QueryState, type Transport } from "./query.ts";

interface Call {
  route: Route;
  request: unknown;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function fakeTransport() {
  const calls: Call[] = [];
  const transport: Transport = (route, request, signal) =>
    new Promise((resolve, reject) => {
      calls.push({ route, request, signal, resolve, reject });
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  return { calls, transport };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("query cache", () => {
  beforeEach(() => vi.useRealTimers());

  it("two subscribers to the same read share one request", async () => {
    const { calls, transport } = fakeTransport();
    const cache = createQueryCache(transport);
    const stopA = cache.subscribe("GET /api/shops", undefined, () => {});
    const stopB = cache.subscribe("GET /api/shops", undefined, () => {});
    expect(calls).toHaveLength(1);
    calls[0].resolve([{ id: "s1" }]);
    await flush();
    expect(cache.state(cache.keyOf("GET /api/shops", undefined))).toEqual({ status: "ready", data: [{ id: "s1" }], stale: false });
    stopA();
    stopB();
  });

  it("a request with the same meaning but keys in another order is the same read", () => {
    const cache = createQueryCache(fakeTransport().transport);
    expect(cache.keyOf("POST /api/route", { body: { a: 1, b: 2 } })).toBe(cache.keyOf("POST /api/route", { body: { b: 2, a: 1 } }));
  });

  it("a changed request aborts the superseded call when nobody else wants it", async () => {
    const { calls, transport } = fakeTransport();
    const cache = createQueryCache(transport);
    const stop = cache.subscribe("POST /api/route", { body: { car: 1 } }, () => {});
    stop();
    const stop2 = cache.subscribe("POST /api/route", { body: { car: 2 } }, () => {});
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    stop2();
  });

  it("a write marks every read stale and refetches the mounted ones; a failed write changes nothing", async () => {
    const { calls, transport } = fakeTransport();
    const cache = createQueryCache(transport);
    const states: QueryState<unknown>[] = [];
    const key = cache.keyOf("GET /api/shops", undefined);
    const stop = cache.subscribe("GET /api/shops", undefined, () => states.push(cache.state(key)));
    calls[0].resolve(["before"]);
    await flush();

    const failed = cache.write("DELETE /api/shops/:shopId", { params: { shopId: "x" } });
    calls[1].reject(new AppError("not-found", "gone"));
    await expect(failed).rejects.toThrow("gone");
    expect(calls).toHaveLength(2);
    expect(cache.state(key)).toEqual({ status: "ready", data: ["before"], stale: false });

    const done = cache.write("POST /api/shops", { body: { name: "n" } });
    calls[2].resolve({ id: "new" });
    await done;
    expect(calls[3].route).toBe("GET /api/shops");
    expect(cache.state(key)).toEqual({ status: "ready", data: ["before"], stale: true });
    calls[3].resolve(["before", "after"]);
    await flush();
    expect(cache.state(key)).toEqual({ status: "ready", data: ["before", "after"], stale: false });
    stop();
  });

  it("polls while pollMs returns a number and stops when it returns null or the last subscriber leaves", async () => {
    vi.useFakeTimers();
    const { calls, transport } = fakeTransport();
    const cache = createQueryCache(transport);
    const pollMs = (view: unknown) => ((view as { done: boolean }).done ? null : 400);
    const stop = cache.subscribe("POST /api/route", { body: { plan: "b" } }, () => {}, { pollMs });
    calls[0].resolve({ done: false });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toHaveLength(2);
    calls[1].resolve({ done: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(2);

    const stopAgain = cache.subscribe("POST /api/route", { body: { plan: "c" } }, () => {}, { pollMs });
    calls[2].resolve({ done: false });
    await vi.advanceTimersByTimeAsync(0);
    stopAgain();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(3);
    stop();
    vi.useRealTimers();
  });

  it("an error keeps a retry that asks again", async () => {
    const { calls, transport } = fakeTransport();
    const cache = createQueryCache(transport);
    const key = cache.keyOf("GET /api/meta", undefined);
    const stop = cache.subscribe("GET /api/meta", undefined, () => {});
    calls[0].reject(new AppError("internal", "down"));
    await flush();
    const state = cache.state(key);
    expect(state.status).toBe("error");
    if (state.status === "error") state.retry();
    expect(calls).toHaveLength(2);
    stop();
  });
});

describe("callApi", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("a non-2xx answer becomes the AppError the server raised; no answer becomes 'internal'", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { kind: "conflict", message: "Another shop already has the code X.", field: "code" } }), { status: 409 })) as typeof fetch;
    const error = await callApi("", "POST /api/shops", { body: { name: "n", code: "X", location: { kind: "text", text: "t" } } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ kind: "conflict", field: "code", message: "Another shop already has the code X." });

    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(callApi("", "GET /api/meta", {})).rejects.toMatchObject({ kind: "internal" });
  });

  it("sends the route's method, path, query and JSON body", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response("null", { status: 200 });
    }) as typeof fetch;
    await callApi("http://127.0.0.1:1", "GET /api/places/suggest", { query: { q: "Tem ple", role: "shop" } });
    const draft: SavedRouteDraft = { name: "EXAMPLE", plan: { start: { kind: "text", text: "a" }, stops: [], destination: { kind: "text", text: "b" } }, option: null };
    await callApi("", "PUT /api/saved-routes/:routeId", { params: { routeId: "r/1" }, body: draft });
    expect(seen[0].url).toBe("http://127.0.0.1:1/api/places/suggest?q=Tem+ple&role=shop");
    expect(seen[1].url).toBe("/api/saved-routes/r%2F1");
    expect(seen[1].init).toMatchObject({ method: "PUT", body: JSON.stringify(draft) });
  });
});
