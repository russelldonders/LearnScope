import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadEvidence, getEvidenceSignedUrl } from '../lib/skillEvidence'
import { computeNextCheckinDate } from '../lib/checkin'
import GrowthRing from './GrowthRing'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'

export default function SkillDetailModal({ skill, categories, onClose, onUpdated, onDeleted }) {
  const { user } = useAuth()
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [])

  async function loadHistory() {
    setLoadingHistory(true)
    const { data } = await supabase
      .from('skill_assessments')
      .select('*')
      .eq('skill_id', skill.id)
      .order('assessed_at', { ascending: false })
    setHistory(data ?? [])
    setLoadingHistory(false)
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <GrowthRing level={skill.level} size={56} />
            <div>
              <h2 className="font-display text-2xl text-ink">{skill.name}</h2>
              <p className="text-sm text-secondary">
                {skill.category} · {LEVEL_LABELS[skill.level]}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-secondary hover:text-ink text-sm"
          >
            Close
          </button>
        </div>

        <NewCheckInSection
          skill={skill}
          user={user}
          onCheckedIn={() => {
            loadHistory()
            onUpdated()
          }}
        />

        <HistorySection history={history} loading={loadingHistory} />

        <ScheduleSection skill={skill} onUpdated={onUpdated} />

        <DetailsSection
          skill={skill}
          categories={categories}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      </div>
    </div>
  )
}

function NewCheckInSection({ skill, user, onCheckedIn }) {
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState(skill.level)
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFile, setEvidenceFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const { data: assessment, error: assessmentError } = await supabase
        .from('skill_assessments')
        .insert({
          skill_id: skill.id,
          user_id: user.id,
          level,
          comments: comments.trim() || null,
          evidence_url: evidenceUrl.trim() || null,
        })
        .select()
        .single()
      if (assessmentError) throw assessmentError

      if (evidenceFile) {
        const path = await uploadEvidence(user.id, skill.id, assessment.id, evidenceFile)
        const { error: updateError } = await supabase
          .from('skill_assessments')
          .update({ evidence_path: path })
          .eq('id', assessment.id)
        if (updateError) throw updateError
      }

      const skillUpdate = { level }
      if (skill.checkin_frequency_value && skill.checkin_frequency_unit) {
        skillUpdate.next_checkin_date = computeNextCheckinDate(
          null,
          skill.checkin_frequency_value,
          skill.checkin_frequency_unit
        )
      }
      const { error: skillError } = await supabase
        .from('skills')
        .update(skillUpdate)
        .eq('id', skill.id)
      if (skillError) throw skillError

      setOpen(false)
      setComments('')
      setEvidenceUrl('')
      setEvidenceFile(null)
      onCheckedIn()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 mb-6"
      >
        Log a new check-in
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="border border-hairline rounded-lg p-4 mb-6 space-y-3">
      <div>
        <span className="block text-sm text-secondary mb-2">Level now</span>
        <div className="flex items-center justify-between">
          {LEVELS.map((l) => (
            <button
              type="button"
              key={l}
              onClick={() => setLevel(l)}
              className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                level === l ? 'bg-moss/10' : ''
              }`}
            >
              <GrowthRing level={l} size={36} />
              <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
            </button>
          ))}
        </div>
      </div>

      <textarea
        rows={3}
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        placeholder="Why this level? What changed since last time…"
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
      />

      <input
        type="url"
        placeholder="Evidence link (optional)"
        value={evidenceUrl}
        onChange={(e) => setEvidenceUrl(e.target.value)}
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
      />

      <input
        type="file"
        onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
        className="w-full text-sm text-ink"
      />

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save check-in'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-hairline text-ink py-2 px-4 text-sm hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function HistorySection({ history, loading }) {
  return (
    <div className="mb-6">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">History</h3>
      {loading && <p className="text-sm text-secondary">Loading…</p>}
      {!loading && history.length === 0 && (
        <p className="text-sm text-secondary">No check-ins yet.</p>
      )}
      <div className="space-y-3">
        {history.map((entry) => (
          <HistoryEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function HistoryEntry({ entry }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [loadingUrl, setLoadingUrl] = useState(false)

  async function handleViewEvidence() {
    if (signedUrl) {
      window.open(signedUrl, '_blank', 'noopener')
      return
    }
    setLoadingUrl(true)
    try {
      const url = await getEvidenceSignedUrl(entry.evidence_path)
      setSignedUrl(url)
      window.open(url, '_blank', 'noopener')
    } finally {
      setLoadingUrl(false)
    }
  }

  return (
    <div className="flex gap-3 border border-hairline rounded-md p-3 bg-paper">
      <GrowthRing level={entry.level} size={32} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-secondary">
          {new Date(entry.assessed_at).toLocaleDateString()} · {LEVEL_LABELS[entry.level]}
        </p>
        {entry.comments && <p className="text-sm text-ink mt-1">{entry.comments}</p>}
        <div className="flex items-center gap-3 mt-1">
          {entry.evidence_url && (
            <a
              href={entry.evidence_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-moss font-medium"
            >
              Evidence link
            </a>
          )}
          {entry.evidence_path && (
            <button
              type="button"
              onClick={handleViewEvidence}
              disabled={loadingUrl}
              className="text-xs text-moss font-medium"
            >
              {loadingUrl ? 'Loading…' : 'View attachment'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ScheduleSection({ skill, onUpdated }) {
  const [nextCheckinDate, setNextCheckinDate] = useState(skill.next_checkin_date ?? '')
  const [recurring, setRecurring] = useState(Boolean(skill.checkin_frequency_unit))
  const [frequencyValue, setFrequencyValue] = useState(skill.checkin_frequency_value ?? 1)
  const [frequencyUnit, setFrequencyUnit] = useState(skill.checkin_frequency_unit ?? 'months')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Re-sync local form state when the skill changes elsewhere (e.g. a new
  // check-in auto-advances next_checkin_date) — useState's initial value is
  // only read on mount, so without this the date field would go stale.
  useEffect(() => {
    setNextCheckinDate(skill.next_checkin_date ?? '')
    setRecurring(Boolean(skill.checkin_frequency_unit))
    setFrequencyValue(skill.checkin_frequency_value ?? 1)
    setFrequencyUnit(skill.checkin_frequency_unit ?? 'months')
  }, [
    skill.next_checkin_date,
    skill.checkin_frequency_value,
    skill.checkin_frequency_unit,
  ])

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    setSaved(false)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          next_checkin_date: nextCheckinDate || null,
          checkin_frequency_value: recurring ? frequencyValue : null,
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
    <form
      onSubmit={handleSave}
      className="mb-6 border-t border-hairline pt-4 space-y-3"
    >
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary">
        Check-in schedule
      </h3>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="nextCheckinDate">
          Next check-in date
        </label>
        <input
          id="nextCheckinDate"
          type="date"
          value={nextCheckinDate}
          onChange={(e) => setNextCheckinDate(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          className="rounded border-hairline"
        />
        Set up a regular check-in
      </label>

      {recurring && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-secondary">Every</span>
          <input
            type="number"
            min={1}
            value={frequencyValue}
            onChange={(e) => setFrequencyValue(Number(e.target.value) || 1)}
            className="w-16 rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <select
            value={frequencyUnit}
            onChange={(e) => setFrequencyUnit(e.target.value)}
            className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="weeks">weeks</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-moss">Schedule saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save schedule'}
      </button>
    </form>
  )
}

function DetailsSection({ skill, categories, onUpdated, onDeleted }) {
  const [name, setName] = useState(skill.name)
  const [category, setCategory] = useState(skill.category)
  const [isCurrentRole, setIsCurrentRole] = useState(skill.is_current_role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave(e) {
    e.preventDefault()
    if (!name.trim() || !category.trim()) {
      setError('Name and category are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const { error } = await supabase
        .from('skills')
        .update({
          name: name.trim(),
          category: category.trim(),
          is_current_role: isCurrentRole,
        })
        .eq('id', skill.id)
      if (error) throw error
      onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${skill.name}" and all of its check-in history? This can't be undone.`)) {
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('skills').delete().eq('id', skill.id)
      if (error) throw error
      onDeleted()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="border-t border-hairline pt-4 space-y-3">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary">Details</h3>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="detailName">
          Name
        </label>
        <input
          id="detailName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="detailCategory">
          Category
        </label>
        <input
          id="detailCategory"
          list="detail-category-options"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
        <datalist id="detail-category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={isCurrentRole}
          onChange={(e) => setIsCurrentRole(e.target.checked)}
          className="rounded border-hairline"
        />
        Part of my current role
      </label>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
        >
          Delete skill
        </button>
      </div>
    </form>
  )
}
