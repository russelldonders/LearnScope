// The single source of truth for "what's the recommended next step for this
// skill, given its lifecycle stage and what's already been done" -- used by
// the skill page's own Up Next checklist and by the dashboard's cross-skill
// Up Next panel, so the two never drift into disagreeing about priority.
// Returns an ordered list; each entry's `done` reflects whether that step
// has already happened, but the list itself doesn't filter completed items
// out -- callers decide whether they want the full checklist or just the
// first thing still undone.
export function computeUpNextItems({
  stage,
  selfAssessedCount,
  peerRatingsCount,
  statementsCount,
  quizCount,
  courseLinks,
  hasTarget,
  hasPendingExpertValidation,
}) {
  if (stage === 'identified') {
    // Self-assessing first gives every other diagnostic something to react
    // to, so the other-perspective steps (peer ratings, the AI quiz, and
    // any future diagnostic added here) stay locked until it's done.
    const hasSelfAssessed = selfAssessedCount > 0
    return [
      {
        key: 'self-assess',
        label: 'Self-assess your own level',
        description: 'Rate where you think you are right now.',
        done: hasSelfAssessed,
      },
      {
        key: 'invite',
        label: 'Invite others to assess your skill',
        description: 'Get an outside perspective on your level.',
        done: peerRatingsCount > 0,
        locked: !hasSelfAssessed,
        lockedReason: 'Self-assess your own level first.',
      },
      {
        key: 'quiz',
        label: 'Ask me questions to assess me',
        description: 'Answer a short AI-generated quiz on your baseline knowledge.',
        done: quizCount > 0,
        locked: !hasSelfAssessed,
        lockedReason: 'Self-assess your own level first.',
      },
      {
        key: 'activity',
        label: 'Record an activity',
        description: 'Log something you did that shows this skill in action.',
        done: statementsCount > 0,
      },
    ]
  }

  if (stage === 'baseline_assessed') {
    return [
      {
        key: 'target',
        label: 'Set a target',
        description: 'Choose a level and date you are aiming to reach next.',
        done: false,
      },
    ]
  }

  if (stage === 'target_set') {
    // "Find a course" leads while nothing is currently in progress; once at
    // least one course has ever been completed for this skill, moving on to
    // demonstrating it becomes an option too (in addition to, not instead
    // of, finding further training).
    const hasPendingCourse = (courseLinks ?? []).some((link) => link.courses && !link.courses.completed_date)
    const hasCompletedCourse = (courseLinks ?? []).some((link) => link.courses?.completed_date)
    const items = []
    if (!hasPendingCourse) {
      items.push({
        key: 'find-course',
        label: 'Find a course',
        description: 'Browse the training catalogue for something that fits your target.',
        done: false,
      })
    }
    if (hasCompletedCourse) {
      items.push({
        key: 'demonstrate',
        label: 'Demonstrate Skill',
        description: 'Move on to actively demonstrating this skill once you feel ready.',
        done: false,
      })
    }
    return items
  }

  if (stage === 'developing') {
    return [
      {
        key: 'record-activity',
        label: 'Record activity',
        description: 'Log something that shows you demonstrating this skill.',
        done: false,
      },
      {
        key: 'self-assess-demonstrating',
        label: 'Self-assess your own level',
        description: 'Rate where you think you are now.',
        done: selfAssessedCount > 0,
      },
      {
        key: 'invite-demonstrating',
        label: 'Invite others to assess your skill',
        description: 'Get an outside perspective on your level.',
        done: peerRatingsCount > 0,
      },
      {
        key: 'validate',
        label: 'Validate Skill',
        description: 'Move on to validating this skill against your target once you feel ready.',
        done: false,
      },
    ]
  }

  if (stage === 'demonstrated') {
    const items = [
      {
        key: 'invite-validating',
        label: 'Invite others to assess your skill',
        description: 'Get an outside perspective on your level.',
        done: peerRatingsCount > 0,
      },
    ]
    if (hasTarget) {
      items.push({
        key: 'request-validation',
        label: 'Request Validation',
        description: 'Ask someone who has already reached this level to review your evidence.',
        done: hasPendingExpertValidation,
      })
      items.push({
        key: 'ai-assessment',
        label: 'Request AI Assessment',
        description: 'Weigh all your evidence against your target level and get feedback.',
        done: false,
      })
    }
    return items
  }

  return []
}
