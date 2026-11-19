/**
 * The carrier the Layers popover shows on the map: `isolated` by a click on its row, `hovered` while the
 * pointer is on a row. The map draws that carrier's lines in its colour and fades the rest; empty, every
 * line is neutral. One map, one filter: a small store any component can read and set.
 */
import { useSyncExternalStore } from "react";
import type { Railroad } from "../../shared/railroads.ts";

export interface CarrierFilter {
  isolated?: Railroad;
  hovered?: Railroad;
}

let carrierFilter: CarrierFilter = {};
const listeners = new Set<() => void>();

export function setCarrierFilter(next: CarrierFilter): void {
  carrierFilter = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useCarrierFilter = (): CarrierFilter => useSyncExternalStore(subscribe, () => carrierFilter);

/** The carrier drawn in colour: a hover previews its row, else the one isolated. */
export const shownCarrier = (filter: CarrierFilter): Railroad | null => filter.hovered ?? filter.isolated ?? null;
