/**
 * The whole back end in one test process: a real database file in a temp folder, a real routing
 * worker, real HTTP on a free loopback port. Tests talk to it through the page's own transport
 * (callApi), so what they exercise is exactly what the browser would.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NETWORK_DIR } from "../engine/index.ts";
import type { ShopDraft } from "../shared/places.ts";
import type { Request, RequestArgs, Res, Route } from "../shared/api.ts";
import { createApp, type App } from "../server/app.ts";
import type { Config } from "../server/config.ts";
import { serve } from "../server/http/serve.ts";
import { callApi } from "../web/data/query.ts";
import { EXAMPLE_SHOPS } from "./fixtures.ts";

export interface TestApp {
  /** For arranging state directly and for rendering screens from real answers. */
  app: App;
  /** "http://127.0.0.1:<port>". */
  url: string;
  /** The data folder, for a restart on the same data. */
  dataDir: string;
  /** One typed HTTP call to the test server. */
  api<R extends Route>(route: R, ...request: RequestArgs<R>): Promise<Res<R>>;
  /** Stops the server and the app. The data folder is removed unless `keepData` (for a restart on it). */
  close(options?: { keepData: boolean }): Promise<void>;
}

/**
 * Starts on a new data folder holding `shops` (the EXAMPLE shops unless given), or on the `dataDir`
 * of a TestApp closed with `keepData`, to see what survives a restart.
 */
export async function startTestApp(options: { dataDir?: string; shops?: ShopDraft[] } = {}): Promise<TestApp> {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "visnarn-"));
  const config: Config = { port: 0, databaseUrl: null, dataDir, networkDir: DEFAULT_NETWORK_DIR, webDir: null, routeWorkers: 1 };
  const app = await createApp(config);
  if (!options.dataDir) for (const shop of options.shops ?? EXAMPLE_SHOPS) await app.shops.save(shop, null);
  const server = await serve(app, config).catch(async (error: unknown) => {
    await app.close();
    throw error;
  });

  const api = <R extends Route>(route: R, ...request: RequestArgs<R>): Promise<Res<R>> => callApi(server.url, route, request[0] as Request<R>);

  return {
    app,
    url: server.url,
    dataDir,
    api,
    async close({ keepData } = { keepData: false }) {
      await server.close();
      await app.close();
      if (!keepData) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
