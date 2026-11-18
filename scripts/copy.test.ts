/** The wording rules for everything a person reads: UI strings, messages, docs, comments and test names. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FOLDERS = ["web", "server", "shared", "engine", "tests", "scripts", "pipeline", "docs"];
const TEXT_FILE = /\.(tsx?|mjs|css|py|sh|md)$/;
const THIS_FILE = "scripts/copy.test.ts";

const RULES = [
  { name: "an em dash aside", pattern: / — / },
  { name: '"not a ..." (say what it is)', pattern: /\bnot an? [^.]{1,40}/i },
];

function textFiles(): string[] {
  const found = ["README.md"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (TEXT_FILE.test(entry.name) && path !== THIS_FILE) found.push(path);
    }
  };
  FOLDERS.forEach(walk);
  return found;
}

describe("copy", () => {
  for (const { name, pattern } of RULES) {
    it(`has no ${name}`, () => {
      const hits = textFiles().flatMap((path) =>
        readFileSync(join(ROOT, path), "utf8")
          .split("\n")
          .flatMap((line, i) => (pattern.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])),
      );
      expect(hits).toEqual([]);
    });
  }
});
