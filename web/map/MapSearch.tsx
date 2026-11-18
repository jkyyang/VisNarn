/**
 * The search box over the map, as in a maps app: Your shops, cities, company codes and "FRA 358070".
 * Choosing a suggestion flies the map there and drops a pin with a card (./FoundPin.tsx). Plain DOM,
 * no map library, so page tests draw it.
 *
 * It asks only our own server (GET /api/places/suggest, the Directory every place input uses), so
 * nothing typed here leaves the laptop.
 */
import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import type { PlaceSuggestion, ResolvedPlace } from "../../shared/places.ts";
import { usePlaceSuggestions } from "../data/hooks.ts";
import { RailroadChip } from "../ui/badges.tsx";

export const TYPE_CHIPS: Record<PlaceSuggestion["source"], string> = { shop: "Shop", code: "Code", city: "City", yard: "Yard", junction: "Junction", node: "Node" };

/** The highlighted row after ↓ or ↑, going round the list; with none highlighted, ↓ takes the first and ↑ the last. */
export function moveActive(active: number, key: "ArrowDown" | "ArrowUp", count: number): number {
  if (count === 0) return -1;
  const step = key === "ArrowDown" ? 1 : -1;
  return active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count;
}

export function Railroads({ place }: { place: Pick<ResolvedPlace, "railroads"> }): ReactElement {
  return place.railroads.length ? (
    <span className="search-rr">
      {place.railroads.map((railroad) => (
        <RailroadChip key={railroad} railroad={railroad} />
      ))}
    </span>
  ) : (
    <span className="muted small">No Class I track</span>
  );
}

/**
 * The box and its suggestions. `chosen` shows in the box until the person types again; Enter takes the
 * highlighted suggestion, else the first; Esc closes the list, and again clears the search.
 */
export function MapSearch(props: { chosen: PlaceSuggestion | null; problem: string | null; onChoose: (suggestion: PlaceSuggestion | null) => void }): ReactElement {
  const listId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const suggestions = usePlaceSuggestions(draft ?? "", "shop");
  // A stale list belongs to the text before the last keystroke.
  const list = draft !== null && suggestions.status === "ready" && !suggestions.stale ? suggestions.data : [];
  const open = list.length > 0;

  const choose = (suggestion: PlaceSuggestion | null) => {
    setDraft(null);
    setActive(-1);
    props.onChoose(suggestion);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive(moveActive(active, event.key, list.length));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(list[Math.max(active, 0)]);
    } else if (event.key === "Escape") {
      if (draft !== null) setDraft(null);
      else choose(null);
      setActive(-1);
    }
  };

  return (
    <div className="map-search" role="search">
      <div className="map-search-box">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M11.5 11.5l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          role="combobox"
          aria-label="Search the map"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search shops, cities, FRA 358070"
          value={draft ?? props.chosen?.label ?? ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setDraft(null)}
        />
        {(draft || props.chosen) && (
          <button type="button" className="icon-btn small" aria-label="Clear the search" onClick={() => choose(null)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <ul className="suggestions" role="listbox" id={listId} aria-label="Places found">
          {list.map((suggestion, i) => (
            <li
              key={`${suggestion.source}-${suggestion.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(suggestion);
              }}
            >
              <span className="search-name">{suggestion.label}</span>
              <span className="type-chip">{TYPE_CHIPS[suggestion.source]}</span>
              <Railroads place={suggestion} />
            </li>
          ))}
        </ul>
      )}
      {props.problem && !open && <p className="map-search-problem">{props.problem}</p>}
    </div>
  );
}
