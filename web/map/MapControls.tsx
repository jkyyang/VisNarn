import { useId, useState, type ReactElement } from "react";
import type { BasemapKind } from "./basemaps.ts";
import { LIGHT_WORDS, type LightMode, type MapLook } from "./daylight.ts";
import type { MapLayerChoice } from "./MapCanvas.tsx";

export interface MapControlsProps {
  layers: MapLayerChoice;
  onLayers: (next: MapLayerChoice) => void;
  /** What Auto shows now, for the button and the hint under the switch. */
  look: MapLook;
  onZoom: (step: 1 | -1) => void;
  onFit: () => void;
  history: { undo: (() => void) | null; redo: (() => void) | null } | null;
}

const BASEMAPS: [BasemapKind, string][] = [
  ["map", "Map"],
  ["satellite", "Satellite"],
];

const LIGHTS: [LightMode, string][] = [
  ["auto", "Auto"],
  ["day", "Day"],
  ["night", "Night"],
];

/** The small picture on each layer tile, like the mockup's thumbnails. */
const Thumb = ({ kind }: { kind: BasemapKind | "tracks" }) => <span className={`layer-thumb layer-thumb--${kind}`} aria-hidden="true" />;

/**
 * Top-right of the map: "Layers · Map · Day" (Map / Satellite / Real tracks, Class I network, Auto /
 * Day / Night), zoom, undo / redo, fit whole route.
 */
export function MapControls(props: MapControlsProps): ReactElement {
  const { layers, onLayers } = props;
  const [open, setOpen] = useState(false);
  const lightLabel = useId();
  const tracksOn = layers.tracks;
  const lightWord = LIGHT_WORDS[props.look.phase];
  const summary = `${layers.basemap === "map" ? "Map" : "Satellite"} · ${lightWord}${tracksOn ? " + tracks" : ""}`;

  return (
    <div className="map-controls">
      <button type="button" className="map-btn map-btn--layers" aria-expanded={open} aria-label={`Map layers: ${summary}`} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 3l7 4-7 4-7-4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M3 11l7 4 7-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span className="map-btn-text">Layers · {summary}</span>
      </button>
      {open && (
        <div className="layers-card">
          <div className="layer-tiles" role="radiogroup" aria-label="Map layer">
            {BASEMAPS.map(([kind, label]) => (
              <button key={kind} type="button" role="radio" aria-checked={layers.basemap === kind} className="layer-tile" onClick={() => onLayers({ ...layers, basemap: kind })}>
                <Thumb kind={kind} />
                {label}
              </button>
            ))}
            <button
              type="button"
              role="checkbox"
              aria-checked={tracksOn}
              title="OpenRailwayMap tracks, stations and yards"
              className="layer-tile"
              onClick={() => onLayers({ ...layers, tracks: !layers.tracks })}
            >
              <Thumb kind="tracks" />
              Real tracks
            </button>
          </div>
          <label className="check small">
            <input type="checkbox" checked={layers.network} onChange={(e) => onLayers({ ...layers, network: e.target.checked })} />
            Class I network
          </label>
          <div className="light-switch">
            <span className="light-switch-label" id={lightLabel}>
              Time of day
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby={lightLabel}>
              {LIGHTS.map(([mode, label]) => (
                <button key={mode} type="button" role="radio" aria-checked={layers.light === mode} onClick={() => onLayers({ ...layers, light: mode })}>
                  {label}
                </button>
              ))}
            </div>
            {layers.light === "auto" && <p className="light-switch-hint">Follows the clock. Now: {lightWord}</p>}
          </div>
        </div>
      )}
      <div className="ctl-group">
        <button type="button" className="map-btn" aria-label="Zoom in" onClick={() => props.onZoom(1)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <span className="ctl-sep" />
        <button type="button" className="map-btn" aria-label="Zoom out" onClick={() => props.onZoom(-1)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {props.history && (
        <div className="ctl-group ctl-group--history">
          <button type="button" className="map-btn" aria-label="Undo route change" disabled={!props.history.undo} onClick={() => props.history?.undo?.()}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M7 4L3 8l4 4M3 8h8a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="ctl-sep" />
          <button type="button" className="map-btn" aria-label="Redo route change" disabled={!props.history.redo} onClick={() => props.history?.redo?.()}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M11 4l4 4-4 4M15 8H7a4 4 0 0 0 0 8h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      <button type="button" className="map-btn map-btn--solo" aria-label="Fit whole route" onClick={props.onFit}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
