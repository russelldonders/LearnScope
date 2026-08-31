import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { findOrCreateLibrarySkill } from '../lib/skillLibrary'
import { buildStatement, provenanceFromStatement } from '../lib/xapiStatement'
import { suggestedSkillNameForActivity } from '../lib/strava'
import { formatMonthYear } from '../lib/dates'
import AccessibleDialog from './AccessibleDialog'

// Same per-row select/edit shape as ResumeImportReviewModal's useSelection --
// re-implemented locally rather than extracted/shared, matching how that
// file keeps its own copy too.
function useSelection(items) {
  const [selected, setSelected] = useState(() => new Set(items.map((_, i) => i)))
  const [values, setValues] = useState(items)

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function updateField(i, field, value) {
    setValues((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)))
  }

  return { selected, values, toggle, updateField }
}

function formatStravaDuration(seconds) {
  if (!seconds) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return [hours > 0 ? `${hours}h` : null, minutes > 0 ? `${minutes}m` : null].filter(Boolean).join(' ') || null
}

function formatStravaDistance(meters) {
  if (!meters) return null
  return `${(meters / 1000).toFixed(1)} km`
}

export default function StravaActivityReviewModal({ activities, onClose, onImported }) {
  const { user } = useAuth()
  const items = useSelection(activities.map((a) => ({ ...a, skillName: suggestedSkillNameForActivity(a) ?? '' })))
  const [existingSkills, setExistingSkills] = useState(null)
  const [alreadyImportedIds, setAlreadyImportedIds] = useState(null)
  const [actorName, setActorName] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  // A learner's personal skills, so a suggested/typed name that already
  // exists reuses that skill's id instead of creating a duplicate --
  // mirrors ResumeImportReviewModal's existingSkillNames check, but keeps
  // the id too since (unlike that flow) a match here is reused, not just
  // excluded.
  useEffect(() => {
    supabase
      .from('skills')
      .select('id, name')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setExistingSkills(new Map((data ?? []).map((s) => [s.name.toLowerCase().trim(), s.id])))
      })
  }, [])

  // A Strava activity already imported in a previous sync+review shouldn't
  // be re-importable -- checked via the provenance extension every
  // Strava-sourced statement carries (see xapiStatement.js), same
  // "already exists" treatment ResumeImportReviewModal gives duplicate
  // skills/courses/experience.
  useEffect(() => {
    supabase
      .from('xapi_statements')
      .select('statement')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const ids = new Set(
          (data ?? [])
            .map((row) => provenanceFromStatement(row.statement))
            .filter((p) => p?.source === 'strava')
            .map((p) => p.externalId)
        )
        setAlreadyImportedIds(ids)
        items.values.forEach((activity, i) => {
          if (ids.has(activity.id) && items.selected.has(i)) items.toggle(i)
        })
      })
  }, [])

  useEffect(() => {
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setActorName(data?.full_name ?? ''))
  }, [])

  const totalSelected = items.selected.size
  const hasEmptySkillName = [...items.selected].some((i) => !items.values[i].skillName?.trim())
  const loaded = existingSkills !== null && alreadyImportedIds !== null

  async function handleImport() {
    setError(null)
    setImporting(true)
    try {
      // Two selected rows suggesting the same new skill name (e.g. two runs
      // both defaulting to "Running") must resolve to the same skill, not
      // create it twice -- resolved once per name within this import batch.
      const resolvedSkillIds = new Map(existingSkills)

      for (let i = 0; i < items.values.length; i++) {
        if (!items.selected.has(i)) continue
        const activity = items.values[i]
        const skillName = activity.skillName.trim()
        const key = skillName.toLowerCase()

        let skillId = resolvedSkillIds.get(key)
        if (!skillId) {
          const libraryId = await findOrCreateLibrarySkill(skillName, 'Fitness', user.id)
          const { data: inserted, error: skillError } = await supabase
            .from('skills')
            .insert({
              name: skillName,
              tracking_reason: 'lifestyle',
              lifecycle_stage: 'identified',
              is_current_role: false,
              source: 'external_import',
              library_skill_id: libraryId,
              user_id: user.id,
            })
            .select('id')
            .single()
          if (skillError) throw skillError
          skillId = inserted.id
          resolvedSkillIds.set(key, skillId)
        }

        const durationSeconds = activity.movingTimeSeconds ?? 0
        const distance = formatStravaDistance(activity.distanceMeters)
        const statement = buildStatement({
          actor: { name: actorName, email: user.email },
          verbValue: 'practiced',
          activityName: activity.name,
          description: `Synced from Strava${distance ? ` · ${distance}` : ''}`,
          timestamp: activity.startDate,
          relatedSkill: { id: skillId, name: skillName },
          provenance: { source: 'strava', externalId: activity.id },
          durationHours: Math.floor(durationSeconds / 3600),
          durationMinutes: Math.round((durationSeconds % 3600) / 60),
        })

        const { error: insertError } = await supabase.from('xapi_statements').insert({
          user_id: user.id,
          statement,
          recorded_at: statement.timestamp,
          skill_id: skillId,
        })
        if (insertError) throw insertError
      }

      onImported()
    } catch (err) {
      setError(err.message)
      setImporting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="strava-review-dialog-title"
      onClose={importing ? undefined : onClose}
      closeOnBackdrop={!importing}
      panelClassName="w-full max-w-2xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="strava-review-dialog-title" className="font-display text-2xl text-ink mb-1">Review Strava activities</h2>
      <p className="text-sm text-secondary mb-6">
        Pick the skill each activity contributed to, uncheck anything you don't want, then import.
      </p>

      {!loaded && <p className="text-sm text-secondary">Loading…</p>}

      {loaded && items.values.length === 0 && (
        <p className="text-sm text-secondary">No new activities to review.</p>
      )}

      {loaded && (
        <div className="space-y-2">
          {items.values.map((activity, i) => {
            const alreadyImported = alreadyImportedIds.has(activity.id)
            return (
              <label
                key={activity.id}
                className={`flex items-start gap-3 border border-hairline rounded-md p-2 bg-paper ${alreadyImported ? 'opacity-60' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={items.selected.has(i) && !alreadyImported}
                  onChange={() => items.toggle(i)}
                  disabled={alreadyImported}
                  className="mt-2 rounded border-hairline"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-ink">{activity.name}</p>
                  <p className="text-xs text-secondary mt-0.5">
                    {activity.type}
                    {activity.startDate ? ` · ${formatMonthYear(activity.startDate)}` : ''}
                    {formatStravaDuration(activity.movingTimeSeconds) ? ` · ${formatStravaDuration(activity.movingTimeSeconds)}` : ''}
                    {formatStravaDistance(activity.distanceMeters) ? ` · ${formatStravaDistance(activity.distanceMeters)}` : ''}
                    {alreadyImported ? ' · Already logged' : ''}
                  </p>
                  {!alreadyImported && (
                    <label className="flex items-center gap-1.5 text-xs text-secondary mt-2">
                      Skill
                      <input
                        value={activity.skillName}
                        onChange={(e) => items.updateField(i, 'skillName', e.target.value)}
                        placeholder="e.g. Running"
                        className="rounded border border-hairline bg-card px-1.5 py-0.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-moss"
                      />
                    </label>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}

      <div className="flex items-center gap-2 pt-4 mt-4 border-t border-hairline">
        <button
          onClick={handleImport}
          disabled={!loaded || importing || totalSelected === 0 || hasEmptySkillName}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {importing ? 'Importing…' : `Import ${totalSelected} activit${totalSelected === 1 ? 'y' : 'ies'}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={importing}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AccessibleDialog>
  )
}
