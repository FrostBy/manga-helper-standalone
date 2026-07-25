/**
 * Creates a promise-chained lock to serialize async operations.
 * Used by storage namespaces to prevent concurrent read-modify-write races within a single tab.
 * Cross-tab writes are still non-atomic — rare in practice (one tab at a time).
 */
export function createLock() {
  let chain: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.catch(() => {}).then(fn);
    chain = result.then(() => {}, () => {});
    return result;
  };
}
