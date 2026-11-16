import { useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { isEndBeforeStart } from '../lib/dates'
import { EXPERIENCE_TYPE_CONFIG } from '../lib/experienceTypes'
import OrganizationUrlField from '../components/OrganizationUrlField'
import ConfirmDialog from '../components/ConfirmDialog'

// The experience page's settings form: edit its details or delete it
// (see ExperienceDetail.jsx).

export function DetailsTab({ item, parentExperience, onSave, onDelete }) {
  const { t } = useLanguage()
  const type = item.type
  // A child experience can't stay "ongoing" once its parent has ended --
  // force it closed here too, so the end date field is usable instead of
  // staying disabled behind a hidden checkbox.
  const parentClosed = Boolean(parentExperience?.end_date)
  const [title, setTitle] = useState(item.title)
  const [otherType, setOtherType] = useState(item.other_type ?? '')
  const [organization, setOrganization] = useState(item.organization ?? '')
  const [organizationUrl, setOrganizationUrl] = useState(item.organization_url ?? '')
  const [startDate, setStartDate] = useState(item.start_date ?? '')
  const [endDate, setEndDate] = useState(item.end_date ?? '')
  const [studyDurationValue, setStudyDurationValue] = useState(item.study_duration_value?.toString() ?? '')
  const [studyDurationUnit, setStudyDurationUnit] = useState(item.study_duration_unit ?? 'months')
  const [current, setCurrent] = useState(!item.end_date && !parentClosed)
  const [description, setDescription] = useState(item.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const config = EXPERIENCE_TYPE_CONFIG[type] ?? EXPERIENCE_TYPE_CONFIG.employment

  async function handleSubmit(e) {
    e.preventDefault()
    const datesRequired = config.datesRequired !== false
    if (!title.trim() || (config.orgRequired && !organization.trim()) || (datesRequired && !startDate)) {
      const key = config.orgRequired
        ? (datesRequired ? 'modals.experienceModal.requiredTitleOrgDates' : 'modals.experienceModal.requiredTitleOrg')
        : (datesRequired ? 'modals.experienceModal.requiredTitleDates' : 'modals.experienceModal.requiredTitleOnly')
      setError(t(key))
      return
    }
    if (!datesRequired && !startDate && !studyDurationValue && !item.study_duration) {
      setError(t('modals.experienceModal.noStartDateOrDuration'))
      return
    }
    if (endDate && !startDate) {
      setError(t('modals.experienceModal.endDateNeedsStartDate'))
      return
    }
    if (!current && isEndBeforeStart(startDate, endDate)) {
      setError(t('experience.endDateBeforeStartDate'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        type,
        title: title.trim(),
        other_type: type === 'other' ? otherType.trim() || null : null,
        organization: organization.trim() || null,
        organization_url: organizationUrl.trim() || null,
        start_date: startDate || null,
        end_date: startDate && !current ? endDate || null : null,
        study_duration: config.allowsStudyDuration && !studyDurationValue ? item.study_duration ?? null : null,
        study_duration_value: config.allowsStudyDuration ? Number(studyDurationValue) || null : null,
        study_duration_unit: config.allowsStudyDuration && studyDurationValue ? studyDurationUnit : null,
        description: description.trim() || null,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await onDelete()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    } finally {
      setConfirmingDelete(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="title">
          {config.titleLabel}
        </label>
        <input
          id="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      {type === 'other' && (
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="otherType">
            {t('modals.experienceModal.otherTypeLabel')}
          </label>
          <input
            id="otherType"
            value={otherType}
            onChange={(e) => setOtherType(e.target.value)}
            placeholder={t('modals.experienceModal.otherTypePlaceholder')}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
      )}

      {!config.inheritsOrganization && <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="organization">
          {config.orgLabel}
        </label>
        <input
          id="organization"
          required={config.orgRequired}
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>}

      {!config.inheritsOrganization && <OrganizationUrlField value={organizationUrl} onChange={setOrganizationUrl} />}

      {config.allowsStudyDuration && (
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="studyDurationValue">{t('modals.experienceModal.durationOfStudyLabel')}</label>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)] gap-2">
            <input id="studyDurationValue" type="number" min="1" step="1" inputMode="numeric" value={studyDurationValue} onChange={(e) => setStudyDurationValue(e.target.value)} placeholder={t('modals.experienceModal.durationPlaceholder')} className="min-w-0 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            <select aria-label={t('modals.experienceModal.durationUnitAriaLabel')} value={studyDurationUnit} onChange={(e) => setStudyDurationUnit(e.target.value)} className="min-w-0 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss">
              <option value="days">{t('modals.experienceModal.days')}</option>
              <option value="months">{t('modals.experienceModal.months')}</option>
              <option value="years">{t('modals.experienceModal.years')}</option>
            </select>
          </div>
          {item.study_duration && !studyDurationValue && <p className="text-xs text-secondary mt-1">{t('experience.previouslyEntered', { duration: item.study_duration })}</p>}
          <p className="text-xs text-secondary mt-1">{t('modals.experienceModal.durationOfStudyHint')}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="startDate">
            {config.datesRequired === false ? t('modals.experienceModal.startDateOptionalLabel') : t('modals.experienceModal.startDateLabel')}
          </label>
          <input
            id="startDate"
            type="date"
            min={parentExperience?.start_date}
            max={parentExperience?.end_date ?? undefined}
            required={config.datesRequired !== false}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="endDate">
            {config.datesRequired === false ? t('modals.experienceModal.endDateOptionalLabel') : t('modals.experienceModal.endDateLabel')}
          </label>
          <input
            id="endDate"
            type="date"
            min={startDate || parentExperience?.start_date}
            max={parentExperience?.end_date ?? undefined}
            disabled={current}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-50"
          />
        </div>
      </div>

      {(config.datesRequired !== false || startDate) && !parentClosed && (
        <label className="flex items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={current}
            onChange={(e) => setCurrent(e.target.checked)}
            className="rounded border-hairline"
          />
          {t('modals.experienceModal.ongoingCurrent')}
        </label>
      )}

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="description">
          {t('modals.experienceModal.descriptionLabel')}
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('modals.experienceModal.descriptionPlaceholder')}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {saving ? t('skillDetail.saving') : t('skillDetail.saveDetails')}
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
        >
          {t('experience.deleteExperience')}
        </button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          message={t('experience.deleteConfirm', { title: item.title })}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
          confirming={saving}
        />
      )}
    </form>
  )
}
