// The course-page equivalent of skillNextAction.js's computeUpNextItems --
// same idea (a pure, deterministic checklist of what's worth doing next),
// scaled down to a course's much simpler lifecycle (in progress vs.
// completed) rather than a full multi-stage journey.
export function computeCourseUpNextItems({ course, skillLinksCount, achievementsCount, statementsCount }) {
  const items = [
    {
      key: 'link-skills',
      label: 'Link the skills this develops',
      description: 'Connect this course to the skills it builds or applies.',
      done: skillLinksCount > 0,
    },
  ]

  if (!course.completed_date) {
    items.push({
      key: 'log-activity',
      label: 'Log an activity',
      description: 'Record something you did as part of this course.',
      done: statementsCount > 0,
    })
    items.push({
      key: 'finish',
      label: 'Mark as finished',
      description: 'Once complete, this updates your course history.',
      done: false,
    })
  } else if (achievementsCount === 0) {
    items.push({
      key: 'record-achievement',
      label: 'Record what you achieved',
      description: 'Capture the level this course helped you reach, with evidence.',
      done: false,
    })
  }

  return items
}
