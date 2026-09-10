/**
 * Runs tasks with a ceiling on in-flight work.
 *
 * Role-permission lookups are one call per role, so a large group would
 * otherwise open dozens of sockets against the upstream API at once.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  task: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<TOut>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // Bounds-checked by the loop condition; the assertion satisfies
      // noUncheckedIndexedAccess without a runtime cost.
      results[index] = await task(items[index] as TIn, index);
    }
  });

  await Promise.all(workers);
  return results;
}
