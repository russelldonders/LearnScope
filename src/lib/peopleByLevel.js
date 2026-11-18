// Lists of people who have a skill -- your connections on a skill's Network
// tab, and Find an expert -- ordered and filtered by how good they are at it,
// the same way in both places.

// More people than this and a level filter is offered; with fewer, the whole
// list fits at a glance.
export const LEVEL_FILTER_THRESHOLD = 5

// "Skilled or above" rather than exactly one level: someone looking for an
// expert is happy with anyone at least that good. No level means not known to
// be that good, so they drop out once a level is chosen. 0 keeps everyone.
export function atLeastLevel(people, minLevel, levelOf = (person) => person.level) {
  if (!minLevel) return people
  return people.filter((person) => levelOf(person) != null && levelOf(person) >= minLevel)
}

// Experts first: highest level down, people with no level last, then by name.
export function sortByLevel(people, levelOf = (person) => person.level, nameOf = (person) => person.name) {
  return [...people].sort((a, b) => {
    const levelA = levelOf(a) ?? -1
    const levelB = levelOf(b) ?? -1
    if (levelA !== levelB) return levelB - levelA
    return String(nameOf(a) ?? '').localeCompare(String(nameOf(b) ?? ''), undefined, { sensitivity: 'base' })
  })
}
