import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { SAMPLE_MODULES } from '../lib/courseContentSample'
import AppHeader from '../components/AppHeader'

const TYPE_META = {
  video: { label: 'Video', icon: 'video' },
  reading: { label: 'Reading', icon: 'reading' },
  exercise: { label: 'Exercise', icon: 'exercise' },
  quiz: { label: 'Knowledge check', icon: 'quiz' },
}

// Preview of what a learner-facing content player could look like -- the
// syllabus here (courseContentSample.js) is illustrative, not tied to this
// course's actual material or persisted anywhere, since there's no content
// editor/creator yet to author real lessons. Completion state is local to
// this session only.
export default function CourseLearn() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [completedIds, setCompletedIds] = useState(new Set())
  const [quizSelection, setQuizSelection] = useState(null)

  const lessons = useMemo(() => SAMPLE_MODULES.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleId: m.id }))), [])
  const [currentLessonId, setCurrentLessonId] = useState(lessons[0]?.id ?? null)
  const currentIndex = lessons.findIndex((l) => l.id === currentLessonId)
  const currentLesson = lessons[currentIndex]

  useEffect(() => {
    load()
  }, [id])

  async function load() {
    setLoading(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, provider')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setCourse(data)
    setLoading(false)
  }

  function goToLesson(lessonId) {
    setCurrentLessonId(lessonId)
    setQuizSelection(null)
  }

  function markComplete() {
    setCompletedIds((prev) => new Set(prev).add(currentLesson.id))
    const next = lessons[currentIndex + 1]
    if (next) goToLesson(next.id)
  }

  const progress = lessons.length ? Math.round((completedIds.size / lessons.length) * 100) : 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Link to={`/courses/${id}`} className="text-sm text-secondary hover:text-ink mb-4 inline-block">
          ← Back to course
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}

        {course && currentLesson && (
          <div>
            <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
              <h2 className="font-display text-2xl text-ink">{course.name}</h2>
              <p className="font-mono text-xs text-secondary shrink-0">
                {completedIds.size} / {lessons.length} lessons complete
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-hairline overflow-hidden mb-8">
              <div
                className="h-full bg-moss rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="grid md:grid-cols-[280px_1fr] gap-6">
              <nav className="space-y-4">
                {SAMPLE_MODULES.map((module) => (
                  <div key={module.id}>
                    <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">
                      {module.title}
                    </h3>
                    <ul className="space-y-1">
                      {module.lessons.map((lesson) => {
                        const isCurrent = lesson.id === currentLesson.id
                        const isDone = completedIds.has(lesson.id)
                        return (
                          <li key={lesson.id}>
                            <button
                              type="button"
                              onClick={() => goToLesson(lesson.id)}
                              className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                                isCurrent
                                  ? 'bg-card border border-moss text-ink'
                                  : 'border border-transparent text-secondary hover:bg-card hover:text-ink'
                              }`}
                            >
                              <span
                                className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${
                                  isDone
                                    ? 'bg-moss border-moss text-paper'
                                    : 'border-hairline text-secondary'
                                }`}
                              >
                                {isDone ? '✓' : ''}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                              <span className="shrink-0 font-mono text-[10px] text-secondary/70">
                                {lesson.duration}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </nav>

              <div className="bg-card border border-hairline rounded-lg p-6">
                <div className="flex items-center gap-2 mb-1">
                  <TypeIcon type={currentLesson.type} />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                    {TYPE_META[currentLesson.type].label} · {currentLesson.duration}
                  </span>
                </div>
                <h3 className="font-display text-xl text-ink mb-4">{currentLesson.title}</h3>

                <LessonBody
                  key={currentLesson.id}
                  lesson={currentLesson}
                  selection={quizSelection}
                  onSelect={setQuizSelection}
                />

                <div className="flex items-center gap-2 mt-6 pt-4 border-t border-hairline">
                  <button
                    type="button"
                    onClick={markComplete}
                    disabled={currentLesson.type === 'quiz' && quizSelection === null}
                    className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {completedIds.has(currentLesson.id)
                      ? currentIndex + 1 < lessons.length
                        ? 'Next lesson'
                        : 'Done'
                      : currentIndex + 1 < lessons.length
                        ? 'Mark complete & continue'
                        : 'Mark complete'}
                  </button>
                  {currentIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => goToLesson(lessons[currentIndex - 1].id)}
                      className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
                    >
                      Previous
                    </button>
                  )}
                </div>

                {progress === 100 && (
                  <div className="mt-4 rounded-md border border-moss bg-moss/5 px-3 py-2">
                    <p className="text-sm text-ink">
                      All lessons complete —{' '}
                      <button
                        type="button"
                        onClick={() => navigate(`/courses/${id}`)}
                        className="text-moss font-medium hover:underline"
                      >
                        head back to record what you achieved
                      </button>
                      .
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function LessonBody({ lesson, selection, onSelect }) {
  const { body } = lesson

  if (lesson.type === 'video') {
    return (
      <div>
        <div className="aspect-video rounded-md bg-ink flex items-center justify-center mb-3">
          <div className="w-14 h-14 rounded-full bg-paper/90 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-ink)">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        <p className="text-sm text-ink">{body.description}</p>
      </div>
    )
  }

  if (lesson.type === 'reading') {
    return (
      <div className="space-y-3">
        {body.paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-ink leading-relaxed">
            {p}
          </p>
        ))}
      </div>
    )
  }

  if (lesson.type === 'exercise') {
    return (
      <div>
        <p className="text-sm text-ink mb-3">{body.description}</p>
        <div className="flex items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary shrink-0">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-sm text-ink flex-1 truncate">{body.resourceName}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-moss shrink-0">Download</span>
        </div>
      </div>
    )
  }

  // quiz
  const answered = selection !== null
  return (
    <div>
      <p className="text-sm text-ink mb-3">{body.question}</p>
      <div className="space-y-2 mb-3">
        {body.options.map((opt, i) => {
          const isCorrect = i === body.correctIndex
          const isSelected = i === selection
          let stateClass = 'border-hairline text-ink hover:bg-paper'
          if (answered && isSelected && isCorrect) stateClass = 'border-moss bg-moss/10 text-ink'
          else if (answered && isSelected && !isCorrect) stateClass = 'border-red-700 bg-red-50 text-ink'
          else if (answered && isCorrect) stateClass = 'border-moss text-ink'
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              disabled={answered}
              className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-default ${stateClass}`}
            >
              {opt}
            </button>
          )
        })}
      </div>
      {answered && <p className="text-sm text-secondary">{body.explanation}</p>}
    </div>
  )
}

function TypeIcon({ type }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'text-secondary shrink-0',
  }
  if (type === 'video') {
    return (
      <svg {...common}>
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </svg>
    )
  }
  if (type === 'reading') {
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    )
  }
  if (type === 'exercise') {
    return (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.7" />
      <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
    </svg>
  )
}
