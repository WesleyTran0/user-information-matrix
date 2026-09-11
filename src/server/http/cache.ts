/**
 * TTL cache with single-flight semantics.
 *
 * Single-flight matters more than the TTL here: the UI can ask for several
 * groups at once and those groups share roles, so without de-duplication the
 * same /data/rolePermissions/... call would go out many times in parallel.
 */
export class TtlCache<TValue> {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, { value: TValue; expiresAt: number }>();
  readonly #inFlight = new Map<string, Promise<TValue>>();

  constructor(ttlMs: number, maxEntries = 5_000) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): TValue | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: TValue): void {
    // Re-inserting moves the key to the end, so Map iteration order is
    // oldest-first and can be used for eviction.
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
    this.#evict();
  }

  /**
   * Bounds the cache.
   *
   * Expiry alone does not bound it: an expired entry is only dropped when that
   * same key is read again, so a wide key space (permissions are keyed by role
   * *and* object type) would grow without limit. Expired entries are swept
   * from the oldest end first, and only if that is not enough is a live entry
   * evicted.
   */
  #evict(): void {
    if (this.#entries.size <= this.#maxEntries) return;

    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (this.#entries.size <= this.#maxEntries) return;
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }

    for (const key of this.#entries.keys()) {
      if (this.#entries.size <= this.#maxEntries) return;
      this.#entries.delete(key);
    }
  }

  /** Returns the cached value, the in-flight promise, or starts `load`. */
  async resolve(key: string, load: () => Promise<TValue>): Promise<TValue> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.#inFlight.get(key);
    if (pending !== undefined) return pending;

    const promise = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });

    this.#inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.#entries.clear();
  }
}
