/**
 * A choice the viewer makes that this browser keeps (localStorage): read back on the next visit, and
 * every part of the page that shows it follows a change at once. While the browser refuses storage
 * (blocked site data, some private windows) the choice holds for this page until it closes.
 */
import { useSyncExternalStore } from "react";

/** A hook for one stored choice: its value (one of `choices`, else `fallback()`) and the setter. */
export function storedChoice<T extends string>(key: string, choices: readonly T[], fallback: () => T): () => [T, (choice: T) => void] {
  const listeners = new Set<() => void>();
  let unsaved: T | null = null;

  const read = (): T => {
    try {
      const saved = localStorage.getItem(key);
      return choices.find((choice) => choice === saved) ?? fallback();
    } catch {
      return unsaved ?? fallback();
    }
  };
  const choose = (choice: T): void => {
    try {
      localStorage.setItem(key, choice);
    } catch {
      unsaved = choice;
    }
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return () => [useSyncExternalStore(subscribe, read, fallback), choose];
}
