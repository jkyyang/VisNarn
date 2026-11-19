/**
 * The one search, at the top of the panel: Your shops and cities, grouped. An FRA node id ("FRA 358070")
 * still finds its node; the placeholder leaves it out because it is jargon. "/" anywhere outside a text
 * field puts the cursor in it. What is typed also narrows the Shops list (App passes it on).
 *
 * It asks only our own server (GET /api/places/suggest, the Directory every place input uses).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { PlaceSuggestion } from "../../shared/places.ts";
import { fresh, usePlaceSuggestions } from "../data/hooks.ts";
import { Railroads } from "../ui/badges.tsx";
import { moveActive, SuggestionList } from "../ui/combobox.tsx";
import { Cross, Search } from "../ui/icons.tsx";

/** The groups, in the order shown. */
const GROUPS = ["Shops", "Cities", "Network"] as const;
const groupOf = (suggestion: PlaceSuggestion) => (suggestion.source === "shop" ? "Shops" : suggestion.source === "city" ? "Cities" : "Network");
const byGroup = (list: PlaceSuggestion[]) => GROUPS.flatMap((group) => list.filter((suggestion) => groupOf(suggestion) === group));

const inTextField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The box and its suggestions. `text` is what is typed, null while the box shows `chosen`. Enter takes the
 * highlighted suggestion, else the first; Esc closes the list, and again clears the search.
 */
export function PanelSearch(props: {
  chosen: PlaceSuggestion | null;
  problem: string | null;
  text: string | null;
  onText: (text: string | null) => void;
  onChoose: (suggestion: PlaceSuggestion | null) => void;
}): ReactElement {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const { text } = props;
  const suggestions = usePlaceSuggestions(text ?? "", "shop");
  // A stale list belongs to the text before the last keystroke.
  const list = byGroup((text !== null && open && fresh(suggestions)) || []);
  const listed = list.length > 0;
  const typed = text?.trim() ?? "";
  const nothing = typed && fresh(suggestions)?.length === 0;
  const message = nothing ? `No shop, code or city called “${typed}”.` : props.problem;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || inTextField(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (suggestion: PlaceSuggestion | null) => {
    props.onText(null);
    setActive(-1);
    setOpen(false);
    props.onChoose(suggestion);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (listed && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setActive(moveActive(active, event.key, list.length));
    } else if (event.key === "Enter" && listed) {
      event.preventDefault();
      choose(list[Math.max(active, 0)]);
    } else if (event.key === "Escape") {
      if (text !== null) props.onText(null);
      else choose(null);
      setActive(-1);
    }
  };

  return (
    <div className="panel-search" role="search">
      <div className={`input-box search-field${message && !listed ? " is-wrong" : ""}`} title={(!listed && message) || undefined}>
        <Search />
        <input
          ref={input}
          role="combobox"
          aria-label="Search shops and cities"
          aria-expanded={listed}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listed && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search shops and cities"
          value={text ?? props.chosen?.label ?? ""}
          onChange={(e) => {
            props.onText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        {text || props.chosen ? (
          <button type="button" className="icon-btn" aria-label="Clear the search" onClick={() => choose(null)}>
            <Cross />
          </button>
        ) : (
          <kbd className="key-hint" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      {listed && (
        <SuggestionList
          id={listId}
          label="Places found"
          list={list}
          active={active}
          onChoose={choose}
          groupOf={groupOf}
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
      {/* On screen the field's edge says it, with the reason on hover; screen readers hear it. */}
      {message && !listed && (
        <span className="visually-hidden" role="alert">
          {message}
        </span>
      )}
    </div>
  );
}
