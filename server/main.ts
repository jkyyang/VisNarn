/** Entry point: `node server/main.ts`. Reads the configuration, builds the app, serves it. */
import process from "node:process";
import { createApp, type App } from "./app.ts";
import { readConfig, selfTestRequested } from "./config.ts";
import { serve } from "./http/serve.ts";
import { selfTest } from "./selftest.ts";

const argv = process.argv.slice(2);

async function main(): Promise<number> {
  const config = readConfig(argv, process.env);
  if (selfTestRequested(argv)) return (await selfTest(config, (line) => console.log(line))) ? 0 : 1;

  let app: App | null = null;
  try {
    app = await createApp(config);
    const server = await serve(app, config);
    const page = config.dev ? "page from source, reloads on save" : config.webDir ? "built page" : "API only";
    console.log(`Shop Arrival Check: ${server.url}  (${page})  ·  data in ${config.dataDir} (this laptop only)`);
    const running = app;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void server
          .close()
          .then(() => running.close())
          .finally(() => process.exit(0));
      });
    }
    return 0;
  } catch (error) {
    await app?.close().catch(() => {});
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error(`Port ${config.port} is already in use: another copy may be running. Stop it, or set VISNARN_PORT to another port.`);
    }
    throw error;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`Shop Arrival Check could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
