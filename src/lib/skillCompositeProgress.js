export function calculateCompositeCoverage(components) {
  const totalWeight = components.reduce((sum, component) => sum + component.contributionWeight, 0)
  const earnedWeight = components.reduce(
    (sum, component) =>
      sum + component.contributionWeight * (
        component.progressRatio ?? Math.min((component.currentLevel ?? 0) / component.targetLevel, 1)
      ),
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

export function buildCompositeProgress(definitions, parentSkillId, trackedSkillsByLibraryId = new Map()) {
  const definitionsByParentId = new Map(definitions.map((definition) => [definition.parentSkillId, definition]))

  function build(currentParentId, ancestors = new Set()) {
    const definition = definitionsByParentId.get(currentParentId)
    if (!definition || ancestors.has(currentParentId)) return null
    const nextAncestors = new Set(ancestors).add(currentParentId)

    const components = definition.components.map((component) => {
      const tracked = trackedSkillsByLibraryId.get(component.librarySkillId) ?? null
      const childComposite = build(component.librarySkillId, nextAncestors)
      const directRatio = Math.min((tracked?.currentLevel ?? 0) / component.targetLevel, 1)
      const nestedRatio = childComposite ? childComposite.coverage.percentage / 100 : 0
      const nestedTargetMet = Boolean(
        childComposite && childComposite.coverage.percentage === 100 && childComposite.coverage.allRequiredMet
      )

      return {
        ...component,
        trackedSkillId: tracked?.trackedSkillId ?? null,
        lifecycleStage: tracked?.lifecycleStage ?? null,
        currentLevel: tracked?.currentLevel ?? null,
        childComposite,
        progressRatio: Math.max(directRatio, nestedRatio),
        targetMet: directRatio >= 1 || nestedTargetMet,
      }
    })

    return {
      id: definition.id,
      parentSkillId: currentParentId,
      version: definition.version,
      publishedAt: definition.publishedAt,
      components,
      coverage: calculateCompositeCoverage(components),
    }
  }

  return build(parentSkillId)
}
