/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In development, server/http/serve.ts runs Vite in middleware mode inside the Node server, so the
 * page, /api and hot reload share one origin and one port; there is no proxy. `npm start` serves the
 * built page from the same server.
 */
export default defineConfig({
  plugins: [react()],
  // Only for someone running `npx vite` by hand: even then, never on the network.
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  // A dev server started inside a test (serve.test.ts) skips pre-bundling, as vitest already does for
  // its own server, and keeps its cache apart: under NODE_ENV=test Vite's bundle hash differs, and
  // sharing node_modules/.vite would make the next `npm run dev` bundle everything again.
  optimizeDeps: process.env.VITEST ? { noDiscovery: true, include: [] } : {},
  cacheDir: process.env.VITEST ? "node_modules/.vite-test" : "node_modules/.vite",
  test: {
    // Node by default; a page test that clicks opts into a DOM with `// @vitest-environment jsdom` on its first line.
    environment: "node",
    setupFiles: ["tests/setup-dom.ts"],
    // tests/e2e/ belongs to Playwright (npm run test:e2e).
    exclude: ["node_modules", "dist", ".tsbuild", "tests/e2e/**", ".claude/**"],
    // For web/map/layers: deck.gl only loads through Vite's resolver. Under plain Node, luma.gl's
    // import of wgsl_reflect fails (that package ships CommonJS marked as ESM).
    server: { deps: { inline: [/deck\.gl/, /luma\.gl/, /wgsl_reflect/] } },
  },
});
