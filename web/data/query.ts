/**
 * How the page talks to the server. INTERNAL to web/data: components use the named hooks and
 * actions in ./hooks.ts and never see a route, a URL or `fetch`.
 *
 * The model is deliberately small. The server owns the truth; the page keeps a throwaway copy of
 * the answers it is showing.
 * - A read is cached by route + request. Components showing the same thing share one request.
 * - There are no optimistic updates. A write is awaited, and when it succeeds every cached answer is
 *   marked stale and the ones on screen are fetched again. On loopback that costs milliseconds and
 *   it means there is no list of "which write affects which read" to keep right.
 * - A read whose request changes keeps showing the previous answer, marked `stale`, until the new
 *   one arrives, and the superseded request is aborted (the server then drops the routing work).
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { urlFor, type ApiErrorBody, type Request, type RequestArgs, type Res, type Route } from "../../shared/api.ts";
import { AppError, type AppErrorKind } from "../../shared/app.ts";

/** Routes that change nothing on the server. Two of them are POSTs because their input is a document. */
export type ReadRoute = Extract<Route, `GET ${string}` | "POST /api/route" | "POST /api/places/resolve">;
export type WriteRoute = Exclude<Route, ReadRoute>;

export type QueryState<T> =
  /** Nothing asked: the request is null. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: AppError; retry: () => void }
  /** `stale`: a newer answer is on its way and `data` is the one before it. */
  | { status: "ready"; data: T; stale: boolean };

export interface QueryOptions<T> {
  /** Read again after this many ms while it returns a number (an answer the server is still working on). */
  pollMs?: (data: T) => number | null;
}

/** One call to the server. The real one is `callApi`; tests give the cache a fake. */
export type Transport = (route: Route, request: unknown, signal: AbortSignal) => Promise<unknown>;

const KINDS: readonly AppErrorKind[] = ["invalid", "not-found", "conflict", "internal"];

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("internal", "Something went wrong while talking to the server. Try again.");
}

/**
 * One HTTP call, typed by the contract: the transport under everything in this file. `origin` is ""
 * in the browser (the page and the API share an origin); tests pass the test server's address.
 * A non-2xx answer is thrown as the AppError the server raised; no answer at all as "internal".
 */
export async function callApi<R extends Route>(origin: string, route: R, request: Request<R>, signal?: AbortSignal): Promise<Res<R>> {
  const { method, url } = urlFor(route, ...([request] as RequestArgs<R>));
  const body = (request as { body?: unknown } | undefined)?.body;
  let response: Response;
  try {
    response = await fetch(origin + url, {
      method,
      signal,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) throw error;
    throw new AppError("internal", "The server on this laptop did not answer. Is it running? Start it with npm run dev.");
  }
  const text = await response.text();
  const json = text ? safeJson(text) : null;
  if (!response.ok) {
    const failure = (json as ApiErrorBody | null)?.error;
    if (failure && KINDS.includes(failure.kind) && typeof failure.message === "string") {
      throw new AppError(failure.kind, failure.message, failure.field ?? null);
    }
    throw new AppError("internal", `The server answered with an error (HTTP ${response.status}).`);
  }
  return json as Res<R>;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** JSON with object keys sorted, so two requests that mean the same have one key. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

interface Entry {
  route: Route;
  request: unknown;
  state: QueryState<unknown>;
  listeners: Set<() => void>;
  controller: AbortController | null;
  /** Set by a write: the answer may be out of date and is fetched again on next use. */
  invalid: boolean;
  pollMs: ((data: unknown) => number | null) | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  dropTimer: ReturnType<typeof setTimeout> | null;
}

export interface QueryCache {
  /** The key a read is cached under. */
  keyOf(route: Route, request: unknown): string;
  /** Starts watching one read: the first watcher fetches it, the last one leaving aborts it. */
  subscribe(route: Route, request: unknown, listener: () => void, options?: QueryOptions<unknown>): () => void;
  state(key: string): QueryState<unknown>;
  read(route: Route, request: unknown): Promise<unknown>;
  write(route: Route, request: unknown): Promise<unknown>;
  /** Forgets every answer (tests start each case from an empty cache). */
  clear(): void;
}

const IDLE: QueryState<never> = { status: "idle" };
const LOADING: QueryState<never> = { status: "loading" };
/** How long an answer nobody shows is kept, so going back to a screen shows it at once. */
const KEEP_MS = 60_000;

export function createQueryCache(transport: Transport): QueryCache {
  const entries = new Map<string, Entry>();

  const notify = (entry: Entry) => entry.listeners.forEach((listener) => listener());
  const setState = (entry: Entry, state: QueryState<unknown>) => {
    entry.state = state;
    notify(entry);
  };

  const clearPoll = (entry: Entry) => {
    if (entry.pollTimer) clearTimeout(entry.pollTimer);
    entry.pollTimer = null;
  };

  function load(entry: Entry): void {
    entry.controller?.abort();
    clearPoll(entry);
    const controller = new AbortController();
    entry.controller = controller;
    entry.invalid = false;
    if (entry.state.status === "ready") {
      if (!entry.state.stale) setState(entry, { ...entry.state, stale: true });
    } else if (entry.state.status !== "loading") setState(entry, LOADING);

    transport(entry.route, entry.request, controller.signal).then(
      (data) => {
        if (entry.controller !== controller) return;
        entry.controller = null;
        setState(entry, { status: "ready", data, stale: false });
        const wait = entry.pollMs?.(data) ?? null;
        if (wait !== null && entry.listeners.size > 0) entry.pollTimer = setTimeout(() => load(entry), wait);
      },
      (error: unknown) => {
        if (entry.controller !== controller) return;
        entry.controller = null;
        if (isAbort(error) || controller.signal.aborted) return;
        setState(entry, { status: "error", error: asAppError(error), retry: () => load(entry) });
      },
    );
  }

  const keyOf = (route: Route, request: unknown) => `${route} ${stableJson(request ?? null)}`;

  return {
    keyOf,
    subscribe(route, request, listener, options) {
      const key = keyOf(route, request);
      let entry = entries.get(key);
      if (!entry) {
        entry = { route, request, state: IDLE, listeners: new Set(), controller: null, invalid: true, pollMs: null, pollTimer: null, dropTimer: null };
        entries.set(key, entry);
      }
      const current = entry;
      if (current.dropTimer) clearTimeout(current.dropTimer);
      current.dropTimer = null;
      current.pollMs = options?.pollMs ?? current.pollMs;
      current.listeners.add(listener);
      if (current.invalid && !current.controller) load(current);
      else if (current.state.status === "ready" && !current.pollTimer && !current.controller) {
        const wait = current.pollMs?.(current.state.data) ?? null;
        if (wait !== null) current.pollTimer = setTimeout(() => load(current), wait);
      }
      return () => {
        current.listeners.delete(listener);
        if (current.listeners.size > 0) return;
        clearPoll(current);
        if (current.controller) {
          current.controller.abort();
          current.controller = null;
          current.invalid = true;
          if (current.state.status === "loading") current.state = IDLE;
          else if (current.state.status === "ready" && current.state.stale) current.state = { ...current.state, stale: false };
        }
        current.dropTimer = setTimeout(() => {
          if (current.listeners.size === 0 && entries.get(key) === current) entries.delete(key);
        }, KEEP_MS);
      };
    },
    state(key) {
      return entries.get(key)?.state ?? IDLE;
    },
    read(route, request) {
      return transport(route, request, new AbortController().signal);
    },
    async write(route, request) {
      const answer = await transport(route, request, new AbortController().signal);
      for (const entry of entries.values()) {
        entry.invalid = true;
        if (entry.listeners.size > 0) load(entry);
      }
      return answer;
    },
    clear() {
      for (const entry of entries.values()) {
        entry.controller?.abort();
        clearPoll(entry);
        if (entry.dropTimer) clearTimeout(entry.dropTimer);
      }
      entries.clear();
    },
  };
}

const cache = createQueryCache((route, request, signal) => callApi("", route, request as Request<Route>, signal));

/** For tests that render screens: every test starts from an empty cache. */
export const clearQueryCache = () => cache.clear();

/** Subscribes the component to one read. `request: null` asks nothing. */
export function useQuery<R extends ReadRoute>(route: R, request: Request<R> | null, options?: QueryOptions<Res<R>>): QueryState<Res<R>> {
  const key = request === null ? null : cache.keyOf(route, request);
  const requestRef = useRef(request);
  requestRef.current = request;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (key === null) return () => {};
      const pollMs = optionsRef.current?.pollMs;
      return cache.subscribe(route, requestRef.current, listener, pollMs ? { pollMs: (data) => pollMs(data as Res<R>) } : undefined);
    },
    [route, key],
  );
  const snapshot = useCallback(() => (key === null ? IDLE : cache.state(key)), [key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot) as QueryState<Res<R>>;

  // A changed request keeps showing the answer to the one before, marked stale, until its own arrives.
  const last = useRef<{ key: string; data: Res<R> } | null>(null);
  if (state.status === "ready" && key !== null) last.current = { key, data: state.data };
  if (key !== null && state.status === "loading" && last.current && last.current.key !== key) {
    return { status: "ready", data: last.current.data, stale: true };
  }
  return state;
}

/** One read outside rendering (a map click). Not cached. */
export function read<R extends ReadRoute>(route: R, ...request: RequestArgs<R>): Promise<Res<R>> {
  return cache.read(route, request[0]) as Promise<Res<R>>;
}

/** One change on the server. Resolves with the server's answer after the cache has been marked stale. */
export function write<R extends WriteRoute>(route: R, ...request: RequestArgs<R>): Promise<Res<R>> {
  return cache.write(route, request[0]) as Promise<Res<R>>;
}
