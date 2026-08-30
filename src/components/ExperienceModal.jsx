import { useState } from 'react'
import { EXPERIENCE_TYPE_CONFIG } from '../lib/experienceTypes'
import OrganizationUrlField from './OrganizationUrlField'
import AccessibleDialog from './AccessibleDialog'

export default function ExperienceModal({
  type = 'employment',
  initialOrganization = '',
  initialOrganizationUrl = '',
  onSave,
  onClose,
}) {
  const config = EXPERIENCE_TYPE_CONFIG[type]
  const [title, setTitle] = useState('')
  const [organization, setOrganization] = useState(initialOrganization)
  const [organizationUrl, setOrganizationUrl] = useState(initialOrganizationUrl)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [studyDuration, setStudyDuration] = useState('')
  const [current, setCurrent] = useState(false)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const datesRequired = config.datesRequired !== false
    if (!title.trim() || (config.orgRequired && !organization.trim()) || (datesRequired && !startDate)) {
      setError(`Title${config.orgRequired ? ', organization,' : ''}${datesRequired ? ' and start date are' : ' is'} required.`)
      return
    }
    if (!datesRequired && !startDate && !studyDuration.trim()) {
      setError('Enter a start date or a duration of study.')
      return
    }
    if (endDate && !startDate) {
      setError('Enter a start date before adding an end date.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        type,
        title: title.trim(),
        organization: organization.trim() || null,
        organization_url: organizationUrl.trim() || null,
        start_date: startDate || null,
        end_date: startDate && !current ? endDate || null : null,
        study_duration: config.allowsStudyDuration ? studyDuration.trim() || null : null,
        description: description.trim() || null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="experience-dialog-title"
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="experience-dialog-title" className="font-display text-2xl text-ink mb-4">{config.modalTitle}</h2>

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

          <div>
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
          </div>

          <OrganizationUrlField value={organizationUrl} onChange={setOrganizationUrl} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="startDate">
                Start date{config.datesRequired === false ? ' (optional)' : ''}
              </label>
              <input
                id="startDate"
                type="date"
                required={config.datesRequired !== false}
                value={startDate}
                onChange={(e) => {
                  const value = e.target.value
                  setStartDate(value)
                  if (!endDate) setEndDate(value)
                }}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="endDate">
                End date{config.datesRequired === false ? ' (optional)' : ''}
              </label>
              <input
                id="endDate"
                type="date"
                disabled={current}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-50"
              />
            </div>
          </div>

          {config.allowsStudyDuration && (
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="studyDuration">
                Duration of study
              </label>
              <input
                id="studyDuration"
                value={studyDuration}
                onChange={(e) => setStudyDuration(e.target.value)}
                placeholder="e.g. 12 weeks or one semester"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
              <p className="text-xs text-secondary mt-1">Use this instead of dates, or alongside them.</p>
            </div>
          )}

          {(config.datesRequired !== false || startDate) && (
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input
                type="checkbox"
                checked={current}
                onChange={(e) => setCurrent(e.target.checked)}
                className="rounded border-hairline"
              />
              This is ongoing / current
            </label>
          )}

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Responsibilities, achievements, focus areas…"
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
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
    </AccessibleDialog>
  )
}
