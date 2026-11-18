/**
 * Where a place found with the search box (./MapSearch.tsx) is: a pin, and a card with the place, what
 * it is, the railroads there, and what the screen can do with it (the planner's "Set as start", …).
 */
import { useRef, type ReactElement } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { PlaceSuggestion, ResolvedPlace } from "../../shared/places.ts";
import { Cross } from "../ui/icons.tsx";
import { PLACE_SOURCE_WORDS } from "../words.ts";
import { Railroads } from "./MapSearch.tsx";
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
  const card = useRef<HTMLElement>(null);
  // A click anywhere on the card stays on the card: on the map it would place a point there.
  useNativeClick(card, () => {});
  return (
    <Marker longitude={place.lon} latitude={place.lat} anchor="center" className="found-pin">
      <span className="found-dot" aria-hidden="true" />
      <section ref={card} className="glass map-card found-card" aria-label={`Found: ${chosen.label}`}>
        <div className="found-head">
          <strong>{chosen.label}</strong>
          <CardButton label="Close" className="icon-btn" onPress={props.onClose}>
            <Cross />
          </CardButton>
        </div>
        <span className="search-line found-sub">
          <span>{PLACE_SOURCE_WORDS[chosen.source]}</span>
          <Railroads place={place} />
        </span>
        {props.actions.length > 0 && (
          <div className="found-actions">
            {props.actions.map((action) => (
              <CardButton
                key={action.label}
                label={action.label}
                className="btn"
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
