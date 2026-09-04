export function calculateCompositeCoverage(components) {
  const totalWeight = components.reduce((sum, component) => sum + component.contributionWeight, 0)
  const earnedWeight = components.reduce(
    (sum, component) =>
      sum + component.contributionWeight * Math.min((component.currentLevel ?? 0) / component.targetLevel, 1),
    0
  )
  const required = components.filter((component) => component.isRequired)
  const requiredMet = required.filter((component) => component.targetMet).length

  return {
    percentage: totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0,
    requiredMet,
    requiredTotal: required.length,
    allRequiredMet: required.length === 0 || requiredMet === required.length,
  }
}
