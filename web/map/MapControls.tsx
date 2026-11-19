import { useEffect, useId, useRef, useSyncExternalStore, type ReactElement, type RefObject } from "react";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import { lineColor } from "../theme.ts";
import { Fullscreen, Home, Layers, Minus, Plus } from "../ui/icons.tsx";
import { usePopover } from "../ui/popover.ts";
import { thumbAt } from "../ui/segmented.ts";
import { Switch } from "../ui/Switch.tsx";
import { DISTANCE_UNITS, useDistanceUnit, type DistanceUnit } from "../units.ts";
import type { BasemapKind } from "./basemaps.ts";
import type { LightMode, LightPhase, MapLook } from "./daylight.ts";
import type { MapLayerChoice } from "./MapCanvas.tsx";

interface MapControlsProps {
  layers: MapLayerChoice;
  onLayers: (next: MapLayerChoice) => void;
  /** What Auto shows now, for the Layers button's name. */
  look: MapLook;
  /** The carrier the pointer rests on in the Carriers list, previewed on the map; null when none. */
  onPreview: (carrier: Railroad | null) => void;
  onZoom: (step: 1 | -1) => void;
  /** Frames the whole network. */
  onReset: () => void;
}

/** Each choice and its word, in the order shown. */
const BASEMAPS: Record<BasemapKind, string> = { map: "Map", satellite: "Satellite" };
const LIGHTS: Record<LightMode, string> = { auto: "Auto", day: "Day", night: "Night" };
const UNITS = Object.fromEntries(DISTANCE_UNITS.map((unit) => [unit, unit])) as Record<DistanceUnit, string>;
const LIGHT_WORDS: Record<LightPhase, string> = { day: "Day", sunrise: "Sunrise", sunset: "Sunset", night: "Night" };

const onFullscreenChange = (listener: () => void) => {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
};

/** Whether the page fills the screen; the browser's own Escape leaves it as well. */
const useFullscreen = () => useSyncExternalStore(onFullscreenChange, () => document.fullscreenElement !== null, () => false);

function toggleFullscreen(): void {
  // A browser that refuses (a frame without the permission) leaves the page as it is.
  const change = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  change.catch(() => {});
}

/** One setting of the Layers card: its name over a segmented choice. */
function ChoiceRow<T extends string>(props: { label: string; options: Record<T, string>; value: T; onChange: (value: T) => void }): ReactElement {
  const labelId = useId();
  const choices = Object.entries(props.options) as [T, string][];
  return (
    <div className="choice-row">
      <span className="layers-label" id={labelId}>
        {props.label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId} style={thumbAt(choices.length, choices.findIndex(([value]) => value === props.value))}>
        {choices.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={props.value === value} onClick={() => props.onChange(value)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The carriers' colours, and the filter: a row shows its carrier alone on the map; again, or Show all, shows them all. */
function Carriers(props: { carrier: Railroad | null; onCarrier: (carrier: Railroad | null) => void; onPreview: (carrier: Railroad | null) => void }): ReactElement {
  const { carrier, onCarrier, onPreview } = props;
  const labelId = useId();
  return (
    <div className="layers-list" role="group" aria-labelledby={labelId} data-filtered={carrier ? "" : undefined}>
      <div className="carriers-head">
        <span className="layers-label grow" id={labelId}>
          Carriers
        </span>
        <button type="button" className="show-all" hidden={!carrier} onClick={() => onCarrier(null)}>
          Show all
        </button>
      </div>
      {RAILROADS.map((railroad) => {
        const only = carrier === railroad;
        return (
          <button
            key={railroad}
            type="button"
            className="carrier-row"
            aria-pressed={only}
            // The click's own result shows at once, without the preview of the row under the pointer.
            onClick={() => {
              onPreview(null);
              onCarrier(only ? null : railroad);
            }}
            onPointerEnter={() => onPreview(railroad)}
            onPointerLeave={() => onPreview(null)}
          >
            <span className="carrier-line" style={{ background: lineColor(railroad) }} aria-hidden="true" />
            <span className="grow">{railroad}</span>
            {only && <span className="carrier-only">Only</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The Layers popover, left of its button: Carriers, Basemap, Time of day, Units, Overlays. */
function LayersCard(props: { box: RefObject<HTMLDivElement>; layers: MapLayerChoice; onLayers: (next: MapLayerChoice) => void; onPreview: (carrier: Railroad | null) => void }): ReactElement {
  const { layers, onLayers, onPreview } = props;
  const [unit, setUnit] = useDistanceUnit();
  const overlaysId = useId();
  // A card that closes under the pointer takes its preview with it.
  useEffect(() => () => onPreview(null), [onPreview]);
  return (
    <div className="glass layers-card" role="dialog" aria-label="Layers" ref={props.box}>
      <Carriers carrier={layers.carrier} onCarrier={(carrier) => onLayers({ ...layers, carrier })} onPreview={onPreview} />
      <ChoiceRow label="Basemap" options={BASEMAPS} value={layers.basemap} onChange={(basemap) => onLayers({ ...layers, basemap })} />
      <ChoiceRow label="Time of day" options={LIGHTS} value={layers.light} onChange={(light) => onLayers({ ...layers, light })} />
      <ChoiceRow label="Units" options={UNITS} value={unit} onChange={setUnit} />
      <div className="layers-list" role="group" aria-labelledby={overlaysId}>
        <span className="layers-label" id={overlaysId}>
          Overlays
        </span>
        <Switch label="Rail network" on={layers.network} onChange={(network) => onLayers({ ...layers, network })} />
        <Switch label="Real tracks" title="OpenStreetMap rail lines, with routes drawn along the track" on={layers.tracks} onChange={(tracks) => onLayers({ ...layers, tracks })} />
      </div>
    </div>
  );
}

/** Top right of the map, one column: Layers (and its popover), zoom, Reset view, Fullscreen. */
export function MapControls(props: MapControlsProps): ReactElement {
  const { layers } = props;
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePopover([button, card]);
  const fullscreen = useFullscreen();
  const summary = `${BASEMAPS[layers.basemap]} · ${LIGHT_WORDS[props.look.phase]}${layers.tracks ? " + tracks" : ""}${layers.carrier ? ` · ${layers.carrier} only` : ""}`;

  return (
    <div className="map-controls">
      <button
        type="button"
        ref={button}
        className="glass map-btn"
        aria-expanded={open}
        aria-label={`Map layers: ${summary}`}
        data-filtered={layers.carrier ? "" : undefined}
        onClick={() => setOpen(!open)}
      >
        <Layers />
        <span className="layers-badge" aria-hidden="true" />
      </button>
      {open && <LayersCard box={card} layers={layers} onLayers={props.onLayers} onPreview={props.onPreview} />}
      <div className="glass ctl-group ctl-group--zoom">
        <button type="button" className="map-btn" aria-label="Zoom in" onClick={() => props.onZoom(1)}>
          <Plus />
        </button>
        <button type="button" className="map-btn" aria-label="Zoom out" onClick={() => props.onZoom(-1)}>
          <Minus />
        </button>
      </div>
      <button type="button" className="glass map-btn" aria-label="Reset view to the whole network" onClick={props.onReset}>
        <Home />
      </button>
      {document.fullscreenEnabled && (
        <button type="button" className="glass map-btn" aria-label="Fullscreen" aria-pressed={fullscreen} onClick={toggleFullscreen}>
          <Fullscreen />
        </button>
      )}
    </div>
  );
}
