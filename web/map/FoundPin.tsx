/**
 * Where a place found with the search box (./MapSearch.tsx) is: a pin, and a card with the place, what
 * it is, the railroads there, and what the screen can do with it (the planner's "Set as start", …).
 */
import { useRef, type ReactElement } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { PlaceSuggestion, ResolvedPlace } from "../../shared/places.ts";
import { Railroads, TYPE_CHIPS } from "./MapSearch.tsx";
import type { PlaceAction } from "./MapStage.tsx";
import { useNativeClick } from "./RouteMarkFaces.tsx";

/** A button on the map whose click must not also land on the map below it (see useNativeClick). */
function CardButton(props: { label: string; className: string; onPress: () => void; children?: ReactElement }): ReactElement {
  const ref = useRef<HTMLButtonElement>(null);
  useNativeClick(ref, props.onPress);
  return (
    <button ref={ref} type="button" className={props.className} aria-label={props.children ? props.label : undefined}>
      {props.children ?? props.label}
    </button>
  );
}

/** The pin where a found place is, and its card. Must be a child of the map. */
export function FoundPin(props: { chosen: PlaceSuggestion; place: ResolvedPlace; actions: PlaceAction[]; onClose: () => void }): ReactElement {
  const { chosen, place } = props;
  return (
    <Marker longitude={place.lon} latitude={place.lat} anchor="center" className="found-pin">
      <span className="found-dot" aria-hidden="true" />
      <section className="map-card found-card" aria-label={`Found: ${chosen.label}`}>
        <div className="found-head">
          <strong>{chosen.label}</strong>
          <span className="type-chip">{TYPE_CHIPS[chosen.source]}</span>
          <CardButton label="Close" className="icon-btn small" onPress={props.onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </CardButton>
        </div>
        <Railroads place={place} />
        {props.actions.length > 0 && (
          <div className="found-actions">
            {props.actions.map((action) => (
              <CardButton
                key={action.label}
                label={action.label}
                className="btn btn--small"
                onPress={() => {
                  action.run(place);
                  props.onClose();
                }}
              />
            ))}
          </div>
        )}
      </section>
    </Marker>
  );
}
