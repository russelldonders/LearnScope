import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatMonthYear, formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import { EXPERIENCE_TYPE_LABELS, EXPERIENCE_TYPE_CONFIG, formatStudyDuration, nestedExperienceTypesFor } from '../lib/experienceTypes'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import ChildExperienceEntry from '../components/ChildExperienceEntry'
import SkillCard from '../components/SkillCard'
import FindSkillModal from '../components/FindSkillModal'
import OrganizationLogo from '../components/OrganizationLogo'
import OrganizationUrlField from '../components/OrganizationUrlField'
import ExperienceModal from '../components/ExperienceModal'
import AddExperienceButton from '../components/AddExperienceButton'
import ConfirmDialog from '../components/ConfirmDialog'
import RecordActivityModal from '../components/RecordActivityModal'
import { activityName, relatedSkillFromStatement, verbLabel } from '../lib/xapiStatement'

// Keeps a nested experience's dates from silently
// drifting outside the parent role's dates -- an open-ended parent
// (end_date null) places no upper bound on its children.
export function validateWithinParent(values, parent) {
  if (!parent) return null
  if (values.start_date && values.start_date < parent.start_date) {
    return `Start date can't be before ${formatMonthYear(parent.start_date)}, when "${parent.title}" started.`
  }
  if (parent.end_date) {
    if (values.start_date && values.start_date > parent.end_date) {
      return `Start date can't be after ${formatMonthYear(parent.end_date)}, when "${parent.title}" ended.`
    }
    if (values.end_date && values.end_date > parent.end_date) {
      return `End date can't be after ${formatMonthYear(parent.end_date)}, when "${parent.title}" ended.`
    }
    if (values.type !== 'subject' && !values.end_date) {
      return `End date can't be after ${formatMonthYear(parent.end_date)}, when "${parent.title}" ended.`
    }
  }
  if (values.end_date && values.end_date < parent.start_date) {
    return `End date can't be before ${formatMonthYear(parent.start_date)}, when "${parent.title}" started.`
  }
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    return 'End date can\'t be before the start date.'
  }
  return null
}

function undatedChildTimelineDate(item, today) {
  const start = item.start_date
    ? new Date(`${item.start_date}T00:00:00Z`).getTime()
    : today.getTime()
  const end = item.end_date
    ? new Date(`${item.end_date}T00:00:00Z`).getTime()
    : today.getTime()
  return new Date(start + Math.max(0, end - start) / 2).toISOString()
}

export function buildExperienceTimelineEvents(item, childExperiences, linkedCourses, achievements, activities = [], today = new Date()) {
  const undatedChildDate = undatedChildTimelineDate(item, today)
  return [
    ...(item.start_date ? [{ type: 'start', date: item.start_date }] : []),
    ...(item.start_date ? [item.end_date ? { type: 'end', date: item.end_date } : { type: 'today', date: today.toISOString() }] : []),
    ...(childExperiences ?? []).map((child) => ({
      type: 'child',
      date: child.start_date ?? undatedChildDate,
      child,
    })),
    ...linkedCourses
      .filter((link) => link.courses?.completed_date)
      .map((link) => ({ type: 'course', date: link.courses.completed_date, link })),
    ...achievements.map((entry) => ({ type: 'achievement', date: entry.assessed_at, entry })),
    ...activities.map((activity) => ({ type: 'activity', date: activity.recorded_at, activity })),
  ].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'courses', label: 'Courses' },
]

export function getExperienceTabs(item, linkedCourses) {
  return TABS.filter(
    (tab) => tab.id !== 'courses' || (!item.parent_experience_id && linkedCourses.length > 0)
  )
}

export default function ExperienceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [item, setItem] = useState(null)
  const [loadingItem, setLoadingItem] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState(location.state?.tab ?? 'overview')
  const [linkedCourses, setLinkedCourses] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [skillHistory, setSkillHistory] = useState([])
  const [experienceActivities, setExperienceActivities] = useState([])
  const [activitySkills, setActivitySkills] = useState([])
  const [activityOpen, setActivityOpen] = useState(false)
  const [learningLoaded, setLearningLoaded] = useState(false)
  const [childExperiences, setChildExperiences] = useState([])
  const [parentExperience, setParentExperience] = useState(null)
  const [childModalType, setChildModalType] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    loadItem()
  }, [id])

  useEffect(() => {
    if (item) {
      loadLearning()
      loadRelated()
    }
  }, [item?.id])

  useEffect(() => {
    if (learningLoaded && (tab === 'skills' || (tab === 'courses' && linkedCourses.length === 0))) setTab('overview')
  }, [learningLoaded, linkedCourses.length, tab])

  async function loadItem() {
    setLoadingItem(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('experience')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
    } else {
      setItem(data)
    }
    setLoadingItem(false)
  }

  async function loadLearning() {
    const [{ data: cl }, { data: sl }, { data: ach }, { data: activities }, { data: allSkills }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, course_id, courses(id, name, provider, completed_date)')
        .eq('experience_id', item.id),
      supabase
        .from('skill_experience_links')
        .select('id, skill_id, skills(id, name, level)')
        .eq('experience_id', item.id)
        .order('created_at'),
      supabase
        .from('skill_assessments')
        .select('*, skills(name), courses(name)')
        .eq('experience_id', item.id)
        .order('assessed_at', { ascending: false }),
      supabase
        .from('xapi_statements')
        .select('id, statement, recorded_at, skill_id, skills(id, name)')
        .eq('experience_id', item.id)
        .order('recorded_at', { ascending: false }),
      supabase
        .from('skills')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name'),
    ])
    const skillIds = (sl ?? []).map((link) => link.skill_id)
    const { data: history } = skillIds.length
      ? await supabase
          .from('skill_assessments')
          .select('id, skill_id, level, axis, source, comments, assessed_at')
          .in('skill_id', skillIds)
          .eq('axis', 'practical')
          .order('assessed_at', { ascending: true })
      : { data: [] }
    setLinkedCourses(cl ?? [])
    setSkillLinks(sl ?? [])
    setAchievements(ach ?? [])
    setSkillHistory(history ?? [])
    setExperienceActivities(activities ?? [])
    setActivitySkills(allSkills ?? [])
    setLearningLoaded(true)
  }

  async function loadRelated() {
    const [{ data: children }, parentResult] = await Promise.all([
      supabase
        .from('experience')
        .select('id, type, title, start_date, end_date, study_duration, study_duration_value, study_duration_unit')
        .eq('parent_experience_id', item.id)
        .order('start_date', { ascending: false }),
      item.parent_experience_id
        ? supabase
            .from('experience')
            .select('id, title, organization, organization_url, start_date, end_date')
            .eq('id', item.parent_experience_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setChildExperiences(children ?? [])
    setParentExperience(parentResult.data ?? null)
  }

  async function handleAddChildExperience(values) {
    const childValues = values.type === 'subject'
      ? { ...values, organization: item.organization, organization_url: item.organization_url }
      : values
    const validationError = validateWithinParent(childValues, item)
    if (validationError) throw new Error(validationError)
    const { error } = await supabase.from('experience').insert({
      ...childValues,
      user_id: user.id,
      parent_experience_id: item.id,
    })
    if (error) throw error
    setChildModalType(null)
    await loadRelated()
  }

  async function handleSaveDetails(values) {
    const savedValues = item.type === 'subject' && parentExperience
      ? { ...values, organization: parentExperience.organization, organization_url: parentExperience.organization_url }
      : values
    if (item.parent_experience_id && parentExperience) {
      const validationError = validateWithinParent(savedValues, parentExperience)
      if (validationError) throw new Error(validationError)
    }
    const { error } = await supabase.from('experience').update(savedValues).eq('id', item.id)
    if (error) throw error
    await loadItem()
  }

  async function handleDelete() {
    const { error } = await supabase.from('experience').delete().eq('id', item.id)
    if (error) throw error
    navigate('/experience')
  }

  async function handleLogActivity(statement) {
    const relatedSkill = relatedSkillFromStatement(statement)
    const { error } = await supabase.from('xapi_statements').insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      skill_id: relatedSkill.id,
      experience_id: item.id,
    })
    if (error) throw error
    setActivityOpen(false)
    await loadLearning()
  }

  const backTo = location.state?.backTo ?? (parentExperience ? `/experience/${parentExperience.id}` : '/experience')
  const backLabel = location.state?.backLabel ?? (parentExperience ? parentExperience.title : 'experience')

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <Link to={backTo} className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          ← Back to {backLabel}
        </Link>

        {loadingItem && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Experience not found.</p>}

        {item && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {EXPERIENCE_TYPE_LABELS[item.type] ?? item.type}
                </span>
                <h1 className="font-display text-2xl text-ink mt-0.5">{item.title}</h1>
                {item.type !== 'subject' && item.organization && (
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.organization_url && (
                      <OrganizationLogo organizationUrl={item.organization_url} size={24} />
                    )}
                    <p className="text-sm text-secondary">{item.organization}</p>
                  </div>
                )}
                {parentExperience && (
                  <p className="text-xs text-secondary mt-1">
                    Part of{' '}
                    <Link to={`/experience/${parentExperience.id}`} className="text-moss hover:underline">
                      {parentExperience.title}
                    </Link>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Experience settings"
                title="Experience settings"
                className="p-2 -m-2 rounded-md text-moss hover:opacity-75 transition-opacity shrink-0"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>

            <ExperienceActionButtons
              itemType={item.type}
              onAddExperience={setChildModalType}
              onLogActivity={() => setActivityOpen(true)}
            />

            {activityOpen && (
              <RecordActivityModal
                actor={{ name: user.user_metadata?.full_name ?? '', email: user.email }}
                skills={activitySkills}
                relatedExperience={{
                  id: item.id,
                  title: item.title,
                  type: item.type,
                  start_date: item.start_date,
                  end_date: item.end_date,
                }}
                onSave={handleLogActivity}
                onClose={() => setActivityOpen(false)}
              />
            )}

            {childModalType && (
              <ExperienceModal
                type={childModalType}
                initialOrganization={item.organization ?? ''}
                initialOrganizationUrl={item.organization_url ?? ''}
                minimumDate={item.start_date}
                maximumDate={item.end_date ?? undefined}
                onSave={handleAddChildExperience}
                onClose={() => setChildModalType(null)}
              />
            )}

            <div className="flex items-center gap-1 border-b border-hairline mt-4 mb-4">
              {getExperienceTabs(item, linkedCourses).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-moss text-ink'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <OverviewTab
                item={item}
                linkedCourses={linkedCourses}
                skillLinks={skillLinks}
                skillHistory={skillHistory}
                achievements={achievements}
                childExperiences={childExperiences}
                activities={experienceActivities}
                loaded={learningLoaded}
              />
            )}

            {tab === 'courses' && (
              <CoursesSubsection item={item} linkedCourses={linkedCourses} onChange={loadLearning} />
            )}


            {settingsOpen && (
              <div
                className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-40"
                onClick={() => setSettingsOpen(false)}
              >
                <div
                  className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-2xl text-ink">Experience settings</h2>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(false)}
                      className="text-secondary hover:text-ink text-sm"
                    >
                      Close
                    </button>
                  </div>
                  <DetailsTab item={item} parentExperience={parentExperience} onSave={handleSaveDetails} onDelete={handleDelete} />
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function DetailsTab({ item, parentExperience, onSave, onDelete }) {
  const [type, setType] = useState(item.type)
  const [title, setTitle] = useState(item.title)
  const [organization, setOrganization] = useState(item.organization ?? '')
  const [organizationUrl, setOrganizationUrl] = useState(item.organization_url ?? '')
  const [startDate, setStartDate] = useState(item.start_date ?? '')
  const [endDate, setEndDate] = useState(item.end_date ?? '')
  const [studyDurationValue, setStudyDurationValue] = useState(item.study_duration_value?.toString() ?? '')
  const [studyDurationUnit, setStudyDurationUnit] = useState(item.study_duration_unit ?? 'months')
  const [current, setCurrent] = useState(!item.end_date)
  const [description, setDescription] = useState(item.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const config = EXPERIENCE_TYPE_CONFIG[type] ?? EXPERIENCE_TYPE_CONFIG.employment

  async function handleSubmit(e) {
    e.preventDefault()
    const datesRequired = config.datesRequired !== false
    if (!title.trim() || (config.orgRequired && !organization.trim()) || (datesRequired && !startDate)) {
      setError(`Title${config.orgRequired ? ', organization,' : ''}${datesRequired ? ' and start date are' : ' is'} required.`)
      return
    }
    if (!datesRequired && !startDate && !studyDurationValue && !item.study_duration) {
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
      {item.type === 'education' && (
        <div>
          <span className="block text-sm text-secondary mb-2">Type</span>
          <div className="flex gap-2">
            {[
              { value: 'employment', label: 'Employment' },
              { value: 'education', label: 'Education' },
            ].map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  type === opt.value
                    ? 'bg-moss text-paper border-moss'
                    : 'border-hairline text-ink hover:bg-paper'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-secondary mt-1">
            Education entries are now recorded under Courses — this one is kept as-is since it
            already exists.
          </p>
        </div>
      )}

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
          <label className="block text-sm text-secondary mb-1" htmlFor="studyDurationValue">Duration of study</label>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)] gap-2">
            <input id="studyDurationValue" type="number" min="1" step="1" inputMode="numeric" value={studyDurationValue} onChange={(e) => setStudyDurationValue(e.target.value)} placeholder="e.g. 6" className="min-w-0 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
            <select aria-label="Duration unit" value={studyDurationUnit} onChange={(e) => setStudyDurationUnit(e.target.value)} className="min-w-0 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss">
              <option value="days">Days</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </div>
          {item.study_duration && !studyDurationValue && <p className="text-xs text-secondary mt-1">Previously entered: {item.study_duration}</p>}
          <p className="text-xs text-secondary mt-1">Use this instead of dates, or alongside them.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="startDate">
            Start date{config.datesRequired === false ? ' (optional)' : ''}
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
            End date{config.datesRequired === false ? ' (optional)' : ''}
          </label>
          <input
            id="endDate"
            type="date"
            min={parentExperience?.start_date}
            max={parentExperience?.end_date ?? undefined}
            disabled={current}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-50"
          />
        </div>
      </div>

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
          placeholder="What did you learn? What knowledge or skills did you develop?"
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
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
        >
          Delete experience
        </button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete "${item.title}"? This can't be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
          confirming={saving}
        />
      )}
    </form>
  )
}

function OverviewTab({ item, linkedCourses, skillLinks, skillHistory, achievements, childExperiences, activities, loaded }) {
  const navigate = useNavigate()
  if (!loaded) return <p className="text-sm text-secondary">Loading…</p>

  function goToCourse(courseId) {
    navigate(`/courses/${courseId}/learn`, { state: { backTo: `/experience/${item.id}`, backLabel: item.title } })
  }

  const pendingCourseLinks = linkedCourses.filter((l) => l.courses && !l.courses.completed_date)
  const events = buildExperienceTimelineEvents(item, childExperiences, linkedCourses, achievements, activities)
  const total = pendingCourseLinks.length + events.length

  return (
    <div className="space-y-6">
      {item.description && <p className="text-sm text-ink whitespace-pre-line">{item.description}</p>}
      {formatStudyDuration(item) && (
        <p className="text-sm text-secondary"><span className="font-medium text-ink">Duration of study:</span> {formatStudyDuration(item)}</p>
      )}

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Timeline</h4>
        {pendingCourseLinks.map((link, i) => (
          <PendingCourseEntry
            key={link.id}
            link={link}
            hasMore={i < total - 1}
            onClick={() => goToCourse(link.courses.id)}
          />
        ))}
        {events.map((event, i) => (
          <ExperienceTimelineEntry
            key={event.child?.id ?? event.link?.id ?? event.entry?.id ?? event.activity?.id ?? event.type}
            item={item}
            event={event}
            isLast={pendingCourseLinks.length + i === total - 1}
            onSelectCourse={goToCourse}
          />
        ))}
      </div>

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">Skills developed</h4>
        {skillLinks.length === 0 ? (
          <p className="text-sm text-secondary">No skills linked yet.</p>
        ) : (
          <SkillDevelopmentList item={item} skillLinks={skillLinks} assessments={skillHistory} />
        )}
      </div>
    </div>
  )
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null
}

export function buildExperienceSkillProgress(skillLink, assessments, item, today = new Date()) {
  const startDate = dateKey(item.start_date)
  const endDate = dateKey(item.end_date ?? today)
  const rows = assessments
    .filter((entry) => entry.skill_id === skillLink.skill_id && entry.level)
    .sort((a, b) => dateKey(a.assessed_at).localeCompare(dateKey(b.assessed_at)))
  const entryAssessment = [...rows].reverse().find((entry) => dateKey(entry.assessed_at) <= startDate)
  const duringRole = rows.filter((entry) => {
    const assessedDate = dateKey(entry.assessed_at)
    return assessedDate >= startDate && assessedDate <= endDate
  })
  const exitAssessment = item.end_date
    ? [...rows].reverse().find((entry) => dateKey(entry.assessed_at) <= endDate)
    : null

  return {
    entryLevel: entryAssessment?.level ?? null,
    endLevel: item.end_date ? (exitAssessment?.level ?? null) : (skillLink.skills?.level ?? null),
    endLabel: item.end_date ? 'When role ended' : 'Current level',
    duringRole,
  }
}

export function getDevelopedSkills(skillLinks, assessments, item, today = new Date()) {
  return skillLinks
    .map((link) => ({ link, progress: buildExperienceSkillProgress(link, assessments, item, today) }))
    .filter(({ progress }) => progress.entryLevel && progress.endLevel > progress.entryLevel)
}

function SkillDevelopmentList({ item, skillLinks, assessments }) {
  const [expandedSkillId, setExpandedSkillId] = useState(null)
  const developedSkills = getDevelopedSkills(skillLinks, assessments, item)

  if (developedSkills.length === 0) {
    return <p className="text-sm text-secondary">No measured skill growth during this experience yet.</p>
  }

  return (
    <ul className="overflow-hidden rounded-md border border-hairline divide-y divide-hairline">
      {developedSkills.map(({ link, progress }) => {
        const expanded = expandedSkillId === link.skill_id
        return (
          <li key={link.skill_id} className="bg-paper/40">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpandedSkillId(expanded ? null : link.skill_id)}
              className="w-full p-3 text-left hover:bg-paper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-inset"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{link.skills?.name}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  className={`h-4 w-4 shrink-0 text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
                >
                  <path d="m5.5 7.5 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <SkillLevelPoint label="At role start" level={progress.entryLevel} />
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-secondary">
                  <path d="M3.5 10h13m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <SkillLevelPoint label={progress.endLabel} level={progress.endLevel} align="right" />
              </span>
            </button>
            {expanded && <SkillProgressHistory progress={progress} />}
          </li>
        )
      })}
    </ul>
  )
}

function SkillLevelPoint({ label, level, align = 'left' }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <GrowthRing level={level} size={36} />
      <span className="min-w-0">
        <span className="block font-mono text-[10px] uppercase tracking-wide text-secondary">{label}</span>
        <span className="mt-0.5 block text-sm text-ink">Level {level} · {LEVEL_LABELS[level]}</span>
      </span>
    </span>
  )
}

function SkillProgressHistory({ progress }) {
  return (
    <div className="border-t border-hairline bg-card px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">History during this role</p>
      {progress.duringRole.length === 0 ? (
        <p className="text-sm text-secondary">No assessments were recorded during this role.</p>
      ) : (
        <ol className="space-y-2">
          {progress.duringRole.map((entry) => (
            <li key={entry.id} className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <GrowthRing level={entry.level} size={28} />
              <div className="min-w-0">
                <p className="text-ink">Level {entry.level} · {LEVEL_LABELS[entry.level]}</p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {formatFullDate(entry.assessed_at)}
                </p>
                {entry.comments && <p className="mt-1 text-secondary">{entry.comments}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PendingCourseEntry({ link, hasMore, onClick }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-hairline">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
        </div>
        {hasMore && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper/60 p-3 cursor-pointer hover:border-moss/60 transition-colors"
      >
        <p className="text-sm text-secondary">
          Enrolled in <span className="text-ink font-medium">{link.courses.name}</span> — in progress
        </p>
      </div>
    </div>
  )
}

function FlagIcon({ className }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 3v18" />
      <path d="M5 4h13l-2.5 4.5L18 13H5" />
    </svg>
  )
}

function ExperienceTimelineEntry({ item, event, isLast, onSelectCourse }) {
  if (event.type === 'start' || event.type === 'end') {
    const config = EXPERIENCE_TYPE_CONFIG[item.type] ?? EXPERIENCE_TYPE_CONFIG.employment
    const isSubExperience = Boolean(item.parent_experience_id)
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <FlagIcon className="text-secondary" />
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink capitalize">
            {event.type === 'start' ? `${config.periodNoun} started` : `${config.periodNoun} ended`}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {isSubExperience ? formatFullDate(event.date) : formatMonthYear(event.date)}
          </p>
        </div>
      </div>
    )
  }

  if (event.type === 'today') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-ink shrink-0" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink font-semibold">
            Today · {new Date(event.date).toLocaleDateString()}
          </span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
      </div>
    )
  }

  if (event.type === 'child') {
    return <ChildExperienceEntry child={event.child} isLast={isLast} />
  }

  if (event.type === 'course') {
    const course = event.link.courses
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelectCourse(course.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelectCourse(course.id)
            }
          }}
          className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary cursor-pointer hover:text-ink transition-colors"
        >
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">Training</span>
          <span className="truncate min-w-0">{course.name}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {new Date(course.completed_date).toLocaleDateString()}
          </span>
        </div>
      </div>
    )
  }

  if (event.type === 'activity') {
    const row = event.activity
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-moss shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-3">
          <p className="text-sm text-ink break-words">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{verbLabel(row.statement)}</span>{' '}
            {activityName(row.statement)}
          </p>
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {row.skills?.name ? `${row.skills.name} · ` : ''}{formatFullDate(row.recorded_at)}
          </p>
        </div>
      </div>
    )
  }

  const entry = event.entry
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <GrowthRing level={entry.level} size={32} />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
        <p className="text-sm font-medium text-ink">
          {entry.skills?.name} <span className="text-secondary font-normal">· {LEVEL_LABELS[entry.level]}</span>
        </p>
        <p className="font-mono text-xs text-secondary mt-0.5">{new Date(entry.assessed_at).toLocaleDateString()}</p>
        {entry.comments && <p className="text-sm text-ink mt-1">{entry.comments}</p>}
      </div>
    </div>
  )
}

function CoursesSubsection({ item, linkedCourses, onChange }) {
  const [error, setError] = useState(null)

  async function unlinkCourse(linkId) {
    setError(null)
    const { error } = await supabase.from('course_experience_links').delete().eq('id', linkId)
    if (error) setError(error.message)
    else await onChange()
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Courses</h4>

      {linkedCourses.length === 0 ? (
        <p className="text-sm text-secondary mb-3">No courses linked yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {linkedCourses
            .filter((l) => l.courses)
            .map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 bg-paper border border-hairline rounded-md px-3 py-2"
              >
                <Link
                  to={`/courses/${l.courses.id}/learn`}
                  state={{ backTo: `/experience/${item.id}`, backLabel: item.title }}
                  className="min-w-0"
                >
                  <p className="text-sm text-ink truncate hover:underline">{l.courses.name}</p>
                  {l.courses.completed_date && (
                    <p className="font-mono text-xs text-secondary">
                      Completed {formatMonthYear(l.courses.completed_date)}
                    </p>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => unlinkCourse(l.id)}
                  className="shrink-0 text-xs text-red-700 font-medium"
                >
                  Unlink
                </button>
              </li>
            ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}

export function SkillsSubsection({
  item,
  skillLinks,
  onChange,
  user,
  addOpen = false,
  onAddOpenChange = () => {},
  recommendations = [],
  selectedRecommendations = new Set(),
  onToggleRecommendation = () => {},
  onAddRecommendations = () => {},
  onDismissRecommendations = () => {},
  addingRecommendations = false,
  recommendationError = null,
  recommendationNotice = null,
}) {
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)

  const skillIds = [...new Set(skillLinks.map((l) => l.skill_id))]

  useEffect(() => {
    loadSkills()
  }, [skillLinks])

  async function loadSkills() {
    if (skillIds.length === 0) {
      setSkills([])
      setTagsBySkill(new Map())
      setLoading(false)
      return
    }
    setLoading(true)
    const [{ data: skillRows }, { data: tagLinks }] = await Promise.all([
      supabase.from('skills').select('*').eq('user_id', user.id).in('id', skillIds),
      supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', user.id).in('skill_id', skillIds),
    ])
    setSkills(skillRows ?? [])
    const map = new Map()
    for (const link of tagLinks ?? []) {
      if (!link.tags?.name) continue
      if (!map.has(link.skill_id)) map.set(link.skill_id, [])
      map.get(link.skill_id).push(link.tags.name)
    }
    setTagsBySkill(map)
    setLoading(false)
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Skills linked</h4>

      {recommendationError && (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {recommendationError}
        </p>
      )}
      {recommendationNotice && (
        <p role="status" className="text-sm text-secondary mb-3">
          {recommendationNotice}
        </p>
      )}

      {recommendations.length > 0 && (
        <section aria-labelledby="skill-recommendations-heading" className="bg-paper rounded-lg p-4 mb-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h5 id="skill-recommendations-heading" className="font-display text-lg text-ink">
                Recommended for this experience
              </h5>
              <p className="text-sm text-secondary mt-1">Choose up to three skills to add.</p>
            </div>
            <span className="text-xs text-secondary tabular-nums shrink-0">
              {selectedRecommendations.size} selected
            </span>
          </div>
          <div className="divide-y divide-hairline">
            {recommendations.map((recommendation, index) => (
              <label key={recommendation.name} className="flex items-start gap-3 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRecommendations.has(recommendation.name)}
                  onChange={() => onToggleRecommendation(recommendation.name)}
                  className="mt-1 size-4 accent-moss"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-ink">{recommendation.name}</span>
                    <span className="text-xs text-secondary">Priority {index + 1}</span>
                  </span>
                  <span className="block text-sm text-secondary mt-0.5">{recommendation.reason}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onAddRecommendations}
              disabled={selectedRecommendations.size === 0 || addingRecommendations}
              className="rounded-md bg-moss text-paper px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {addingRecommendations
                ? 'Adding skills…'
                : `Add ${selectedRecommendations.size || ''} selected skill${selectedRecommendations.size === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={onDismissRecommendations}
              disabled={addingRecommendations}
              className="rounded-md px-3 py-2 text-sm text-secondary hover:text-ink disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="text-sm text-secondary">No skills linked yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              tags={tagsBySkill.get(skill.id)}
              onEdit={(s) =>
                navigate(`/skills/${s.id}`, {
                  state: { from: `/experience/${item.id}`, fromLabel: item.title },
                })
              }
            />
          ))}
        </div>
      )}

      {addOpen && (
        <FindSkillModal
          experienceId={item.id}
          onClose={() => onAddOpenChange(false)}
          onCreated={() => {
            onAddOpenChange(false)
            onChange()
          }}
        />
      )}
    </div>
  )
}

export function ExperienceActionButtons({
  itemType,
  onAddExperience,
  onLogActivity,
}) {
  const nestedTypes = nestedExperienceTypesFor(itemType)
  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      {nestedTypes.length > 0 && (
        <AddExperienceButton
          types={nestedTypes}
          onSelect={onAddExperience}
          label="+ Add"
        />
      )}
      <button
        type="button"
        onClick={onLogActivity}
        className="inline-flex items-center gap-2 rounded-md border border-moss text-moss px-3 py-2 text-sm font-medium hover:bg-moss/10 disabled:opacity-60"
      >
        Log skill activity
      </button>
    </div>
  )
}
