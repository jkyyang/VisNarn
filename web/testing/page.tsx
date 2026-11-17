/**
 * Opening the whole page in a test: the URL first, then <App />, against the fake back end. The test
 * file itself mocks the map canvas (vi.mock is per file) and clears the query cache between tests.
 */
import { render, type RenderResult } from "@testing-library/react";
import App from "../app/App.tsx";
import { forgetPlan } from "../screens/route/session.ts";

/** jsdom draws nothing, but the page only loads its map where WebGL exists; the canvas is faked anyway. */
function pretendWebGL(): void {
  const w = window as unknown as Record<string, unknown>;
  w.WebGLRenderingContext ??= function WebGLRenderingContext() {};
}

/** The Phone layout: `matchMedia` answers the narrow-screen query, as a 390 px wide browser would. */
export function pretendPhone(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

export function openPage(path: string): RenderResult {
  forgetPlan();
  pretendWebGL();
  window.history.replaceState(null, "", path);
  return render(<App />);
}

export const currentPath = () => window.location.pathname + window.location.search;
