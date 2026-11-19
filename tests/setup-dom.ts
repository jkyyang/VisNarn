import { afterEach } from "vitest";

// Runs before every test file. Only files that opt into jsdom (// @vitest-environment jsdom) have a
// document; with vitest globals off, Testing Library cannot register its own cleanup between tests.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
  // Node 25 has a localStorage of its own (unusable without --localstorage-file) that hides jsdom's.
  const { jsdom } = globalThis as unknown as { jsdom: { window: Window } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: jsdom.window.localStorage });
  // jsdom has no layout, so there is nothing to scroll; its own scrollTo only logs "Not implemented".
  window.scrollTo = () => {};
  // Nor does anything resize: the phone's sheet watches its size with a ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
