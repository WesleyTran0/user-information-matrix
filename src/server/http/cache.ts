/**
 * TTL cache with single-flight semantics.
 *
 * Single-flight matters more than the TTL here: the UI can ask for several
 * groups at once and those groups share roles, so without de-duplication the
 * same /data/rolePermissions/... call would go out many times in parallel.
 */
export class TtlCache<TValue> {
  readonly #ttlMs: number;
  readonly #entries = new Map<string, { value: TValue; expiresAt: number }>();
  readonly #inFlight = new Map<string, Promise<TValue>>();

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
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
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
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
