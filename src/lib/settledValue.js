// One result from Promise.allSettled: its value when it succeeded, else the
// fallback, so a page stays usable when an optional query fails.
export function settledValue(results, index, fallback) {
  return results[index].status === 'fulfilled' ? results[index].value : fallback
}
