import { afterEach } from "vitest";

// Runs before every test file. Only files that opt into jsdom (// @vitest-environment jsdom) have a
// document; with vitest globals off, Testing Library cannot register its own cleanup between tests.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
