/**
 * The HTTP shell on node:http. It knows the protocol and nothing about cars: match the route,
 * decode the request, call the handler, encode the answer.
 *
 * Local-only rules, because there is no login yet:
 * - the Host header must name the loopback address and this port (a page on another site cannot
 *   reach the server by pointing its own domain name at 127.0.0.1: "DNS rebinding");
 * - a request that carries an Origin must come from this server's own page, and one the browser marks
 *   as sent from another site is refused unless it opens the page in a window: this covers every
 *   path, not only /api, because in development Vite serves any file it can read (the database too);
 * - a body must be sent as application/json, which a form or a plain cross-site request cannot do;
 * - answers are never cached and request bodies are never logged.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { routeMatcher, STATUS_OF, type ApiErrorBody, type Route } from "../../shared/api.ts";
import { AppError } from "../../shared/app.ts";
import type { App } from "../app.ts";
import { LOOPBACK } from "../config.ts";
import { decodeBody, decodeQuery } from "./decode.ts";
import { handlers, type HandlerContext } from "./handlers.ts";

export interface Server {
  /** "http://127.0.0.1:8787". */
  url: string;
  close(): Promise<void>;
}

/** Largest request body accepted: a CSV of a few thousand cars is well under this. */
const BODY_LIMIT = 5 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".geojson": "application/geo+json",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/** A refusal with its own HTTP status (403, 413, 415). The body is still the API's error envelope. */
class Refusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const envelope = (kind: ApiErrorBody["error"]["kind"], message: string, field: string | null = null): ApiErrorBody => ({ error: { kind, message, field } });

/**
 * Starts listening on the loopback address. There is no host option: see LOOPBACK in ../config.ts.
 * Port 0 picks a free port (tests). `dev`: the page is served from source by Vite, inside this
 * server and on its port, with hot reload; otherwise from `webDir`, or not at all.
 */
export async function serve(app: App, options: { port: number; webDir: string | null; dev?: boolean }): Promise<Server> {
  const match = routeMatcher(Object.keys(handlers) as Route[]);
  const webRoot = options.webDir ? resolve(options.webDir) : null;
  let vite: ViteDevServer | null = null;

  const server = createServer((req, res) => {
    respond(req, res).catch((error: unknown) => {
      console.error("Request failed:", error instanceof Error ? error.stack : error);
      if (!res.headersSent) sendJson(res, 500, envelope("internal", "Something went wrong on the server."));
      else res.destroy();
    });
  });

  const port = () => (server.address() as AddressInfo).port;
  const loopbackHost = (host: string | undefined) => {
    const m = /^(127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/i.exec(host ?? "");
    return !!m && (m[2] ? Number(m[2]) : 80) === port();
  };
  const sameOrigin = (origin: string) => origin === `http://${LOOPBACK}:${port()}` || origin === `http://localhost:${port()}`;
  /** A navigation cannot read the answer, so a link from another site may still open the page. */
  const fromAnotherPage = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !sameOrigin(origin)) return true;
    const site = req.headers["sec-fetch-site"];
    return site !== undefined && site !== "same-origin" && site !== "none" && req.headers["sec-fetch-mode"] !== "navigate";
  };

  async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    if (!loopbackHost(req.headers.host)) {
      return sendJson(res, 403, envelope("invalid", `This server only answers requests addressed to ${LOOPBACK}:${port()}.`));
    }
    if (fromAnotherPage(req)) {
      req.resume();
      return sendJson(res, 403, envelope("invalid", "Requests from other web pages are refused."));
    }
    const target = req.url ?? "/";
    if (!target.startsWith("/")) return sendJson(res, 400, envelope("invalid", "Bad request path."));
    const url = new URL(`http://${LOOPBACK}${target}`);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return api(req, res, url);
    if (vite) {
      const devServer = vite;
      return new Promise<void>((done) => {
        devServer.middlewares(req, res, () => {
          sendJson(res, 404, envelope("not-found", "Not found."));
          done();
        });
        res.on("close", () => done());
      });
    }
    if (webRoot) return staticFile(req, res, url.pathname, webRoot);
    return sendJson(res, 404, envelope("not-found", "This server answers /api only; the page is served by `npm run dev` or `npm start`."));
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const method = req.method ?? "GET";
    const found = match(method, url.pathname);
    if (!found) {
      req.resume();
      return sendJson(res, 404, envelope("not-found", `There is no ${method} ${url.pathname}.`));
    }
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort(new Error("The browser stopped waiting for this answer."));
    });
    try {
      const request: { params: Record<string, string>; query?: unknown; body?: unknown } = { params: found.params };
      const readQuery = (decodeQuery as Partial<Record<Route, (query: URLSearchParams) => unknown>>)[found.route];
      if (readQuery) request.query = readQuery(url.searchParams);
      const readBody = (decodeBody as Partial<Record<Route, (json: unknown) => unknown>>)[found.route];
      if (readBody) request.body = readBody(await jsonBody(req));
      else req.resume();
      const handler = handlers[found.route] as (request: unknown, context: HandlerContext) => unknown;
      const answer = await handler(request, { app, signal: controller.signal });
      sendJson(res, 200, answer ?? null);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AppError) return sendJson(res, STATUS_OF[error.kind], envelope(error.kind, error.message, error.field));
      if (error instanceof Refusal) return sendJson(res, error.status, envelope("invalid", error.message));
      // The route and the stack only: a request body may hold car data and is never written to a log.
      console.error(`${found.route} failed:`, error instanceof Error ? error.stack : String(error));
      sendJson(res, 500, envelope("internal", "Something went wrong on the server. The details are in its log."));
    }
  }

  if (options.dev) {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const { createServer: createVite } = await import("vite");
    vite = await createVite({ root, configFile: join(root, "vite.config.ts"), appType: "spa", server: { middlewareMode: true, hmr: { server }, cors: false } });
    // Vite's hot-reload socket arrives as an "upgrade", which skips the request checks above.
    const upgrades = server.listeners("upgrade") as ((req: IncomingMessage, socket: Socket, head: Buffer) => void)[];
    server.removeAllListeners("upgrade");
    server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const origin = req.headers.origin;
      if (!loopbackHost(req.headers.host) || (origin !== undefined && !sameOrigin(origin))) return void socket.destroy();
      for (const listener of upgrades) listener.call(server, req, socket, head);
    });
  }

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port, LOOPBACK, () => {
      server.off("error", fail);
      done();
    });
  });

  return {
    url: `http://${LOOPBACK}:${port()}`,
    async close() {
      // Vite's close waits for a dependency pre-bundle in progress (the first start), which can hang.
      if (vite) await Promise.race([vite.close(), new Promise((done) => setTimeout(done, 3_000).unref())]);
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}

/** The request body as JSON. Refuses anything not sent as application/json, and anything over BODY_LIMIT. */
async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    req.resume();
    throw new Refusal(415, "Send the request body as JSON (Content-Type: application/json).");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  // An oversized body is still read to its end (and dropped): answering mid-upload resets the
  // connection, and the browser would show a network error instead of this message.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= BODY_LIMIT) chunks.push(chunk);
  }
  if (size > BODY_LIMIT) throw new Refusal(413, "The request is larger than 5 MB.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("invalid", "The request body is not valid JSON.");
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/** A file of the built page, or index.html for any path that is not a file (the page routes by URL). */
async function staticFile(req: IncomingMessage, res: ServerResponse, pathname: string, root: string): Promise<void> {
  req.resume();
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, envelope("invalid", "Only GET and HEAD are served here."));
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, envelope("invalid", "Bad request path."));
  }
  if (path.includes("\0")) return sendJson(res, 400, envelope("invalid", "Bad request path."));
  const isFile = async (file: string) => (await stat(file).catch(() => null))?.isFile() ?? false;
  let file = resolve(root, `.${path}`);
  if (file !== root && !file.startsWith(root + sep)) return sendJson(res, 404, envelope("not-found", "Not found."));
  if (!(await isFile(file))) {
    if (await isFile(join(file, "index.html"))) file = join(file, "index.html");
    else if (extname(path)) return sendJson(res, 404, envelope("not-found", "Not found."));
    else file = join(root, "index.html");
  }
  if (!(await isFile(file))) return sendJson(res, 404, envelope("not-found", "The page is not built yet. Run `npm run build`."));
  const info = await stat(file);
  // Vite puts a content hash in every name under assets/, so those never change; anything else is checked each time.
  const immutable = file.startsWith(join(root, "assets") + sep);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return void res.end();
  await new Promise<void>((done) => {
    const stream = createReadStream(file);
    stream.on("error", () => (res.destroy(), done()));
    res.on("close", () => (stream.destroy(), done()));
    stream.pipe(res);
  });
}
