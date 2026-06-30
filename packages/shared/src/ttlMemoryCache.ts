interface TtlMemoryCacheEntry {
  readonly expiresAtMs: number;
  readonly value: unknown;
}

export interface TtlMemoryCache {
  readonly read: <T>(key: string, nowMs: number) => T | undefined;
  readonly write: <T>(key: string, value: T, ttlMs: number, nowMs: number) => void;
  readonly clear: () => void;
}

export function createTtlMemoryCache(options?: { readonly maxEntries?: number }): TtlMemoryCache {
  const maxEntries = Math.max(1, options?.maxEntries ?? 128);
  const entries = new Map<string, TtlMemoryCacheEntry>();

  const prune = (nowMs: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) {
        entries.delete(key);
      }
    }

    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) return;
      entries.delete(oldestKey);
    }
  };

  return {
    read: <T>(key: string, nowMs: number) => {
      const cached = entries.get(key);
      if (!cached) return undefined;
      if (cached.expiresAtMs <= nowMs) {
        entries.delete(key);
        return undefined;
      }
      return cached.value as T;
    },
    write: <T>(key: string, value: T, ttlMs: number, nowMs: number) => {
      prune(nowMs);
      entries.set(key, {
        value,
        expiresAtMs: nowMs + ttlMs,
      });
      prune(nowMs);
    },
    clear: () => {
      entries.clear();
    },
  };
}
