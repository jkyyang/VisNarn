import { useId, useState, type ReactElement } from "react";
import { DISTANCE_UNITS, type DistanceUnit } from "../units.ts";
import type { BasemapKind } from "./basemaps.ts";
import type { LightMode, LightPhase, MapLook } from "./daylight.ts";
import type { MapLayerChoice } from "./MapCanvas.tsx";

interface MapControlsProps {
  layers: MapLayerChoice;
  onLayers: (next: MapLayerChoice) => void;
  unit: DistanceUnit;
  onUnit: (unit: DistanceUnit) => void;
  /** What Auto shows now, for the button's name. */
  look: MapLook;
  onZoom: (step: 1 | -1) => void;
  onFit: () => void;
  history: { undo: (() => void) | null; redo: (() => void) | null } | null;
}

const BASEMAPS: Record<BasemapKind, string> = { map: "Map", satellite: "Satellite" };
const LIGHTS: [LightMode, string][] = [
  ["auto", "Auto"],
  ["day", "Day"],
  ["night", "Night"],
];
const UNITS = DISTANCE_UNITS.map((unit): [DistanceUnit, string] => [unit, unit]);
const LIGHT_WORDS: Record<LightPhase, string> = { day: "Day", sunrise: "Sunrise", sunset: "Sunset", night: "Night" };

/** One setting of the layers card: its name over a segmented choice. */
function ChoiceRow<T extends string>(props: { label: string; options: [T, string][]; value: T; onChange: (value: T) => void }): ReactElement {
  const labelId = useId();
  return (
    <div className="choice-row">
      <span className="choice-row-label" id={labelId}>
        {props.label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId}>
        {props.options.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={props.value === value} onClick={() => props.onChange(value)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Top-right of the map: the layers button and its card (Map layer, Time of day, Distances, Rail
 * network, Real tracks), zoom, undo / redo, fit whole route.
 */
export function MapControls(props: MapControlsProps): ReactElement {
  const { layers, onLayers } = props;
  const [open, setOpen] = useState(false);
  const summary = `${BASEMAPS[layers.basemap]} · ${LIGHT_WORDS[props.look.phase]}${layers.tracks ? " + tracks" : ""}`;

  return (
    <div className="map-controls">
      <div className="glass ctl-group">
        <button type="button" className="map-btn" aria-expanded={open} aria-label={`Map layers: ${summary}`} onClick={() => setOpen(!open)}>
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 3l7 4-7 4-7-4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M3 11l7 4 7-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="glass layers-card">
          <ChoiceRow label="Map layer" options={Object.entries(BASEMAPS) as [BasemapKind, string][]} value={layers.basemap} onChange={(basemap) => onLayers({ ...layers, basemap })} />
          <ChoiceRow label="Time of day" options={LIGHTS} value={layers.light} onChange={(light) => onLayers({ ...layers, light })} />
          <ChoiceRow label="Distances" options={UNITS} value={props.unit} onChange={props.onUnit} />
          <div className="chips">
            <label className="chip">
              <input type="checkbox" checked={layers.network} onChange={(e) => onLayers({ ...layers, network: e.target.checked })} />
              Rail network
            </label>
            <label className="chip" title="OpenStreetMap rail lines, with routes drawn along the track">
              <input type="checkbox" checked={layers.tracks} onChange={(e) => onLayers({ ...layers, tracks: e.target.checked })} />
              Real tracks
            </label>
          </div>
        </div>
      )}
      <div className="glass ctl-group ctl-group--zoom">
        <button type="button" className="map-btn" aria-label="Zoom in" onClick={() => props.onZoom(1)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="map-btn" aria-label="Zoom out" onClick={() => props.onZoom(-1)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {props.history && (
        <div className="glass ctl-group">
          <button type="button" className="map-btn" aria-label="Undo route change" disabled={!props.history.undo} onClick={() => props.history?.undo?.()}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M7 4L3 8l4 4M3 8h8a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="map-btn" aria-label="Redo route change" disabled={!props.history.redo} onClick={() => props.history?.redo?.()}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M11 4l4 4-4 4M15 8H7a4 4 0 0 0 0 8h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      <div className="glass ctl-group">
        <button type="button" className="map-btn" aria-label="Fit whole route" onClick={props.onFit}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
