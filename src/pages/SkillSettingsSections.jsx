import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../context/LanguageContext'
import { todayDateString } from '../lib/checkin'
import { getSearchPrivacySettings, listSearchableSkillIds, setSkillSearchable } from '../lib/skillDiscovery'
import TrackingReasonPicker from '../components/TrackingReasonPicker'
import { applyCurrentRoleSelection, getCurrentRoleTrackingStatus, trackUnderCurrentRole } from '../lib/currentRole'
import CurrentRoleSelectModal from '../components/CurrentRoleSelectModal'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import TagsField from '../components/TagsField'
import ConfirmDialog from '../components/ConfirmDialog'

export function ScheduleSection({ skill, onUpdated }) {
  const { t } = useLanguage()
  const [nextCheckinDate, setNextCheckinDate] = useState(skill.next_checkin_date ?? '')
  const [recurring, setRecurring] = useState(Boolean(skill.checkin_frequency_unit))
  const [frequencyValue, setFrequencyValue] = useState(skill.checkin_frequency_value ?? 1)
  const [frequencyUnit, setFrequencyUnit] = useState(skill.checkin_frequency_unit ?? 'months')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Re-sync local form state when the skill changes elsewhere (e.g. a new
  // self-assessment auto-advances next_checkin_date) — useState's initial
  // value is only read on mount, so without this the date field would go
  // stale.
  useEffect(() => {
    setNextCheckinDate(skill.next_checkin_date ?? '')
    setRecurring(Boolean(skill.checkin_frequency_unit))
    setFrequencyValue(skill.checkin_frequency_value ?? 1)
    setFrequencyUnit(skill.checkin_frequency_unit ?? 'months')
  }, [skill.next_checkin_date, skill.checkin_frequency_value, skill.checkin_frequency_unit])

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    // The date input's min attribute is just a UI hint -- browsers still
    // let a typed/pasted value through, so this is the actual guarantee a
    // check-in can never be scheduled in the past.
    if (nextCheckinDate && nextCheckinDate < todayDateString()) {
      setError(t('skillDetail.dateCantBeInPast'))
      return
    }
    setSaving(true)
    setSaved(false)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          next_checkin_date: nextCheckinDate || null,
          checkin_frequency_value: recurring ? Math.max(1, Math.floor(Number(frequencyValue)) || 1) : null,
          checkin_frequency_unit: recurring ? frequencyUnit : null,
        })
        .eq('id', skill.id)
      if (error) throw error
      setSaved(true)
      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="border-t border-hairline pt-4 space-y-3">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary">
        {t('skillDetail.selfAssessmentScheduleHeading')}
      </h3>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="nextCheckinDate">
          {t('skillDetail.nextSelfAssessmentDateLabel')}
        </label>
        <input
          id="nextCheckinDate"
          type="date"
          value={nextCheckinDate}
          min={todayDateString()}
          onChange={(e) => setNextCheckinDate(e.target.value)}
          className="w-full min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          className="rounded border-hairline"
        />
        {t('skillDetail.setUpRegularSelfAssessments')}
      </label>

      {recurring && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-secondary">{t('skillDetail.every')}</span>
          <input
            type="number"
            min={1}
            value={frequencyValue}
            onChange={(e) => setFrequencyValue(e.target.value)}
            onBlur={(e) => setFrequencyValue(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
            className="w-16 min-w-0 rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <select
            value={frequencyUnit}
            onChange={(e) => setFrequencyUnit(e.target.value)}
            className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="weeks">{t('skillDetail.weeks')}</option>
            <option value="months">{t('skillDetail.months')}</option>
            <option value="years">{t('skillDetail.years')}</option>
          </select>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-moss">{t('skillDetail.scheduleSaved')}</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
      >
        {saving ? t('skillDetail.saving') : t('skillDetail.saveSchedule')}
      </button>
    </form>
  )
}

export function DetailsSection({ skill, skillTags, allTags, onAddTag, onRemoveTag, user, onUpdated }) {
  const { t } = useLanguage()
  const isCustom = !skill.library_skill_id || skill.skill_library?.is_private
  const [name, setName] = useState(skill.name)
  const [trackingReason, setTrackingReason] = useState(skill.tracking_reason ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('skillDetail.nameRequired'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          name: name.trim(),
          tracking_reason: trackingReason,
        })
        .eq('id', skill.id)
      if (error) {
        if (isDuplicateSkillNameError(error)) throw new Error(duplicateSkillMessage(name))
        throw error
      }

      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
        {isCustom ? t('skillDetail.customSkillPrivate') : t('skillDetail.fromSharedLibrary')}
      </p>
      {isCustom && (
        <>
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="detailName">
              {t('skillDetail.nameLabel')}
            </label>
            <input
              id="detailName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <TagsField
            tags={skillTags.map((tag) => ({ id: tag.id, name: tag.tags?.name }))}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
            skillName={name}
            allTags={allTags}
            datalistId="tags-options-detail"
          />
        </>
      )}

      <TrackingReasonPicker value={trackingReason} onChange={setTrackingReason} />

      <TrackUnderCurrentRoleButton skill={skill} user={user} onUpdated={onUpdated} />

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {saving ? t('skillDetail.saving') : t('skillDetail.saveDetails')}
        </button>
      </div>
    </form>
  )
}

// Additive-only: adds this skill to one or more of the learner's current
// (ongoing) roles on the Experience timeline. Hides itself once the skill
// is already linked to every current role -- there's nothing left to add,
// so a disabled/checked control would just be clutter. With zero current
// roles it still shows (clicking creates one); with exactly one untracked
// current role it links straight to it; with more than one it opens
// CurrentRoleSelectModal scoped to just the untracked ones.
function TrackUnderCurrentRoleButton({ skill, user, onUpdated }) {
  const { t } = useLanguage()
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [pickerRoles, setPickerRoles] = useState(null)

  useEffect(() => {
    let cancelled = false
    refreshStatus(cancelled)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads its inputs once when opened, by design
  }, [user.id, skill.id])

  async function refreshStatus(cancelled = false) {
    const s = await getCurrentRoleTrackingStatus(user.id, skill.id)
    if (!cancelled) setStatus(s)
    return s
  }

  async function handleClick() {
    setError(null)
    setSaving(true)
    try {
      const result = await trackUnderCurrentRole(user.id, skill.id, status)
      if (result.needsSelection) {
        setPickerRoles(result.roles)
      } else {
        await refreshStatus()
        onUpdated()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePickerConfirm(experienceIds) {
    await applyCurrentRoleSelection(user.id, skill.id, experienceIds)
    setPickerRoles(null)
    await refreshStatus()
    onUpdated()
  }

  if (status && status.roles.length > 0 && status.untracked.length === 0) return null

  return (
    <div>
      {pickerRoles && (
        <CurrentRoleSelectModal
          roles={pickerRoles}
          onConfirm={handlePickerConfirm}
          onCancel={() => setPickerRoles(null)}
        />
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={!status || saving}
        className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss hover:text-moss transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? t('skillDetail.adding') : t('skillDetail.trackUnderCurrentRole')}
      </button>
      <p className="text-xs text-secondary/80 mt-1">
        {t('skillDetail.trackUnderCurrentRoleDescription')}
      </p>
      {error && <p className="text-sm text-red-700 mt-1">{error}</p>}
    </div>
  )
}

// Kept as its own bottom-of-modal section, separate from the rest of the
// editable details, so a destructive/semi-destructive action never sits
// next to routine fields a learner is casually editing.
export function DeleteSection({ skill, onUpdated, onDeleted }) {
  const { t } = useLanguage()
  const isCustom = !skill.library_skill_id || skill.skill_library?.is_private
  const isArchived = skill.lifecycle_stage === 'archived'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingDrop, setConfirmingDrop] = useState(false)

  async function handleDelete() {
    setSaving(true)
    try {
      const { error } = await supabase.from('skills').delete().eq('id', skill.id)
      if (error) throw error
      onDeleted()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    } finally {
      setConfirmingDelete(false)
    }
  }

  // A library-linked skill isn't wholly this learner's to destroy the way a
  // custom one is -- "Drop" archives it instead (reusing the existing
  // archived lifecycle stage) so it disappears from the active list while
  // history (assessments, evidence, tags, peer ratings) stays intact and
  // the skill can be restored later.
  async function handleDrop() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('skills')
        .update({ lifecycle_stage: 'archived' })
        .eq('id', skill.id)
      if (error) throw error
      onDeleted()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    } finally {
      setConfirmingDrop(false)
    }
  }

  async function handleRestore() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('skills')
        .update({ lifecycle_stage: null })
        .eq('id', skill.id)
      if (error) throw error
      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pt-6 border-t border-hairline">
      <h3 className="font-display text-base text-ink mb-2">
        {isCustom ? t('skillDetail.deleteThisSkill') : t('skillDetail.dropThisSkill')}
      </h3>
      <p className="text-sm text-secondary mb-3">
        {isCustom
          ? t('skillDetail.deleteDescriptionCustom')
          : isArchived
            ? t('skillDetail.dropDescriptionArchived')
            : t('skillDetail.dropDescriptionActive')}
      </p>
      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
      {isCustom ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {t('skillDetail.deleteSkillButton')}
        </button>
      ) : isArchived ? (
        <button
          type="button"
          onClick={handleRestore}
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {t('skillDetail.restoreSkillButton')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDrop(true)}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {t('skillDetail.dropSkillButton')}
        </button>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          message={`${t('skillDetail.deleteConfirmPrefix')} "${skill.name}" ${t('skillDetail.deleteConfirmSuffix')}`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
          confirming={saving}
        />
      )}

      {confirmingDrop && (
        <ConfirmDialog
          message={`${t('skillDetail.dropConfirmPrefix')} "${skill.name}"${t('skillDetail.dropConfirmSuffix')}`}
          confirmLabel={t('skillDetail.drop')}
          onConfirm={handleDrop}
          onCancel={() => setConfirmingDrop(false)}
          confirming={saving}
        />
      )}
    </div>
  )
}

export function SettingsSection({ skill, user, onUpdated }) {
  const { t } = useLanguage()
  const [visible, setVisible] = useState(skill.visible_on_profile ?? false)
  const [validateConnections, setValidateConnections] = useState(skill.offer_validate_connections ?? false)
  const [validateOthers, setValidateOthers] = useState(skill.offer_validate_others ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const canOfferValidation = skill.lifecycle_stage === 'validated' || skill.lifecycle_stage === 'maintained'
  const [searchVisibilityMode, setSearchVisibilityMode] = useState(null)
  const [searchable, setSearchable] = useState(false)
  const [searchableLoading, setSearchableLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([getSearchPrivacySettings(), listSearchableSkillIds(user.id)])
      .then(([settings, ids]) => {
        if (cancelled) return
        setSearchVisibilityMode(settings.skill_search_visibility)
        setSearchable(ids.has(skill.id))
      })
      .finally(() => {
        if (!cancelled) setSearchableLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user.id, skill.id])

  async function handleSearchableToggle(checked) {
    setError(null)
    setSaving(true)
    try {
      await setSkillSearchable(user.id, skill.id, checked)
      setSearchable(checked)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function handleToggle(checked) {
    setError(null)
    setSaving(true)
    const { error } = await supabase
      .from('skills')
      .update({ visible_on_profile: checked })
      .eq('id', skill.id)
    if (error) {
      setError(error.message)
    } else {
      setVisible(checked)
      onUpdated()
    }
    setSaving(false)
  }

  async function handleValidationToggle(field, checked, setLocal) {
    setError(null)
    setSaving(true)
    const { error } = await supabase
      .from('skills')
      .update({ [field]: checked })
      .eq('id', skill.id)
    if (error) {
      setError(error.message)
    } else {
      setLocal(checked)
      onUpdated()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">{t('skillDetail.profileVisibility')}</h4>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={visible}
            disabled={saving}
            onChange={(e) => handleToggle(e.target.checked)}
            className="mt-0.5 rounded border-hairline"
          />
          <span className="text-sm text-ink">
            {t('skillDetail.showSkillOnProfile')}
            <span className="block text-xs text-secondary mt-0.5">
              {t('skillDetail.showSkillOnProfileDescription')}
            </span>
          </span>
        </label>
      </div>

      {!searchableLoading && searchVisibilityMode === 'selective' && skill.library_skill_id && (
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">{t('skillDetail.skillSearchHeading')}</h4>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={searchable}
              disabled={saving}
              onChange={(e) => handleSearchableToggle(e.target.checked)}
              className="mt-0.5 rounded border-hairline"
            />
            <span className="text-sm text-ink">
              {t('skillDetail.showSkillWhenSearch')}
              <span className="block text-xs text-secondary mt-0.5">
                {t('skillDetail.showSkillWhenSearchDescription')}
              </span>
            </span>
          </label>
        </div>
      )}

      {canOfferValidation && (
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">{t('skillDetail.validatingOthersHeading')}</h4>
          <p className="text-xs text-secondary mb-3">
            {t('skillDetail.validatingOthersDescription')}
          </p>
          <div className="space-y-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={validateConnections}
                disabled={saving}
                onChange={(e) =>
                  handleValidationToggle('offer_validate_connections', e.target.checked, setValidateConnections)
                }
                className="mt-0.5 rounded border-hairline"
              />
              <span className="text-sm text-ink">{t('skillDetail.letConnectionsValidate')}</span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={validateOthers}
                disabled={saving}
                onChange={(e) =>
                  handleValidationToggle('offer_validate_others', e.target.checked, setValidateOthers)
                }
                className="mt-0.5 rounded border-hairline"
              />
              <span className="text-sm text-ink">{t('skillDetail.letAnyoneValidate')}</span>
            </label>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}
