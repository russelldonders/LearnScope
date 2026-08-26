import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  listCourseSections,
  listCourseResources,
  listContentProgress,
  markContentComplete,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from '../components/ScormPlayer'
import XapiPlayer from '../components/XapiPlayer'
import AppHeader from '../components/AppHeader'

const TYPE_LABELS = {
  video: 'Video',
  file: 'File',
  scorm: 'SCORM package',
  xapi: 'xAPI package',
  external_video: 'External video',
}

// Items come back ordered by their own `position`, which only resets to 0
// within each section (see courseContent.js's nextLinkPosition) -- sorting
// by (section position, item position) re-interleaves them correctly for a
// multi-section course, rather than relying on row order alone. Shared by
// both the initial "first item" pick in load() and the orderedItems memo,
// so the item chosen as current on first load always matches what actually
// renders first in the nav/right pane.
function sortBySection(contentItems, sectionRows) {
  const positionById = new Map(sectionRows.map((s) => [s.id, s.position]))
  return [...contentItems].sort((a, b) => {
    const posA = a.sectionId ? (positionById.get(a.sectionId) ?? Infinity) : Infinity
    const posB = b.sectionId ? (positionById.get(b.sectionId) ?? Infinity) : Infinity
    return posA !== posB ? posA - posB : a.position - b.position
  })
}

export default function CourseLearn() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [course, setCourse] = useState(null)
  const [sections, setSections] = useState([])
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
      const [sectionRows, contentItems] = await Promise.all([
        listCourseSections(data.catalogue_course_id),
        listCourseResources(data.catalogue_course_id),
      ])
      setSections(sectionRows)
      setItems(contentItems)
      setProgressByItemId(await listContentProgress(user.id, contentItems.map((i) => i.id)))
      const firstItem = sortBySection(contentItems, sectionRows)[0]
      setCurrentItemId((prev) => prev ?? firstItem?.id ?? null)
    }
    setLoading(false)
  }

  async function refreshProgress() {
    setProgressByItemId(await listContentProgress(user.id, items.map((i) => i.id)))
  }

  const orderedItems = useMemo(() => sortBySection(items, sections), [items, sections])

  // Groups the nav by section, in section order, with anything left
  // ungrouped (no section, or its section was deleted) trailing at the end
  // -- a course with no sections at all (shouldn't normally happen once
  // every course has at least a "General" one, see 0078's backfill) just
  // renders as one unlabeled group, same as the old flat list.
  const groupedNav = useMemo(() => {
    const bySection = new Map()
    for (const item of orderedItems) {
      const key = item.sectionId ?? 'ungrouped'
      if (!bySection.has(key)) bySection.set(key, [])
      bySection.get(key).push(item)
    }
    const groups = []
    for (const section of sections) {
      if (bySection.has(section.id)) groups.push({ key: section.id, title: section.title, items: bySection.get(section.id) })
    }
    if (bySection.has('ungrouped')) {
      groups.push({ key: 'ungrouped', title: sections.length > 0 ? 'Other' : null, items: bySection.get('ungrouped') })
    }
    return groups
  }, [orderedItems, sections])

  async function handleMarkComplete(item) {
    await markContentComplete(item.id, user.id)
    await refreshProgress()
    const next = orderedItems[currentIndex + 1]
    if (next) setCurrentItemId(next.id)
  }

  const currentIndex = orderedItems.findIndex((i) => i.id === currentItemId)
  const currentItem = orderedItems[currentIndex]
  const completedCount = orderedItems.filter(
    (i) => progressByItemId[i.id]?.status && progressByItemId[i.id].status !== 'not_attempted'
  ).length
  const progress = orderedItems.length ? Math.round((completedCount / orderedItems.length) * 100) : 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Link to={`/courses/${id}`} className="text-sm text-secondary hover:text-ink mb-4 inline-block">
          ← Back to course
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}

        {course && orderedItems.length === 0 && !loading && (
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
                {completedCount} / {orderedItems.length} complete
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-hairline overflow-hidden mb-8">
              <div className="h-full bg-moss rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>

            <div className="grid md:grid-cols-[280px_1fr] gap-6">
              <nav>
                {groupedNav.map((group) => (
                  <div key={group.key} className="mb-4 last:mb-0">
                    {group.title && (
                      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary px-2.5 mb-1">
                        {group.title}
                      </p>
                    )}
                    <ul className="space-y-1">
                      {group.items.map((item) => {
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
                  </div>
                ))}
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
                    className="w-full rounded-md bg-black"
                  />
                )}

                {currentItem.type === 'file' && (
                  // download, not target="_blank" -- an unrestricted-type
                  // upload served same-origin must never be opened as a
                  // navigation (same reasoning as the provider editor's
                  // matching file-download link).
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

                {currentItem.type === 'xapi' && (
                  <XapiPlayer key={currentItem.id} contentItem={currentItem} userId={user.id} courseId={course.id} />
                )}

                {currentItem.type === 'external_video' && (
                  <iframe
                    key={currentItem.id}
                    src={currentItem.external_url}
                    title={currentItem.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full aspect-video rounded-md"
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
                        ? currentIndex + 1 < orderedItems.length
                          ? 'Next'
                          : 'Done'
                        : currentIndex + 1 < orderedItems.length
                          ? 'Mark complete & continue'
                          : 'Mark complete'}
                    </button>
                  )}
                  {currentIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => setCurrentItemId(orderedItems[currentIndex - 1].id)}
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
