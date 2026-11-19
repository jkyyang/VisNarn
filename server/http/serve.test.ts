/**
 * The HTTP shell on its own: a stand-in App, real sockets. Requests are written by hand so that the
 * Host and Origin headers can be anything a hostile page could send.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import type { App } from "../app.ts";
import { serve, type Server } from "./serve.ts";

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** One HTTP/1.1 request over a fresh socket; `headers` replaces the defaults (Host, Connection) it names. */
function raw(port: number, method: string, path: string, headers: Record<string, string> = {}, body = ""): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const all: Record<string, string> = { host: `127.0.0.1:${port}`, connection: "close", ...headers };
    if (body) all["content-length"] = String(Buffer.byteLength(body));
    const lines = Object.entries(all).map(([k, v]) => `${k}: ${v}`);
    socket.write(`${method} ${path} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n${body}`);
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("error", reject);
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const [head, ...rest] = text.split("\r\n\r\n");
      const [statusLine, ...headerLines] = head.split("\r\n");
      resolve({
        status: Number(statusLine.split(" ")[1]),
        headers: Object.fromEntries(headerLines.map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()])),
        body: rest.join("\r\n\r\n"),
      });
    });
  });
}

const json = (headers: Record<string, string> = {}) => ({ "content-type": "application/json", ...headers });

let routeStarted: () => void = () => {};
let routeAborted: Promise<unknown> = Promise.resolve();

const DRAFT = {
  name: "EXAMPLE route",
  plan: { places: [{ kind: "text", text: "Temple, TX" }, { kind: "text", text: "Waco, TX" }], include: DEFAULT_INCLUDE, turnAtStops: false },
  option: null,
  routeString: "BNSF",
};

/** Only what these tests call; the rest of App is never reached. */
const fakeApp = {
  shops: {
    list: () => [],
    remove: (id: string) => {
      if (id === "gone") throw new AppError("not-found", "No such shop.");
      if (id === "taken") throw new AppError("conflict", "Code in use.");
      throw new Error("database exploded");
    },
    save: () => {
      throw new Error("save failed");
    },
  },
  plans: {
    save: (draft: typeof DRAFT) => {
      if (draft.name === "EXAMPLE taken") throw new AppError("invalid", "Give the route another name.", "name");
      return { ...draft, id: "r1" };
    },
    route: (_plan: unknown, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        routeAborted = new Promise((done) => signal.addEventListener("abort", () => (done(signal.reason), reject(signal.reason))));
        routeStarted();
      }),
  },
} as unknown as App;

let server: Server;
let port: number;

beforeAll(async () => {
  server = await serve(fakeApp, { port: 0, webDir: null });
  port = Number(new URL(server.url).port);
});
afterAll(async () => {
  await server.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("serve: local only", () => {
  it("listens on 127.0.0.1 only, and refuses a request whose Host is not loopback", async () => {
    expect(server.url).toBe(`http://127.0.0.1:${port}`);
    expect((await raw(port, "GET", "/api/shops")).status).toBe(200);
    expect((await raw(port, "GET", "/api/shops", { host: `localhost:${port}` })).status).toBe(200);
    for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1:${port + 1}`, `192.168.1.20:${port}`]) {
      const answer = await raw(port, "GET", "/api/shops", { host });
      expect(answer.status, host).toBe(403);
      expect(JSON.parse(answer.body).error.kind).toBe("invalid");
    }
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    for (const address of lan ? [lan, "::1"] : ["::1"]) {
      await expect(
        new Promise((resolve, reject) => {
          const socket = connect(port, address, () => (socket.destroy(), resolve("connected")));
          socket.on("error", reject);
        }),
        address,
      ).rejects.toThrow(/ECONNREFUSED|EADDRNOTAVAIL|ENETUNREACH/);
    }
  });

  it("refuses API calls from another page's Origin, and a body that is not JSON", async () => {
    const body = JSON.stringify(DRAFT);
    expect((await raw(port, "POST", "/api/saved-routes", json({ origin: "https://evil.example" }), body)).status).toBe(403);
    expect((await raw(port, "GET", "/api/shops", { origin: "http://127.0.0.1:1" })).status).toBe(403);
    expect((await raw(port, "POST", "/api/saved-routes", json({ origin: `http://127.0.0.1:${port}` }), body)).status).toBe(200);
    expect((await raw(port, "POST", "/api/saved-routes", json({ host: `localhost:${port}`, origin: `http://localhost:${port}` }), body)).status).toBe(200);
    // The Origin names the host the request was sent to, or it is another page.
    expect((await raw(port, "POST", "/api/saved-routes", json({ origin: `http://localhost:${port}` }), body)).status).toBe(403);
    const asForm = await raw(port, "POST", "/api/saved-routes", { "content-type": "text/plain" }, body);
    expect(asForm.status).toBe(415);
    expect(JSON.parse(asForm.body).error.message).toMatch(/application\/json/);
  });

  it("never lets an answer be cached", async () => {
    for (const answer of [await raw(port, "GET", "/api/shops"), await raw(port, "GET", "/api/nothing"), await raw(port, "DELETE", "/api/shops/gone")]) {
      expect(answer.headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("serve: the API envelope", () => {
  it("answers an unknown route with 404 and the error envelope; a malformed body with 400 and the field", async () => {
    const unknown = await raw(port, "GET", "/api/nothing");
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body)).toEqual({ error: { kind: "not-found", message: "There is no GET /api/nothing.", field: null } });
    expect((await raw(port, "PUT", "/api/saved-routes", json(), "{}")).status).toBe(404);

    const notJson = await raw(port, "POST", "/api/saved-routes", json(), "{ not json");
    expect(notJson.status).toBe(400);
    expect(JSON.parse(notJson.body).error).toMatchObject({ kind: "invalid", message: "The request body is not valid JSON." });

    const badField = await raw(port, "POST", "/api/saved-routes", json(), JSON.stringify({ ...DRAFT, option: "fastest" }));
    expect(badField.status).toBe(400);
    expect(JSON.parse(badField.body).error).toMatchObject({ kind: "invalid", field: "option" });
  });

  it("turns an AppError into its status, with the field the app named", async () => {
    const refused = await raw(port, "POST", "/api/saved-routes", json(), JSON.stringify({ ...DRAFT, name: "EXAMPLE taken" }));
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body)).toEqual({ error: { kind: "invalid", message: "Give the route another name.", field: "name" } });
    expect((await raw(port, "DELETE", "/api/shops/gone")).status).toBe(404);
    expect((await raw(port, "DELETE", "/api/shops/taken")).status).toBe(409);
    const saved = await raw(port, "POST", "/api/saved-routes", json(), JSON.stringify(DRAFT));
    expect(JSON.parse(saved.body)).toEqual({ ...DRAFT, id: "r1" });
  });

  it("hides a crash behind 'internal' and logs the route and stack, never the request body", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    const crash = await raw(port, "DELETE", "/api/shops/x");
    expect(crash.status).toBe(500);
    expect(JSON.parse(crash.body).error.kind).toBe("internal");
    expect(crash.body).not.toMatch(/exploded/);

    const secret = "EXAMPLE-CAR-CONFIDENTIAL-104233";
    const failed = await raw(port, "PUT", "/api/shops/s1", json(), JSON.stringify({ name: secret, code: null, location: { kind: "text", text: secret }, links: [] }));
    expect(failed.status).toBe(500);
    expect(logged.join("\n")).toMatch(/DELETE \/api\/shops\/:shopId failed/);
    expect(logged.join("\n")).toMatch(/save failed/);
    expect(logged.join("\n")).not.toContain(secret);
  });

  it("refuses a body over 5 MB", async () => {
    const big = JSON.stringify({ source: { kind: "csv", fileName: "big.csv", text: "x".repeat(5 * 1024 * 1024) }, commit: false });
    const answer = await raw(port, "POST", "/api/shops/import", json(), big);
    expect(answer.status).toBe(413);
  });

  it("aborts the app's work when the browser gives up on the request", async () => {
    const started = new Promise<void>((done) => (routeStarted = done));
    const body = JSON.stringify({ places: [{ kind: "text", text: "A" }, { kind: "text", text: "B" }], include: DEFAULT_INCLUDE, turnAtStops: false });
    const socket = connect(port, "127.0.0.1");
    socket.write(`POST /api/route HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    await started;
    socket.destroy();
    await expect(routeAborted).resolves.toBeInstanceOf(Error);
  });
});

describe("serve: the page", () => {
  let web: string;
  let site: Server;
  let sitePort: number;

  beforeAll(async () => {
    web = mkdtempSync(join(tmpdir(), "visnarn-web-"));
    mkdirSync(join(web, "assets"));
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Shop Arrival Check</title>");
    writeFileSync(join(web, "assets", "app-1234.js"), "console.log(1)");
    writeFileSync(join(tmpdir(), "visnarn-outside.txt"), "outside");
    site = await serve(fakeApp, { port: 0, webDir: web });
    sitePort = Number(new URL(site.url).port);
  });
  afterAll(async () => {
    await site.close();
    rmSync(web, { recursive: true, force: true });
  });

  it("serves the built page, and index.html for any page address", async () => {
    for (const path of ["/", "/shops", "/route/saved/12?x=1"]) {
      const page = await raw(sitePort, "GET", path);
      expect(page.status, path).toBe(200);
      expect(page.headers["content-type"]).toMatch(/^text\/html/);
      expect(page.body).toContain("Shop Arrival Check");
    }
    const script = await raw(sitePort, "GET", "/assets/app-1234.js");
    expect(script.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(script.headers["cache-control"]).toMatch(/immutable/);
    expect(script.headers["x-frame-options"]).toBe("DENY");
    expect((await raw(sitePort, "GET", "/assets/missing.js")).status).toBe(404);
    expect((await raw(sitePort, "GET", "/api/shops")).status).toBe(200);
  });

  it("never serves a file outside its folder", async () => {
    for (const path of ["/../visnarn-outside.txt", "/%2e%2e/visnarn-outside.txt", "/..%2fvisnarn-outside.txt", "/%2e%2e%2fvisnarn-outside.txt"]) {
      const answer = await raw(sitePort, "GET", path);
      expect(answer.body, path).not.toContain("outside");
    }
  });

  it("answers /api only when it has no page to serve", async () => {
    expect((await raw(port, "GET", "/")).status).toBe(404);
  });
});

describe("serve: development", () => {
  let dev: Server;
  let devPort: number;
  beforeAll(async () => {
    dev = await serve(fakeApp, { port: 0, webDir: null, dev: true });
    devPort = Number(new URL(dev.url).port);
  });
  afterAll(async () => {
    await dev.close();
  });

  /** The status line a websocket upgrade gets, or "closed" when the server drops the socket. */
  const upgrade = (host: string) =>
    new Promise<string>((resolve) => {
      const socket = connect(devPort, "127.0.0.1");
      socket.write(
        `GET / HTTP/1.1\r\nhost: ${host}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\nsec-websocket-protocol: vite-hmr\r\n\r\n`,
      );
      let text = "";
      socket.on("data", (c) => {
        text += c.toString();
        socket.destroy();
        resolve(text.split("\r\n")[0]);
      });
      socket.on("close", () => resolve(text ? text.split("\r\n")[0] : "closed"));
      socket.on("error", () => resolve("closed"));
    });

  it("serves the page from source and the API on one port, with hot reload over the same port", async () => {
    const page = await raw(devPort, "GET", "/cars");
    expect(page.status).toBe(200);
    expect(page.body).toContain("/@vite/client");
    const entry = await raw(devPort, "GET", "/web/main.tsx");
    expect(entry.status).toBe(200);
    expect(entry.headers["content-type"]).toMatch(/javascript/);
    expect(JSON.parse((await raw(devPort, "GET", "/api/shops")).body)).toEqual([]);
    expect(await upgrade(`127.0.0.1:${devPort}`)).toBe("HTTP/1.1 101 Switching Protocols");
  });

  it("applies the Host rule to pages and to the hot-reload socket too", async () => {
    expect((await raw(devPort, "GET", "/", { host: "evil.example" })).status).toBe(403);
    expect(await upgrade("evil.example")).toBe("closed");
  });

  it("never hands a file to another web page, even through Vite's raw-import path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "visnarn-serve-leak-"));
    const db = join(dir, "visnarn.db");
    writeFileSync(db, 'SQLite format 3 {"carId":"EXAMPLE 663012"}');
    try {
      for (const path of [`/@fs${db}?import&raw??`, "/package.json", "/web/main.tsx"]) {
        const fromEvil = await raw(devPort, "GET", path, { origin: "https://evil.example" });
        expect(fromEvil.status, path).toBe(403);
        expect(fromEvil.headers["access-control-allow-origin"], path).toBeUndefined();
        expect(fromEvil.body, path).not.toContain("EXAMPLE 663012");
        const asScript = await raw(devPort, "GET", path, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" });
        expect(asScript.status, path).toBe(403);
      }
      const sameSite = await raw(devPort, "GET", `/@fs${db}?import&raw??`, { "sec-fetch-site": "same-site", "sec-fetch-mode": "cors", origin: "http://127.0.0.1:1" });
      expect(sameSite.status).toBe(403);
      const ownPage = await raw(devPort, "GET", "/web/main.tsx", { origin: `http://127.0.0.1:${devPort}`, "sec-fetch-site": "same-origin" });
      expect(ownPage.status).toBe(200);
      expect(ownPage.headers["access-control-allow-origin"]).toBeUndefined();
      const linkFromAnotherSite = await raw(devPort, "GET", "/cars", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
      expect(linkFromAnotherSite.status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
