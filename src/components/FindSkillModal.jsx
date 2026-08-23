import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { listLibrarySkills, isDuplicateLibrarySkillError, duplicateLibrarySkillMessage } from '../lib/skillLibrary'
import { listTags, addTagToSkill, suggestTags } from '../lib/skillTags'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import TrackingReasonPicker from './TrackingReasonPicker'
import { enableCurrentRole, applyCurrentRoleSelection, syncSkillIsCurrentRole } from '../lib/currentRole'
import CurrentRoleSelectModal from './CurrentRoleSelectModal'
import { ensureKnowledgeLevelGuide } from '../lib/knowledgeLevelGuide'
import { ensurePracticalLevelGuide } from '../lib/practicalLevelGuide'
import SelfAssessSection from './SelfAssessSection'

// 'search' / 'settings' create the skill itself; 'knowledge' / 'practical'
// are the two rating steps that follow, each independently skippable since
// skills.level and skills.knowledge_level are both nullable -- skipping just
// means no skill_assessments row gets inserted for that axis, which is
// already a fully-supported "not yet self-assessed" state everywhere else
// in the app (see SelfAssessSection).
export default function FindSkillModal({ onClose, onCreated, experienceId }) {
  const { user } = useAuth()
  const [mode, setMode] = useState('search')
  const [query, setQuery] = useState('')
  const [libraryResults, setLibraryResults] = useState([])
  const [loadingLibrary, setLoadingLibrary] = useState(true)
  const [ownedNames, setOwnedNames] = useState(new Set())
  const [allTags, setAllTags] = useState([])

  const [selected, setSelected] = useState(null)
  const [isPrivate, setIsPrivate] = useState(false)
  const [isCurrentRole, setIsCurrentRole] = useState(false)
  const [currentRolePrompt, setCurrentRolePrompt] = useState(null)
  const [trackingReason, setTrackingReason] = useState(null)
  const [createdSkill, setCreatedSkill] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)

  // The scrollable card is one persistent DOM node across every step (only
  // its children swap), so it otherwise keeps whatever scrollTop the
  // previous step left it at -- a long step 2 scrolled down before
  // advancing left step 3 opening already scrolled partway down instead of
  // at its own top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [mode])

  useEffect(() => {
    listLibrarySkills()
      .then(setLibraryResults)
      .finally(() => setLoadingLibrary(false))
    listTags().then(setAllTags)
    supabase
      .from('skills')
      .select('name')
      .eq('user_id', user.id)
      .then(({ data }) => setOwnedNames(new Set((data ?? []).map((s) => s.name.toLowerCase()))))
  }, [])

  const availableLibrary = useMemo(
    () => libraryResults.filter((s) => !ownedNames.has(s.name.toLowerCase())),
    [libraryResults, ownedNames]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return availableLibrary
    return availableLibrary.filter((s) => s.name.toLowerCase().includes(q))
  }, [availableLibrary, query])

  function selectExisting(libSkill) {
    setSelected({ id: libSkill.id, name: libSkill.name, isNew: false })
    setError(null)
    setMode('settings')
  }

  function openCreate() {
    setSelected({ id: null, name: query.trim(), isNew: true })
    setIsPrivate(false)
    setError(null)
    setMode('settings')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selected.name.trim()) {
      setError('Name is required.')
      return
    }
    if (!trackingReason) {
      setError('Please choose why you are tracking this skill.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      let libraryId = selected.id
      if (selected.isNew) {
        const { data: libRow, error: libError } = await supabase
          .from('skill_library')
          .insert({ name: selected.name.trim(), created_by: user.id, is_private: isPrivate })
          .select('id')
          .single()
        if (libError) {
          if (isDuplicateLibrarySkillError(libError)) {
            throw new Error(duplicateLibrarySkillMessage(libError, selected.name))
          }
          throw libError
        }
        libraryId = libRow.id
      }

      const { data: skill, error: skillError } = await supabase
        .from('skills')
        .insert({
          name: selected.name.trim(),
          // Rating happens in the wizard steps that follow, via the same
          // self-assessment path used everywhere else -- never set directly
          // at creation time.
          level: null,
          // Starts false regardless of the checkbox -- set true below only
          // once actually linked to a current-role experience, so a skill
          // can never end up flagged current-role with nothing behind it
          // (e.g. if the multi-role picker gets abandoned).
          is_current_role: false,
          tracking_reason: trackingReason,
          lifecycle_stage: 'identified',
          library_skill_id: libraryId,
          user_id: user.id,
        })
        .select()
        .single()
      if (skillError) {
        if (isDuplicateSkillNameError(skillError)) throw new Error(duplicateSkillMessage(selected.name))
        throw skillError
      }
      setCreatedSkill(skill)

      try {
        const suggested = await suggestTags(selected.name, allTags.map((t) => t.name))
        for (const tagName of suggested) {
          await addTagToSkill(user.id, skill.id, tagName)
        }
      } catch (tagErr) {
        console.error('Auto-tag suggestion failed:', tagErr)
      }

      // Best-effort and not awaited -- precomputes the knowledge- and
      // practical-level guidance now so both are already cached by the
      // time the wizard's rating steps (or the learner, if skipped for now)
      // open either self-assessment.
      ensureKnowledgeLevelGuide(skill).catch((guideErr) =>
        console.error('Knowledge level guide generation failed:', guideErr)
      )
      ensurePracticalLevelGuide(skill).catch((guideErr) =>
        console.error('Practical level guide generation failed:', guideErr)
      )

      if (experienceId) {
        const { error: linkError } = await supabase.from('skill_experience_links').insert({
          user_id: user.id,
          skill_id: skill.id,
          experience_id: experienceId,
        })
        if (linkError) throw linkError
      }

      if (isCurrentRole) {
        const result = await enableCurrentRole(user.id, skill.id)
        if (result.needsSelection) {
          setCurrentRolePrompt({ skillId: skill.id, roles: result.roles })
          setSaving(false)
          return
        }
      }

      setSaving(false)
      setMode('knowledge')
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleCurrentRoleConfirm(experienceIds) {
    await applyCurrentRoleSelection(user.id, currentRolePrompt.skillId, experienceIds)
    setCurrentRolePrompt(null)
    setMode('knowledge')
  }

  async function handleCurrentRoleCancel() {
    // Belt-and-suspenders: is_current_role was already inserted false and
    // nothing got linked, so this should be a no-op -- but re-syncing
    // guards against it drifting out of sync some other way. Any failure
    // here propagates to CurrentRoleSelectModal's own error handling.
    await syncSkillIsCurrentRole(user.id, currentRolePrompt.skillId)
    setCurrentRolePrompt(null)
    setMode('knowledge')
  }

  // Once the skill row exists (from the 'knowledge'/'practical' steps
  // onward), there's nothing left to abandon -- closing the modal should
  // finish up (and refresh the caller's list) rather than silently leaving
  // an already-created skill out of view until the next natural reload.
  function handleDismiss() {
    if (createdSkill) onCreated()
    else onClose()
  }

  if (currentRolePrompt) {
    return (
      <CurrentRoleSelectModal
        roles={currentRolePrompt.roles}
        onConfirm={handleCurrentRoleConfirm}
        onCancel={handleCurrentRoleCancel}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={handleDismiss}>
      <div
        ref={scrollRef}
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === 'search' && (
          <>
            <h2 className="font-display text-2xl text-ink mb-1">Find a skill</h2>
            <p className="text-sm text-secondary mb-4">
              Search the skill library, or create a new one if you can't find it.
            </p>

            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />

            <div className="max-h-64 overflow-y-auto mt-3 mb-3 divide-y divide-hairline">
              {loadingLibrary && <p className="text-sm text-secondary py-2">Loading…</p>}
              {!loadingLibrary && filtered.length === 0 && (
                <p className="text-sm text-secondary py-2">No matches.</p>
              )}
              {filtered.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-ink truncate min-w-0">
                    {s.name}
                    {s.is_private && (
                      <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-1.5 py-0.5">
                        Private
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectExisting(s)}
                    className="shrink-0 rounded-md border border-hairline text-ink py-1 px-3 text-sm font-medium hover:bg-paper"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openCreate}
                className="flex-1 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
              >
                {query.trim() ? `+ Create "${query.trim()}"` : '+ Create a new skill'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {mode === 'settings' && (
          <>
            <button
              type="button"
              onClick={() => setMode('search')}
              className="text-xs text-secondary hover:text-ink mb-2"
            >
              ← Back to search
            </button>
            <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">Step 1 of 3</p>
            <h2 className="font-display text-2xl text-ink mb-4">
              {selected.isNew ? 'Create a skill' : `Add "${selected.name}"`}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {selected.isNew && (
                <div>
                  <label className="block text-sm text-secondary mb-1" htmlFor="name">
                    Name
                  </label>
                  <input
                    id="name"
                    required
                    value={selected.name}
                    onChange={(e) => setSelected((s) => ({ ...s, name: e.target.value }))}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                </div>
              )}

              {selected.isNew && (
                <label className="flex items-start gap-2 text-sm text-secondary">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="mt-0.5 rounded border-hairline"
                  />
                  <span>
                    Keep this skill private
                    <span className="block text-xs text-secondary/80 mt-0.5">
                      Only you will be able to find it when searching. Public skills help other
                      learners avoid re-creating the same one.
                    </span>
                  </span>
                </label>
              )}

              {!experienceId && (
                <label className="flex items-start gap-2 text-sm text-secondary">
                  <input
                    type="checkbox"
                    checked={isCurrentRole}
                    onChange={(e) => setIsCurrentRole(e.target.checked)}
                    className="mt-0.5 rounded border-hairline"
                  />
                  <span>
                    Part of my current role
                    <span className="block text-xs text-secondary/80 mt-0.5">
                      Links this skill to your current job on the Experience timeline — creates one
                      called "Current role" if you don't have one yet, or asks which one if you
                      have more than one.
                    </span>
                  </span>
                </label>
              )}

              <TrackingReasonPicker value={trackingReason} onChange={setTrackingReason} required />

              {error && <p className="text-sm text-red-700">{error}</p>}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Continue'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}

        {mode === 'knowledge' && createdSkill && (
          <>
            <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">Step 2 of 3</p>
            <h2 className="font-display text-2xl text-ink mb-1">Rate your knowledge</h2>
            <p className="text-sm text-secondary mb-4">
              How well do you understand "{createdSkill.name}" in theory? You can skip this and rate it later
              from the skill's page.
            </p>
            <SelfAssessSection
              skill={createdSkill}
              user={user}
              axis="knowledge"
              onAssessed={() => setMode('practical')}
              onGuideGenerated={(statements) =>
                setCreatedSkill((s) => (s ? { ...s, knowledge_level_guide: statements } : s))
              }
              submitLabel="Save & Next"
              secondaryAction={{ label: 'Skip for now', onClick: () => setMode('practical') }}
            />
          </>
        )}

        {mode === 'practical' && createdSkill && (
          <>
            <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">Step 3 of 3</p>
            <h2 className="font-display text-2xl text-ink mb-1">Rate your practical ability</h2>
            <p className="text-sm text-secondary mb-4">
              How would you rate applying "{createdSkill.name}" in practice? You can skip this and rate it
              later from the skill's page.
            </p>
            <SelfAssessSection
              skill={createdSkill}
              user={user}
              axis="practical"
              onAssessed={onCreated}
              onGuideGenerated={(statements) =>
                setCreatedSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
              }
              submitLabel="Save & Next"
              secondaryAction={{ label: 'Skip for now', onClick: onCreated }}
            />
          </>
        )}
      </div>
    </div>
  )
}
