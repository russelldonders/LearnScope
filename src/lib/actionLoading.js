export async function loadActionSources(sources) {
  const results = await Promise.allSettled(sources.map(({ load }) => load()))

  return results.reduce(
    (outcome, result, index) => {
      const source = sources[index]
      if (result.status === 'fulfilled') {
        outcome.values[source.key] = result.value
      } else {
        outcome.values[source.key] = source.fallback
        outcome.failures.push({ key: source.key, label: source.label, error: result.reason })
      }
      return outcome
    },
    { values: {}, failures: [] }
  )
}
