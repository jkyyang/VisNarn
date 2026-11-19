/**
 * The Vercel function (api/index.ts, see vercel.json): the laptop's app and HTTP handler, answering /api.
 * Vercel serves the built page (dist/) itself. The database is DATABASE_URL (Neon).
 */
import process from "node:process";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { handler, type Respond } from "./http/serve.ts";

/** One app per function instance: started by its first request, kept for the next. A failed start is tried again. */
let ready: Promise<Respond> | null = null;

const respond: Respond = async (req, res) => {
  ready ??= createApp(readConfig([], process.env)).then(
    (app) => handler(app),
    (error: unknown) => {
      ready = null;
      throw error;
    },
  );
  return (await ready)(req, res);
};

export default respond;
