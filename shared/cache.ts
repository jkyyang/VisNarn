/**
 * A bounded least-recently-used cache, for every cache in the app (page and server).
 *
 * Bounded by entry count, and also by size when `sizeOf` is given (bytes, points, whatever the
 * caller counts). Over a bound, the least recently used entries go first.
 */
export interface CacheLimits<V> {
  maxEntries: number;
  /** With `sizeOf`: the most the values may add up to. */
  maxSize?: number;
  sizeOf?: (value: V) => number;
}

export interface Cache<K, V> {
  /** The value, which becomes the most recently used; undefined when absent. */
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
  values(): IterableIterator<V>;
  readonly size: number;
}

export function createCache<K, V>(limits: CacheLimits<V>): Cache<K, V> {
  const { maxEntries, maxSize = Infinity, sizeOf = () => 0 } = limits;
  /** Least recently used first: a Map keeps insertion order, and a use inserts again. */
  const entries = new Map<K, { value: V; size: number }>();
  let total = 0;

  const remove = (key: K): boolean => {
    const entry = entries.get(key);
    if (!entry) return false;
    entries.delete(key);
    total -= entry.size;
    return true;
  };

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      remove(key);
      const size = sizeOf(value);
      entries.set(key, { value, size });
      total += size;
      // The newest value stays even when it alone is over maxSize.
      for (const oldest of entries.keys()) {
        if ((entries.size <= maxEntries && total <= maxSize) || oldest === key) break;
        remove(oldest);
      }
    },
    delete: remove,
    clear() {
      entries.clear();
      total = 0;
    },
    *values() {
      for (const entry of entries.values()) yield entry.value;
    },
    get size() {
      return entries.size;
    },
  };
}
