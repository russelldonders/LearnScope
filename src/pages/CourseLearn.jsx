import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  listCourseResources,
  listContentProgress,
  markContentComplete,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from '../components/ScormPlayer'
import AppHeader from '../components/AppHeader'

const TYPE_LABELS = { video: 'Video', file: 'File', scorm: 'SCORM package' }

export default function CourseLearn() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [course, setCourse] = useState(null)
  const [items, setItems] = useState([])
  const [progressByItemId, setProgressByItemId] = useState({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [currentItemId, setCurrentItemId] = useState(null)

  useEffect(() => {
    load()
  }, [id])

  async function load() {
    setLoading(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('courses')
      .select('id, name, provider, catalogue_course_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setCourse(data)

    if (data.catalogue_course_id) {
      const contentItems = await listCourseResources(data.catalogue_course_id)
      setItems(contentItems)
      setProgressByItemId(await listContentProgress(user.id, contentItems.map((i) => i.id)))
      setCurrentItemId((prev) => prev ?? contentItems[0]?.id ?? null)
    }
    setLoading(false)
  }

  async function refreshProgress() {
    setProgressByItemId(await listContentProgress(user.id, items.map((i) => i.id)))
  }

  async function handleMarkComplete(item) {
    await markContentComplete(item.id, user.id)
    await refreshProgress()
    const next = items[currentIndex + 1]
    if (next) setCurrentItemId(next.id)
  }

  const currentIndex = items.findIndex((i) => i.id === currentItemId)
  const currentItem = items[currentIndex]
  const completedCount = items.filter((i) => progressByItemId[i.id]?.status && progressByItemId[i.id].status !== 'not_attempted').length
  const progress = items.length ? Math.round((completedCount / items.length) * 100) : 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Link to={`/courses/${id}`} className="text-sm text-secondary hover:text-ink mb-4 inline-block">
          ← Back to course
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}

        {course && items.length === 0 && !loading && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">
              {course.provider ? `${course.provider} hasn't` : "The provider hasn't"} added any content to this
              course yet.
            </p>
          </div>
        )}

        {course && currentItem && (
          <div>
            <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
              <h2 className="font-display text-2xl text-ink">{course.name}</h2>
              <p className="font-mono text-xs text-secondary shrink-0">
                {completedCount} / {items.length} complete
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-hairline overflow-hidden mb-8">
              <div className="h-full bg-moss rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>

            <div className="grid md:grid-cols-[280px_1fr] gap-6">
              <nav>
                <ul className="space-y-1">
                  {items.map((item) => {
                    const isCurrent = item.id === currentItem.id
                    const status = progressByItemId[item.id]?.status
                    const isDone = Boolean(status) && status !== 'not_attempted'
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setCurrentItemId(item.id)}
                          className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                            isCurrent
                              ? 'bg-card border border-moss text-ink'
                              : 'border border-transparent text-secondary hover:bg-card hover:text-ink'
                          }`}
                        >
                          <span
                            className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${
                              isDone ? 'bg-moss border-moss text-paper' : 'border-hairline text-secondary'
                            }`}
                          >
                            {isDone ? '✓' : ''}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </nav>

              <div className="bg-card border border-hairline rounded-lg p-6">
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
                  {TYPE_LABELS[currentItem.type]}
                </span>
                <h3 className="font-display text-xl text-ink mb-4">{currentItem.title}</h3>

                {currentItem.type === 'video' && (
                  <video
                    key={currentItem.id}
                    src={contentFileUrl(currentItem)}
                    controls
                    onEnded={() => handleMarkComplete(currentItem)}
                    className="w-full rounded-md bg-ink"
                  />
                )}

                {currentItem.type === 'file' && (
                  // download, not target="_blank" -- see CourseContentSection's
                  // matching comment: an unrestricted-type upload served
                  // same-origin must never be opened as a navigation.
                  <a
                    href={contentFileUrl(currentItem)}
                    download={currentItem.file_name || true}
                    className="flex items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2.5"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="text-sm text-ink flex-1 truncate">{currentItem.file_name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-moss shrink-0">
                      Download
                    </span>
                  </a>
                )}

                {currentItem.type === 'scorm' && (
                  <ScormPlayer
                    key={currentItem.id}
                    contentItem={currentItem}
                    userId={user.id}
                    onProgress={refreshProgress}
                  />
                )}

                <div className="flex items-center gap-2 mt-6 pt-4 border-t border-hairline">
                  {currentItem.type !== 'scorm' && (
                    <button
                      type="button"
                      onClick={() => handleMarkComplete(currentItem)}
                      className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
                    >
                      {progressByItemId[currentItem.id]?.status
                        ? currentIndex + 1 < items.length
                          ? 'Next'
                          : 'Done'
                        : currentIndex + 1 < items.length
                          ? 'Mark complete & continue'
                          : 'Mark complete'}
                    </button>
                  )}
                  {currentIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => setCurrentItemId(items[currentIndex - 1].id)}
                      className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
                    >
                      Previous
                    </button>
                  )}
                </div>

                {progress === 100 && (
                  <div className="mt-4 rounded-md border border-moss bg-moss/5 px-3 py-2">
                    <p className="text-sm text-ink">
                      All content complete —{' '}
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
