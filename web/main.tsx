import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Before our own stylesheet, which restyles some MapLibre controls.
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./app/App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
