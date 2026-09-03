import { useEffect, useMemo, useRef, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import ConfirmDialog from '../../../components/ConfirmDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVEL_LABELS } from '../../../lib/levels'
import { formatAbsoluteDate } from '../../../lib/dates'

// Learner-facing consent panel for a manager-team membership -- mirrors
// ProfilePrivacy.jsx's employer sharing card (summary + "Edit shared
// skills"/"Revoke" pattern) but scoped to a single team membership and kept
// self-contained per the flat prop contract below, rather than delegating
// to a page-level modal-orchestrator.
//
// Deliberately narrow: `availableSkills` is the learner's own skill list
// (the only thing on offer to select from) and `sharedSkillIds` is the
// explicit subset currently shared -- this panel never shows or implies
// access to experience, personal learning history, or anything not on that
// list. `membership` is { id, teamName, managerName, joinedAt }.
// `availableSkills` entries are { id, name, level, evidenceCount }.
//
// `saving`/`error` are owned by the caller, not this component -- there's
// no internal saving/try-catch here. `onSave(skillIds)` and `onLeaveTeam()`
// are just called; this panel reacts to `saving` transitioning back to
// false (with no `error`) to close whichever dialog triggered it, so the
// caller's async lifecycle is the single source of truth.
export default function ManagerTeamSharingPanel({
  membership,
  availableSkills = [],
  sharedSkillIds = [],
  saving = false,
  error = null,
  onSave,
  onLeaveTeam,
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const wasSaving = useRef(saving)

  useEffect(() => {
    if (wasSaving.current && !saving && !error) {
      setEditOpen(false)
      setLeaveConfirmOpen(false)
    }
    wasSaving.current = saving
  }, [saving, error])

  const sharedSkills = useMemo(
    () => availableSkills.filter((s) => sharedSkillIds.includes(s.id)),
    [availableSkills, sharedSkillIds]
  )

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">{membership.teamName}</h3>
      <p className="text-sm text-secondary mb-4">
        Managed by {membership.managerName} · member since {formatAbsoluteDate(membership.joinedAt)}
      </p>

      <p className="text-sm text-secondary mb-4">
        {membership.managerName} can only see the specific skills (and any evidence behind them) you choose
        to share below, plus any collaborative learning your team does together. Nothing else about your
        profile -- including your experience or personal learning history -- is visible to them. You can
        change your selection or leave the team at any time.
      </p>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-hairline">
        <p className="text-sm text-ink">
          {sharedSkills.length === 0
            ? 'No skills shared yet'
            : `Sharing ${sharedSkills.length} skill${sharedSkills.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper whitespace-nowrap"
          >
            {sharedSkills.length === 0 ? 'Choose skills to share' : 'Edit shared skills'}
          </button>
          <button
            type="button"
            onClick={() => setLeaveConfirmOpen(true)}
            className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper whitespace-nowrap"
          >
            Leave team
          </button>
        </div>
      </div>

      {!editOpen && !leaveConfirmOpen && <MutationFeedback status="error" message={error} className="mt-3" />}

      {editOpen && (
        <EditSharedSkillsDialog
          availableSkills={availableSkills}
          initiallySelectedIds={sharedSkillIds}
          saving={saving}
          error={error}
          onSave={onSave}
          onClose={() => setEditOpen(false)}
        />
      )}

      {leaveConfirmOpen && (
        <ConfirmDialog
          message={`Leave ${membership.teamName}? ${membership.managerName} will no longer see any skills or evidence you've shared, and you'll stop appearing on their team.`}
          confirmLabel="Leave team"
          confirming={saving}
          onConfirm={() => onLeaveTeam?.()}
          onCancel={() => setLeaveConfirmOpen(false)}
        />
      )}
    </div>
  )
}

function EditSharedSkillsDialog({ availableSkills, initiallySelectedIds, saving, error, onSave, onClose }) {
  const [selected, setSelected] = useState(() => new Set(initiallySelectedIds))

  function toggle(skillId) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return next
    })
  }

  return (
    <AccessibleDialog
      labelledBy="manager-shared-skills-dialog-title"
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="manager-shared-skills-dialog-title" className="font-display text-xl text-ink mb-1">
        Choose skills to share
      </h2>
      <p className="text-sm text-secondary mb-4">
        Only the skills you check here -- and their evidence, if any -- become visible to your manager. You
        can change this any time.
      </p>

      {availableSkills.length === 0 ? (
        <p className="text-sm text-secondary py-2">You haven't added any skills yet.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-1">
            <button
              type="button"
              onClick={() => setSelected(new Set(availableSkills.map((s) => s.id)))}
              disabled={saving}
              className="text-xs font-medium text-moss hover:underline disabled:opacity-60"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={saving}
              className="text-xs font-medium text-moss hover:underline disabled:opacity-60"
            >
              Share nothing
            </button>
            <span className="text-xs text-secondary ml-auto">{selected.size} selected</span>
          </div>

          <div className="max-h-64 overflow-y-auto mt-2 mb-3 divide-y divide-hairline">
            {availableSkills.map((skill) => (
              <label key={skill.id} className="flex items-center gap-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(skill.id)}
                  disabled={saving}
                  onChange={() => toggle(skill.id)}
                  className="size-4 accent-moss shrink-0"
                />
                <span className="text-sm text-ink truncate min-w-0 flex-1">{skill.name}</span>
                <span className="text-xs text-secondary shrink-0">
                  {LEVEL_LABELS[skill.level] ?? skill.level}
                  {skill.evidenceCount > 0
                    ? ` · ${skill.evidenceCount} evidence item${skill.evidenceCount === 1 ? '' : 's'}`
                    : ''}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <MutationFeedback status="error" message={error} className="mb-3" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave?.([...selected])}
          disabled={saving}
          className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : `Save (${selected.size} shared)`}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AccessibleDialog>
  )
}
