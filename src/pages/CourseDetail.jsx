import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { getCatalogueCourse } from '../lib/courseCatalogue'
import { listLibrarySkills } from '../lib/skillLibrary'
import { LEVEL_LABELS } from '../lib/levels'
import { SKILL_RELATIONSHIP_LABELS } from '../lib/skillRelationships'
import { activityName, verbLabel, formatDuration } from '../lib/xapiStatement'
import { computeCourseUpNextItems } from '../lib/courseNextAction'
import { listCourseProgressByCatalogueId } from '../lib/courseContent'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import CourseModal from '../components/CourseModal'
import RecordActivityModal from '../components/RecordActivityModal'
import ProgressBar from '../components/ProgressBar'

export default function CourseDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const backTo = location.state?.backTo ?? '/learning'
  const backLabel = location.state?.backLabel ? `← Back to ${location.state.backLabel}` : '← Back'

  const [course, setCourse] = useState(null)
  const [catalogueCourse, setCatalogueCourse] = useState(null)
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [statements, setStatements] = useState([])
  const [linkedExperiences, setLinkedExperiences] = useState([])
  const [allSkills, setAllSkills] = useState([])
  const [librarySkills, setLibrarySkills] = useState([])
  const [assessorName, setAssessorName] = useState('')
  const [contentProgress, setContentProgress] = useState(null)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editTab, setEditTab] = useState('overview')
  const [recordActivityOpen, setRecordActivityOpen] = useState(false)

  useEffect(() => {
    load()
  }, [id])

  async function load() {
    setLoading(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setCourse(data)

    const [
      { data: links },
      { data: ach },
      { data: st },
      { data: el },
      { data: mySkills },
      library,
      { data: profile },
      catalogue,
      progressByCatalogueId,
    ] = await Promise.all([
      supabase
        .from('skill_course_links')
        .select('id, relationship, skills(id, name, level)')
        .eq('course_id', id),
      supabase
        .from('skill_assessments')
        .select('*, skills(name)')
        .eq('course_id', id)
        .order('assessed_at', { ascending: false }),
      supabase
        .from('xapi_statements')
        .select('*')
        .eq('course_id', id)
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: false }),
      supabase
        .from('course_experience_links')
        .select('id, experience(id, title, organization, type)')
        .eq('course_id', id),
      supabase.from('skills').select('id, name').eq('user_id', user.id).order('name'),
      listLibrarySkills(),
      supabase.from('profiles').select('full_name').eq('id', user.id).single(),
      data.catalogue_course_id ? getCatalogueCourse(data.catalogue_course_id) : Promise.resolve(null),
      listCourseProgressByCatalogueId([data.catalogue_course_id], user.id),
    ])

    setSkillLinks((links ?? []).filter((l) => l.skills))
    setAchievements(ach ?? [])
    setStatements(st ?? [])
    setLinkedExperiences((el ?? []).filter((l) => l.experience))
    setAllSkills(mySkills ?? [])
    setLibrarySkills(library)
    setAssessorName(profile?.full_name || user.email)
    setCatalogueCourse(catalogue)
    setContentProgress(progressByCatalogueId[data.catalogue_course_id] ?? null)
    setLoading(false)
  }

  async function handleFinish() {
    setError(null)
    setFinishing(true)
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('courses').update({ completed_date: today }).eq('id', id)
    if (error) {
      setError(error.message)
      setFinishing(false)
      return
    }
    await load()
    setFinishing(false)
  }

  async function handleSaveCourse({ id: _id, ...fields }) {
    const { error } = await supabase.from('courses').update(fields).eq('id', id)
    if (error) throw error
    await load()
    setEditOpen(false)
  }

  async function handleDeleteCourse() {
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (error) throw error
    navigate(backTo, { state: { tab: 'learning' } })
  }

  async function handleRecordActivity(statement) {
    const { error } = await supabase.from('xapi_statements').insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      course_id: id,
    })
    if (error) throw error
    setRecordActivityOpen(false)
    await load()
  }

  function openEdit(tab) {
    setEditTab(tab)
    setEditOpen(true)
  }

  const events = [
    ...achievements.map((a) => ({ type: 'achievement', date: a.assessed_at, achievement: a })),
    ...statements.map((s) => ({ type: 'activity', date: s.recorded_at, statement: s })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  const upNextItems = course
    ? computeCourseUpNextItems({
        course,
        skillLinksCount: skillLinks.length,
        achievementsCount: achievements.length,
        statementsCount: statements.length,
      })
    : []

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <Link to={backTo} className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          {backLabel}
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}

        {course && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
              <div>
                <h1 className="font-display text-2xl text-ink">{course.name}</h1>
                <p className="font-mono text-xs text-secondary mt-1">
                  {course.provider &&
                    (catalogueCourse?.providerSlug ? (
                      <Link to={`/providers/${catalogueCourse.providerSlug}`} className="hover:text-moss hover:underline">
                        {course.provider}
                      </Link>
                    ) : (
                      course.provider
                    ))}
                  {course.provider && (course.course_type || course.duration) && ' · '}
                  {[course.course_type, course.duration].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2.5 py-1 border whitespace-nowrap ${
                    course.completed_date
                      ? 'text-moss border-moss'
                      : 'text-secondary border-hairline'
                  }`}
                >
                  {course.completed_date
                    ? `Completed ${new Date(course.completed_date).toLocaleDateString()}`
                    : 'In progress'}
                </span>
                <button
                  type="button"
                  onClick={() => openEdit('overview')}
                  className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                >
                  Edit
                </button>
              </div>
            </div>

            {contentProgress?.total > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                    {Math.round((contentProgress.completed / contentProgress.total) * 100)}% complete
                  </span>
                  <span className="font-mono text-[10px] text-secondary">
                    {contentProgress.completed}/{contentProgress.total}
                  </span>
                </div>
                <ProgressBar percent={Math.round((contentProgress.completed / contentProgress.total) * 100)} />
              </div>
            )}

            <Link
              to={`/courses/${id}/learn`}
              className="inline-block mt-4 rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
            >
              {statements.length > 0 || achievements.length > 0 ? 'Continue learning' : 'Start learning'} →
            </Link>

            {catalogueCourse?.synopsis && <p className="text-sm text-ink mt-4">{catalogueCourse.synopsis}</p>}

            {course.notes && (
              <div className="mt-4">
                <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-1">Notes</h4>
                <p className="text-sm text-ink whitespace-pre-line">{course.notes}</p>
              </div>
            )}

            {catalogueCourse && (catalogueCourse.skillEntries.length > 0 || catalogueCourse.tags.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-4">
                {catalogueCourse.skillEntries.map((e) => (
                  <span
                    key={e.skillId}
                    className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5"
                  >
                    {e.skillName} · {LEVEL_LABELS[e.level]}
                  </span>
                ))}
                {catalogueCourse.tags.map((t) => (
                  <span
                    key={t.id}
                    className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 mt-6">
              <StatTile label="Skills linked" value={skillLinks.length} />
              <StatTile label="Achievements" value={achievements.length} />
              <StatTile label="Activities logged" value={statements.length} />
            </div>

            <CourseUpNextSection
              items={upNextItems}
              onLinkSkills={() => openEdit('skills')}
              onRecordAchievement={() => openEdit('skills')}
              onLogActivity={() => setRecordActivityOpen(true)}
              onFinish={handleFinish}
              finishing={finishing}
            />

            {error && <p className="text-sm text-red-700 mt-4">{error}</p>}

            <div className="mt-8">
              <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Skills developed</h4>
              {skillLinks.length === 0 ? (
                <p className="text-sm text-secondary">No skills linked yet.</p>
              ) : (
                <SkillsDevelopedList skillLinks={skillLinks} />
              )}
            </div>

            {linkedExperiences.length > 0 && (
              <div className="mt-8">
                <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Part of</h4>
                <ul className="space-y-1">
                  {linkedExperiences.map((l) => (
                    <li key={l.id} className="text-sm text-ink">
                      {l.experience.title}
                      <span className="text-secondary"> · {l.experience.organization}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8">
              <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Activity</h4>
              {events.length === 0 ? (
                <p className="text-sm text-secondary">Nothing recorded yet.</p>
              ) : (
                <div>
                  {events.map((event, i) => (
                    <CourseTimelineEntry
                      key={event.achievement?.id ?? event.statement?.id}
                      event={event}
                      isLast={i === events.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {editOpen && course && (
          <CourseModal
            course={course}
            skills={allSkills}
            librarySkills={librarySkills}
            initialTab={editTab}
            onRefreshPickerData={async () => {
              const [{ data: mySkills }, library] = await Promise.all([
                supabase.from('skills').select('id, name').eq('user_id', user.id).order('name'),
                listLibrarySkills(),
              ])
              setAllSkills(mySkills ?? [])
              setLibrarySkills(library)
            }}
            onSave={handleSaveCourse}
            onDelete={handleDeleteCourse}
            onClose={() => {
              setEditOpen(false)
              load()
            }}
          />
        )}

        {recordActivityOpen && course && (
          <RecordActivityModal
            actor={{ name: assessorName, email: user.email }}
            skills={allSkills}
            relatedCourse={{ id: course.id, name: course.name }}
            onSave={handleRecordActivity}
            onClose={() => setRecordActivityOpen(false)}
          />
        )}
      </main>
    </div>
  )
}

function StatTile({ label, value }) {
  return (
    <div className="bg-paper border border-hairline rounded-lg p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{label}</p>
      <p className="font-display text-2xl text-ink mt-0.5">{value}</p>
    </div>
  )
}

// Same "Up Next" checklist box shell as SkillDetail.jsx's UpNextSection --
// a course's lifecycle is much simpler (in progress vs. completed) so there's
// no locking between items, just what's still worth doing.
function CourseUpNextSection({ items, onLinkSkills, onRecordAchievement, onLogActivity, onFinish, finishing }) {
  if (items.length === 0) return null

  const handlers = {
    'link-skills': onLinkSkills,
    'record-achievement': onRecordAchievement,
    'log-activity': onLogActivity,
    finish: onFinish,
  }

  return (
    <div className="mt-6 rounded-md border border-hairline bg-paper p-4">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Up Next</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={handlers[item.key]}
            disabled={item.key === 'finish' && finishing}
            className="w-full flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2.5 text-left hover:border-moss transition-colors disabled:opacity-60"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${
                  item.done ? 'bg-moss border-moss text-paper' : 'border-hairline text-secondary'
                }`}
              >
                {item.done ? '✓' : ''}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-ink">{item.label}</span>
                <span className="block text-xs text-secondary truncate">{item.description}</span>
              </span>
            </div>
            <span className="shrink-0 text-xs text-moss font-medium">
              {item.key === 'finish' && finishing ? 'Saving…' : item.done ? 'Redo' : 'Start'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SkillsDevelopedList({ skillLinks }) {
  const grouped = []
  const bySkill = new Map()
  for (const l of skillLinks) {
    if (!bySkill.has(l.skills.id)) {
      const entry = { skill: l.skills, relationships: [] }
      bySkill.set(l.skills.id, entry)
      grouped.push(entry)
    }
    bySkill.get(l.skills.id).relationships.push(l.relationship)
  }

  return (
    <ul className="space-y-2">
      {grouped.map((g) => (
        <li key={g.skill.id}>
          <Link
            to={`/skills/${g.skill.id}`}
            className="flex items-center gap-3 bg-paper border border-hairline rounded-md px-3 py-2.5 hover:border-moss transition-colors"
          >
            <GrowthRing level={g.skill.level} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">{g.skill.name}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {g.relationships.map((r) => (
                  <span
                    key={r}
                    className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                  >
                    {SKILL_RELATIONSHIP_LABELS[r]}
                  </span>
                ))}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function CourseTimelineEntry({ event, isLast }) {
  if (event.type === 'achievement') {
    const a = event.achievement
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <GrowthRing level={a.level} size={32} />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-4 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink">
            {a.skills?.name} <span className="text-secondary font-normal">· {LEVEL_LABELS[a.level]}</span>
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">{new Date(a.assessed_at).toLocaleDateString()}</p>
          {a.comments && <p className="text-sm text-ink mt-1">{a.comments}</p>}
        </div>
      </div>
    )
  }

  const s = event.statement
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="min-w-0 flex-1 mb-4 flex items-center gap-2 text-xs text-secondary">
        <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">{verbLabel(s.statement)}</span>
        <span className="truncate min-w-0">{activityName(s.statement)}</span>
        <span className="font-mono text-[10px] text-secondary/70 shrink-0">
          {new Date(s.recorded_at).toLocaleDateString()}
          {formatDuration(s.statement) ? ` · ${formatDuration(s.statement)}` : ''}
        </span>
      </div>
    </div>
  )
}
