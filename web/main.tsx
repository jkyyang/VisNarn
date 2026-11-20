import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Before our own stylesheet, which restyles some MapLibre controls.
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./app/App.tsx";

// Focus rings are for the keyboard: a press with a mouse, a finger or a pen hides them until the next key (styles.css).
const input = (kind: "pointer" | "keys") => () => void (document.documentElement.dataset.input = kind);
window.addEventListener("pointerdown", input("pointer"), true);
window.addEventListener("keydown", input("keys"), true);

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");

/**
 * The page is drawn once its stylesheet applies. A browser may run this module first (Safari does, when the
 * stylesheet comes later from the network): the map would then be made in an unstyled page, a small box that
 * cannot frame the network, and open on the far corner of its bounds.
 */
const styled = () => getComputedStyle(document.documentElement).getPropertyValue("--accent") !== "";
const app = createRoot(root);
(function draw() {
  if (!styled()) return void requestAnimationFrame(draw);
  app.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
