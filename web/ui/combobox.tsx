/**
 * What the three place inputs share: the highlighted row moving with the arrow keys, and the list of
 * suggestions. Each input keeps its own draft and its own Enter, Escape and blur, which differ.
 */
import type { ReactElement, ReactNode } from "react";
import type { PlaceSuggestion } from "../../shared/places.ts";

/** The highlighted row after ↓ or ↑, going round the list; with none highlighted (-1), ↓ takes the first and ↑ the last. */
export function moveActive(active: number, key: "ArrowDown" | "ArrowUp", count: number): number {
  if (count === 0) return -1;
  const step = key === "ArrowDown" ? 1 : -1;
  return active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count;
}

/** The listbox under a combobox. Option ids are `${id}-${i}`, for aria-activedescendant. With `groups`, the list (already in group order) is shown under a heading per group. */
export function SuggestionList(props: {
  id: string;
  label: string;
  list: PlaceSuggestion[];
  active: number;
  onChoose: (suggestion: PlaceSuggestion) => void;
  /** Default: the label, then the detail in muted small text. */
  item?: (suggestion: PlaceSuggestion) => ReactNode;
  /** The heading of the group a suggestion is in. */
  groupOf?: (suggestion: PlaceSuggestion) => string;
}): ReactElement {
  const option = (suggestion: PlaceSuggestion, i: number) => (
    <li
      key={`${suggestion.source}-${suggestion.label}-${i}`}
      id={`${props.id}-${i}`}
      role="option"
      aria-selected={i === props.active}
      onMouseDown={(event) => {
        // The input keeps focus, so its blur does not close the list first.
        event.preventDefault();
        props.onChoose(suggestion);
      }}
    >
      {props.item?.(suggestion) ?? (
        <>
          <span>{suggestion.label}</span>
          <span className="muted small">{suggestion.detail}</span>
        </>
      )}
    </li>
  );
  const { groupOf } = props;
  if (!groupOf) {
    return (
      <ul className="suggestions" role="listbox" id={props.id} aria-label={props.label}>
        {props.list.map(option)}
      </ul>
    );
  }
  const groups = [...new Set(props.list.map(groupOf))];
  return (
    <div className="suggestions" role="listbox" id={props.id} aria-label={props.label}>
      {groups.map((group) => (
        <ul key={group} role="group" aria-label={group}>
          <li role="presentation" className="suggestion-group">
            {group}
          </li>
          {props.list.map((suggestion, i) => (groupOf(suggestion) === group ? option(suggestion, i) : null))}
        </ul>
      ))}
    </div>
  );
}
