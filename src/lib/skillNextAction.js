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
  knowledgeSelfAssessedCount,
  hasKnowledgeLevel,
  peerRatingsCount,
  statementsCount,
  courseLinks,
  hasTarget,
  hasPendingExpertValidation,
}) {
  if (stage === 'identified') {
    // The knowledge axis is established and confirmed first, as its own
    // self-contained round trip through Confirming Baseline -- submitting
    // the knowledge self-assessment immediately leaves this stage, so
    // nothing else here is reachable until that trip is done and the skill
    // is back with a confirmed knowledge_level. Only then does the
    // practical-axis checklist (self-assess, invite, activity, and
    // eventually the AI "Assess Baseline" synthesis) become relevant --
    // none of it touches the knowledge axis.
    if (!hasKnowledgeLevel) {
      return [
        {
          key: 'self-assess-knowledge',
          label: 'Self-assess your knowledge',
          description: "Rate what you already know, in theory -- you'll confirm it with a quiz next.",
          done: (knowledgeSelfAssessedCount ?? 0) > 0,
        },
      ]
    }

    const hasSelfAssessed = selfAssessedCount > 0
    return [
      {
        key: 'self-assess',
        label: 'Self-assess your own level',
        description: 'Rate where you think you are right now, practically.',
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
        key: 'activity',
        label: 'Record an activity',
        description: 'Log something you did that shows this skill in action.',
        done: statementsCount > 0,
      },
    ]
  }

  if (stage === 'confirming_baseline') {
    // A single action that both records the attempt and advances the skill
    // past this stage -- "still in this stage" already implies "not done
    // yet", same as the baseline_assessed stage's `target` item below.
    return [
      {
        key: 'confirm-baseline-quiz',
        label: 'Confirm your knowledge with a quiz',
        description: 'Answer questions pitched at your self-assessed knowledge level to confirm it.',
        done: false,
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
