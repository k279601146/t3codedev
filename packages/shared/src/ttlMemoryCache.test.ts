import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { createTtlMemoryCache } from "./ttlMemoryCache.ts";

describe("ttlMemoryCache", () => {
  it("returns cached values until their TTL expires", () => {
    const cache = createTtlMemoryCache();
    cache.write("models", ["gpt-5.4"], 100, 1_000);

    assert.deepEqual(cache.read("models", 1_099), ["gpt-5.4"]);
    assert.equal(cache.read("models", 1_100), undefined);
  });

  it("evicts the oldest entries when the cache reaches capacity", () => {
    const cache = createTtlMemoryCache({ maxEntries: 2 });
    cache.write("a", 1, 1_000, 0);
    cache.write("b", 2, 1_000, 0);
    cache.write("c", 3, 1_000, 0);

    assert.equal(cache.read("a", 1), undefined);
    assert.equal(cache.read("b", 1), 2);
    assert.equal(cache.read("c", 1), 3);
  });
});
