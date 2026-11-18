/**
 * The search box over the map, as in a maps app: Your shops and cities. An FRA node id ("FRA 358070")
 * still finds its node; the placeholder leaves it out because it is jargon and clips on a phone.
 * Choosing a suggestion flies the map there and drops a pin with a card (./FoundPin.tsx). Plain DOM,
 * no map library, so page tests draw it.
 *
 * It asks only our own server (GET /api/places/suggest, the Directory every place input uses).
 */
import { useId, useState, type KeyboardEvent, type ReactElement } from "react";
import type { PlaceSuggestion, ResolvedPlace } from "../../shared/places.ts";
import { fresh, usePlaceSuggestions } from "../data/hooks.ts";
import { RailroadChips } from "../ui/badges.tsx";
import { moveActive, SuggestionList } from "../ui/combobox.tsx";
import { Cross, Search } from "../ui/icons.tsx";

export function Railroads({ place }: { place: Pick<ResolvedPlace, "railroads"> }): ReactElement {
  return place.railroads.length ? <RailroadChips railroads={place.railroads} /> : <span>No Class I track</span>;
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
  const list = (draft !== null && fresh(suggestions)) || [];
  const open = list.length > 0;
  const typed = draft?.trim() ?? "";
  const nothing = typed && fresh(suggestions)?.length === 0;
  const message = nothing ? `No shop, code or city called “${typed}”.` : props.problem;

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
      <div className="glass input-box map-search-box">
        <Search size={18} />
        <input
          role="combobox"
          aria-label="Search the map"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search shops and cities"
          value={draft ?? props.chosen?.label ?? ""}
          onChange={(e) => {
            setDraft(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setDraft(null)}
        />
        {(draft || props.chosen) && (
          <button type="button" className="icon-btn" aria-label="Clear the search" onClick={() => choose(null)}>
            <Cross />
          </button>
        )}
      </div>
      {open && (
        <SuggestionList
          id={listId}
          label="Places found"
          list={list}
          active={active}
          onChoose={choose}
          item={(suggestion) => (
            <>
              <span>{suggestion.label}</span>
              {/* "City", "Your shop · EX-KCY-01", "FRA node 358070", then the railroads there. */}
              <span className="search-line muted small">
                <span>{suggestion.detail}</span>
                <Railroads place={suggestion} />
              </span>
            </>
          )}
        />
      )}
      {message && !open && <p className="glass map-search-problem">{message}</p>}
    </div>
  );
}
