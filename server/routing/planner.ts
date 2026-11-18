/**
 * The route planner: "how can this trip run?" for the rest of the server.
 *
 * Behind `plan` are the worker threads that own the routers (a search blocks its thread for up to
 * ~0.3 s, so it never runs on the thread that answers HTTP), a queue, and the cache. Callers see none of it.
 *
 * The cache is keyed by tripKey (network version, waypoints with a shop's links, track included, turning at stops)
 * and strategy. A new network file, a moved shop or a shop wired anew asks under a new key. It lives in memory: after a restart
 * routes are computed again.
 */
import { Worker } from "node:worker_threads";
import { combine, tripKey, type RouteResult, type Routed, type Trip } from "../../engine/index.ts";
import { createCache } from "../../shared/cache.ts";
import { ROUTE_STRATEGIES, type RouteStrategy } from "../../shared/route.ts";
import type { Job, JobResult, WorkerData } from "./protocol.ts";

export interface RoutePlanner {
  /**
   * The distinct routes for a trip, the router's own first. Identical requests in flight share one computation. Aborting the signal
   * drops the request if it has not started; the promise then rejects with the signal's reason.
   */
  plan(trip: Trip, options?: { signal?: AbortSignal }): Promise<Routed>;
  close(): Promise<void>;
}

/** About 100 MB of answers: a regional route has ~400 points, a continental one ~1,500. */
const CACHE_POINTS = 2_000_000;
/** And at most this many, however small: every unroutable trip is one answer too. */
const CACHE_ANSWERS = 20_000;

const pointsOf = (result: RouteResult) => (result.ok ? 1 + result.path.legs.reduce((n, leg) => n + leg.path.length, 0) : 1);

/** One (trip, strategy) search: queued, then running on a worker, then cached. */
interface Search {
  id: number;
  key: string;
  trip: Trip;
  strategy: RouteStrategy;
  running: boolean;
  /** Plans still waiting for it. A queued search nobody waits for is dropped. */
  interest: number;
  promise: Promise<RouteResult>;
  resolve(result: RouteResult): void;
  reject(error: Error): void;
}

interface Thread {
  worker: Worker;
  search: Search | null;
  dead: boolean;
}

export function startRoutePlanner(options: { networkDir: string; networkVersion: string; workers: number }): RoutePlanner {
  const size = Math.max(1, Math.floor(options.workers));
  const threads: Thread[] = [];
  const queue: Search[] = [];
  const inFlight = new Map<string, Search>();
  const cache = createCache<string, RouteResult>({ maxEntries: CACHE_ANSWERS, maxSize: CACHE_POINTS, sizeOf: pointsOf });
  let nextId = 1;
  let closed = false;

  const searchKey = (trip: Trip, strategy: RouteStrategy) => `${tripKey(options.networkVersion, trip)}\u0000${strategy}`;

  const spawn = (): Thread => {
    const data: WorkerData = { networkDir: options.networkDir };
    const thread: Thread = { worker: new Worker(new URL("./worker.ts", import.meta.url), { workerData: data }), search: null, dead: false };
    thread.worker.on("message", (answer: JobResult) => {
      const search = thread.search;
      if (!search || search.id !== answer.id) return;
      finish(thread);
      if ("result" in answer) {
        cache.set(search.key, answer.result);
        search.resolve(answer.result);
      } else {
        // Waypoints only, no car: a search holds coordinates and ids, never a report.
        console.error(`Routing failed (${search.strategy}): ${answer.failed}`);
        search.reject(new Error(`Routing failed: ${answer.failed}`));
      }
      pump();
    });
    const die = (why: string) => {
      if (thread.dead) return;
      thread.dead = true;
      if (!closed) console.error(`A routing worker stopped (${why}); the next search starts another.`);
      threads.splice(threads.indexOf(thread), 1);
      const search = thread.search;
      if (search) {
        finish(thread);
        search.reject(new Error(`The routing worker stopped (${why}).`));
      }
      if (!closed) pump();
    };
    thread.worker.on("error", (error) => die(error.message));
    thread.worker.on("exit", (code) => die(`exit code ${code}`));
    threads.push(thread);
    return thread;
  };

  const finish = (thread: Thread) => {
    if (thread.search) inFlight.delete(thread.search.key);
    thread.search = null;
    // An idle worker must not keep the process alive.
    thread.worker.unref();
  };

  const pump = () => {
    while (!closed && queue.length) {
      const thread = threads.find((t) => !t.search) ?? (threads.length < size ? spawn() : null);
      if (!thread) return;
      const search = queue.shift()!;
      search.running = true;
      thread.search = search;
      thread.worker.ref();
      const job: Job = { id: search.id, trip: search.trip, strategy: search.strategy };
      thread.worker.postMessage(job);
    }
  };

  const enqueue = (key: string, trip: Trip, strategy: RouteStrategy): Search => {
    let resolve!: (result: RouteResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<RouteResult>((res, rej) => ((resolve = res), (reject = rej)));
    // Every waiter has its own handler; this one keeps a failure nobody waits for any more from being "unhandled".
    promise.catch(() => {});
    const search: Search = { id: nextId++, key, trip, strategy, running: false, interest: 0, promise, resolve, reject };
    inFlight.set(key, search);
    queue.push(search);
    return search;
  };

  const drop = (search: Search) => {
    const at = queue.indexOf(search);
    if (at >= 0) queue.splice(at, 1);
    inFlight.delete(search.key);
  };

  return {
    plan(trip, { signal } = {}) {
      if (closed) return Promise.reject(new Error("The route planner is closed."));
      if (signal?.aborted) return Promise.reject(signal.reason);
      const known = new Map<RouteStrategy, RouteResult>();
      const waiting: Search[] = [];
      for (const strategy of ROUTE_STRATEGIES) {
        const key = searchKey(trip, strategy);
        const hit = cache.get(key);
        if (hit) {
          known.set(strategy, hit);
          continue;
        }
        const search = inFlight.get(key) ?? enqueue(key, trip, strategy);
        search.interest++;
        waiting.push(search);
      }
      const answer = () => combine(ROUTE_STRATEGIES.map((s) => known.get(s)!));
      if (!waiting.length) return Promise.resolve(answer());
      pump();

      return new Promise<Routed>((resolve, reject) => {
        let settled = false;
        const release = () => {
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          for (const search of waiting) if (--search.interest === 0 && !search.running) drop(search);
        };
        const onAbort = () => {
          if (settled) return;
          release();
          reject(signal!.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        Promise.all(waiting.map((s) => s.promise)).then(
          (results) => {
            if (settled) return;
            waiting.forEach((s, i) => known.set(s.strategy, results[i]));
            release();
            resolve(answer());
          },
          (error: Error) => {
            if (settled) return;
            release();
            reject(error);
          },
        );
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      const stopped = new Error("The route planner was closed.");
      for (const search of [...queue.splice(0), ...threads.flatMap((t) => (t.search ? [t.search] : []))]) search.reject(stopped);
      inFlight.clear();
      await Promise.all(threads.splice(0).map((t) => ((t.dead = true), t.worker.terminate())));
    },
  };
}
