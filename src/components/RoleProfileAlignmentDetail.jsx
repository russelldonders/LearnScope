import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { LEVEL_LABELS } from '../lib/levels'

// Badge + expandable alignment detail for a timeline entry that a role
// profile assignment auto-created (decide_employer_role_assignment,
// 20260912120000) -- embedded inside TimelineItem rather than the
// standalone card RoleAlignmentSummary used to render in its own section at
// the bottom of the Experience page. Every click target here stops
// propagation: TimelineItem's whole card is itself a click-to-edit button,
// so without that, expanding this or disconnecting would also open the
// edit-experience modal underneath it.
export default function RoleProfileAlignmentDetail({ employerName, roleProfileName, aligned, gaps, training, disconnecting = false, onDisconnect }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Stops every click (and Enter/Space keydown) from reaching TimelineItem's
  // own card, which is itself one big click-to-edit button -- otherwise
  // expanding this, or confirming a disconnect in the dialog below (still
  // inside this same wrapper in the React tree, portal or not: React's
  // synthetic events bubble through the component tree, not the raw DOM),
  // would also pop open the edit-experience modal underneath it.
  function stop(e) {
    e.stopPropagation()
  }

  return (
    <div className="mt-3 pt-3 border-t border-hairline" onClick={stop} onKeyDown={stop}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-moss border border-moss/40 rounded-full px-2 py-0.5">
          Linked to {employerName}'s {roleProfileName} role profile
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-secondary hover:text-ink"
        >
          {expanded ? 'Hide alignment' : `${aligned.length}/${aligned.length + gaps.length} skills met`}
          {training.length > 0 && !expanded && ` · ${training.filter((t) => t.completed).length}/${training.length} training complete`}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-ink mb-1">Aligned ({aligned.length})</p>
            {aligned.length === 0 ? (
              <p className="text-xs text-secondary">No requirements met yet.</p>
            ) : (
              <ul className="text-xs text-ink space-y-0.5">
                {aligned.map((skill) => (
                  <li key={skill.skillId}>
                    {skill.name} -- at {LEVEL_LABELS[skill.learnerLevel] ?? skill.learnerLevel}, requires{' '}
                    {LEVEL_LABELS[skill.targetLevel] ?? skill.targetLevel}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-ink mb-1">Gaps ({gaps.length})</p>
            {gaps.length === 0 ? (
              <p className="text-xs text-secondary">No gaps -- every required skill is met.</p>
            ) : (
              <ul className="text-xs text-ink space-y-0.5">
                {gaps.map((skill) => (
                  <li key={skill.skillId}>
                    {skill.name} -- requires {LEVEL_LABELS[skill.targetLevel] ?? skill.targetLevel}
                    {skill.learnerLevel !== null
                      ? `, you're at ${LEVEL_LABELS[skill.learnerLevel] ?? skill.learnerLevel}`
                      : ", you haven't tracked this skill yet"}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {training.length > 0 && (
            <div>
              <p className="text-xs font-medium text-ink mb-1">Employer training</p>
              <ul className="text-xs text-ink space-y-0.5">
                {training.map((item) => (
                  <li key={item.courseId}>
                    {item.title} <span className="text-secondary">({item.completed ? 'Completed' : 'Not completed'})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="text-xs font-medium text-red-700 hover:underline"
          >
            Disconnect role profile
          </button>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          message={`Disconnect from ${roleProfileName}? You'll stop seeing this alignment view. This experience entry stays exactly as it is -- nothing is deleted.`}
          confirmLabel="Disconnect"
          confirming={disconnecting}
          onConfirm={() => onDisconnect?.()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
