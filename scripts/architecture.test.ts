/**
 * The import rules of docs/architecture/MODULE_MAP.md that the compiler cannot check. (`npm run typecheck`
 * already fails an import across areas: web → engine or server, engine → server, anything → web.)
 *
 * Add a rule here when a module gains an internal that others must not reach.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** tsconfig files allow comments; these have them on their own lines only. */
const readConfig = (file: string) => JSON.parse(readFileSync(join(ROOT, file), "utf8").replace(/^\s*\/\/.*$/gm, ""));

/** The areas are whatever tsconfig.areas.json builds: read once here. */
const AREAS: string[] = readConfig("tsconfig.areas.json").references.map((ref: { path: string }) => ref.path.replace("./", ""));

interface SourceFile {
  /** Repo-relative, with forward slashes. */
  path: string;
  text: string;
  /** Each import: the specifier as written and, for a relative one, the repo-relative file it names. */
  imports: { specifier: string; target: string | null }[];
}

function sources(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const text = readFileSync(join(ROOT, path), "utf8");
        const specifiers = [...text.matchAll(/(?:from\s+|import\s+|import\()"([^"]+)"/g)].map((m) => m[1]);
        files.push({
          path,
          text,
          imports: specifiers.map((specifier) => ({
            specifier,
            target: specifier.startsWith(".") ? relative(ROOT, normalize(join(ROOT, dirname(path), specifier))).replaceAll("\\", "/") : null,
          })),
        });
      }
    }
  };
  AREAS.forEach(walk);
  return files;
}

const files = sources();
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith("tests/");

/** Files (other than `allowed`) that import something matching `banned`. */
function importers(banned: (target: string | null, specifier: string) => boolean, allowed: (path: string) => boolean): string[] {
  return files.filter((file) => !allowed(file.path) && file.imports.some((i) => banned(i.target, i.specifier))).map((file) => file.path);
}

describe("areas", () => {
  it("the whole-repo tsconfig.json covers exactly the areas of tsconfig.areas.json", () => {
    const include: string[] = readConfig("tsconfig.json").include;
    expect(include.filter((entry) => !entry.includes(".")).sort()).toEqual([...AREAS].sort());
  });
});

describe("import rules", () => {
  it("every relative import carries its extension, so Node can run the file as it is", () => {
    const bare = files.flatMap((file) => file.imports.filter((i) => i.target && !/\.(tsx?|css|json)$/.test(i.specifier)).map((i) => `${file.path} → ${i.specifier}`));
    expect(bare).toEqual([]);
  });

  it("outside engine/, the engine is imported through engine/index.ts only (graph indexes stay inside)", () => {
    expect(importers((target) => !!target?.startsWith("engine/") && target !== "engine/index.ts", (path) => path.startsWith("engine/"))).toEqual([]);
  });

  it("only server/store/postgres.ts talks to the database, and only server/http/serve.ts speaks HTTP", () => {
    expect(importers((_t, specifier) => ["pg", "@electric-sql/pglite"].includes(specifier), (path) => path === "server/store/postgres.ts" || isTest(path))).toEqual([]);
    expect(importers((_t, specifier) => specifier === "node:http", (path) => path === "server/http/serve.ts")).toEqual([]);
  });

  it("only server/http and web/data know the HTTP contract", () => {
    const allowed = (path: string) => path.startsWith("server/http/") || path.startsWith("web/data/") || isTest(path);
    expect(importers((target) => target === "shared/api.ts", allowed)).toEqual([]);
  });

  it("in the page, only web/data talks to the server; screens use web/data/hooks.ts", () => {
    const outsideData = files.filter((file) => file.path.startsWith("web/") && !file.path.startsWith("web/data/") && !isTest(file.path));
    expect(outsideData.filter((file) => /\bfetch\(/.test(file.text)).map((file) => file.path)).toEqual([]);
    expect(importers((target) => target === "web/data/query.ts", (path) => path.startsWith("web/data/") || isTest(path))).toEqual([]);
  });

  it("the server is assembled in server/app.ts only: no module reaches into another's folder for its factory", () => {
    const factories = /\b(openStore|createDirectory|createShops|createPlans|startRoutePlanner)\b/;
    // server/selftest.ts starts one route planner on its own: the boot check must not need a database.
    const assemblers = ["server/app.ts", "server/selftest.ts"];
    const users = files.filter((file) => file.path.startsWith("server/") && !isTest(file.path) && !assemblers.includes(file.path));
    expect(users.filter((file) => file.imports.some((i) => i.target && factories.test(importLine(file.text, i.specifier)))).map((f) => f.path)).toEqual([]);
  });
});

describe("Node runs these files by stripping types", () => {
  // Every area but the page and its tests runs in Node.
  const nodeAreas = AREAS.filter((area) => area !== "web" && area !== "tests");
  const nodeRun = files.filter((file) => nodeAreas.some((area) => file.path.startsWith(`${area}/`)));
  it("no parameter properties, enums or namespaces (TypeScript 5.6 cannot flag them; Node refuses them)", () => {
    const bad = nodeRun.filter(
      (file) => /constructor\s*\([^)]*\b(public|private|protected|readonly)\s/.test(file.text) || /^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s/m.test(file.text) || /^\s*(export\s+)?namespace\s/m.test(file.text),
    );
    expect(bad.map((file) => file.path)).toEqual([]);
  });
});

/** The import statement that names `specifier`, to see which names it brings in. */
function importLine(text: string, specifier: string): string {
  const at = text.indexOf(`"${specifier}"`);
  return text.slice(text.lastIndexOf("import", at), at);
}
