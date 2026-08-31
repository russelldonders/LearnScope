import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useIsDesktop } from '../lib/device'
import {
  listCourseSections,
  listCourseResources,
  listContentProgress,
  markContentComplete,
  contentFileUrl,
} from '../lib/courseContent'
import ScormPlayer from '../components/ScormPlayer'
import XapiPlayer from '../components/XapiPlayer'
import EditedVideoPlayer from '../components/EditedVideoPlayer'
import AppHeader from '../components/AppHeader'
import ProgressBar from '../components/ProgressBar'
import CourseModal from '../components/CourseModal'
import PageContent from '../components/PageContent'

const TYPE_LABELS = {
  video: 'Video',
  screen_recording: 'Screen recording',
  file: 'File',
  scorm: 'SCORM package',
  xapi: 'xAPI package',
  external_video: 'External video',
  web_url: 'Web link',
  page: 'Page',
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

// Player + complete/previous controls + the all-complete banner, shared by
// the md+ side pane (which wraps this with a card, type label and title)
// and the below-md inline accordion in the nav (already under the row
// showing the title, so it skips repeating it).
function CourseItemPlayer({
  item,
  userId,
  courseId,
  hasNext,
  hasPrevious,
  isComplete,
  progress,
  onMarkComplete,
  onPrevious,
  onProgress,
}) {
  return (
    <>
      {(item.type === 'video' || item.type === 'screen_recording') && (
        <EditedVideoPlayer key={item.id} resource={item} onEnded={onMarkComplete} className="w-full rounded-md bg-black" />
      )}

      {item.type === 'file' && (
        // download, not target="_blank" -- an unrestricted-type upload
        // served same-origin must never be opened as a navigation (same
        // reasoning as the provider editor's matching file-download link).
        <a
          href={contentFileUrl(item)}
          download={item.file_name || true}
          className="flex items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary shrink-0">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-sm text-ink flex-1 truncate">{item.file_name}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-moss shrink-0">Download</span>
        </a>
      )}

      {item.type === 'scorm' && (
        <ScormPlayer key={item.id} contentItem={item} userId={userId} onProgress={onProgress} />
      )}

      {item.type === 'xapi' && <XapiPlayer key={item.id} contentItem={item} userId={userId} courseId={courseId} />}

      {item.type === 'external_video' && (
        <iframe
          key={item.id}
          src={item.external_url}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full aspect-video rounded-md"
        />
      )}

      {item.type === 'web_url' && (
        <a
          href={item.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-paper px-4 py-3 text-sm text-ink hover:border-moss"
        >
          <span className="min-w-0 truncate">{item.external_url}</span>
          <span className="font-medium text-moss shrink-0">Open link ↗</span>
        </a>
      )}

      {item.type === 'page' && <PageContent document={item.page_content} />}

      <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-hairline">
        {hasPrevious ? (
          <button
            type="button"
            onClick={onPrevious}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
          >
            Previous
          </button>
        ) : (
          <span />
        )}
        {item.type !== 'scorm' && (
          <button
            type="button"
            onClick={onMarkComplete}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
          >
            {isComplete ? (hasNext ? 'Next' : 'Done') : hasNext ? 'Mark complete & continue' : 'Mark complete'}
          </button>
        )}
      </div>

      {progress === 100 && (
        <div className="mt-4 rounded-md border border-moss bg-moss/5 px-3 py-2">
          <p className="text-sm text-ink">All content complete.</p>
        </div>
      )}
    </>
  )
}

function Chevron({ open, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${className}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export default function CourseLearn() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const backTo = location.state?.backTo ?? '/learning'
  const backLabel = location.state?.backLabel ? `← Back to ${location.state.backLabel}` : '← Back to Learning'

  const [course, setCourse] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [sections, setSections] = useState([])
  const [items, setItems] = useState([])
  const [progressByItemId, setProgressByItemId] = useState({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [currentItemId, setCurrentItemId] = useState(null)
  // Below md the content opens inline in the nav (an accordion under the
  // clicked item) instead of the side pane used at md+ -- see the provider
  // course editor's own outline for the same pattern. Kept separate from
  // currentItemId (which drives Next/Previous, completion tracking and nav
  // highlighting, and must stay set for the page to render at all) so
  // collapsing the accordion on mobile can't blank the whole page.
  const [expandedItemId, setExpandedItemId] = useState(null)
  // All sections start open, and any number can stay open at once -- not an
  // accordion. Below md, an open item goes further into "focus mode":
  // everything else in the nav (other sections, other items) hides so only
  // that item's row and its player are visible, scrolled to the top of the
  // screen; collapsing it brings the outline back.
  const [openSectionKeys, setOpenSectionKeys] = useState(() => new Set())
  const isDesktop = useIsDesktop()

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
      setOpenSectionKeys((prev) => (prev.size > 0 ? prev : new Set([...sectionRows.map((s) => s.id), 'ungrouped'])))
    }
    setLoading(false)
  }

  // A freeform course (no catalogue link) has no provider/creator, so its
  // owner keeps basic record control (rename/notes/delete) from here.
  const canEditBasics = !course?.catalogue_course_id

  async function handleSaveCourse({ id: _id, ...fields }) {
    const { error } = await supabase.from('courses').update(fields).eq('id', id)
    if (error) throw error
    await load()
    setEditOpen(false)
  }

  async function handleDeleteCourse() {
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (error) throw error
    navigate('/learning')
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
      if (bySection.has(section.id)) {
        groups.push({ key: section.id, title: section.title, instructions: section.instructions, items: bySection.get(section.id) })
      }
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
    if (next) selectItem(next.id)
  }

  // Sets the "current" item (Next/Previous, completion tracking, nav
  // highlighting), keeps the mobile accordion open on whatever item is now
  // current if it was already open (so "Mark complete & continue" and
  // Previous carry it along instead of leaving it open on the item you
  // just left), and opens that item's section if a "continue" jumped into
  // a different one.
  function selectItem(itemId) {
    setCurrentItemId(itemId)
    setExpandedItemId((current) => (current === null ? null : itemId))
    const item = orderedItems.find((i) => i.id === itemId)
    if (item) {
      const key = item.sectionId ?? 'ungrouped'
      setOpenSectionKeys((current) => (current.has(key) ? current : new Set(current).add(key)))
    }
  }

  function handleNavClick(item) {
    setCurrentItemId(item.id)
    if (isDesktop) return
    setExpandedItemId((current) => (current === item.id ? null : item.id))
  }

  function toggleSection(key) {
    setOpenSectionKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const currentIndex = orderedItems.findIndex((i) => i.id === currentItemId)
  const currentItem = orderedItems[currentIndex]
  const currentSection = sections.find((section) => section.id === currentItem?.sectionId)
  const completedCount = orderedItems.filter(
    (i) => progressByItemId[i.id]?.status && progressByItemId[i.id].status !== 'not_attempted'
  ).length
  const progress = orderedItems.length ? Math.round((completedCount / orderedItems.length) * 100) : 0
  const isFocused = !isDesktop && expandedItemId !== null

  useEffect(() => {
    if (!expandedItemId) return
    document.getElementById(`nav-item-${expandedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [expandedItemId])

  function renderItemRow(item) {
    const isCurrent = item.id === currentItem.id
    const status = progressByItemId[item.id]?.status
    const isDone = Boolean(status) && status !== 'not_attempted'
    const isExpanded = !isDesktop && expandedItemId === item.id
    const itemIndex = orderedItems.findIndex((i) => i.id === item.id)
    return (
      <li key={item.id} id={`nav-item-${item.id}`}>
        <button
          type="button"
          onClick={() => handleNavClick(item)}
          aria-expanded={isExpanded}
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
          <Chevron open={isExpanded} className="md:hidden" />
        </button>
        {isExpanded && (
          <div className="mt-1 mb-1 bg-card border border-hairline rounded-lg p-4">
            {currentSection?.instructions && (
              <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">{currentSection.instructions}</p>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
              {TYPE_LABELS[item.type]}
            </span>
            <CourseItemPlayer
              item={item}
              userId={user.id}
              courseId={course.id}
              hasNext={itemIndex + 1 < orderedItems.length}
              hasPrevious={itemIndex > 0}
              isComplete={Boolean(status)}
              progress={progress}
              onMarkComplete={() => handleMarkComplete(item)}
              onPrevious={() => selectItem(orderedItems[itemIndex - 1].id)}
              onProgress={refreshProgress}
            />
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <Link to={backTo} className="text-sm text-secondary hover:text-ink mb-4 inline-block">
          {backLabel}
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}

        {course && (
          <div className="flex items-center justify-between gap-4 flex-wrap mb-2">
            <h1 className="font-display text-2xl text-ink">{course.name}</h1>
            <div className="flex items-center gap-3 shrink-0">
              {currentItem && (
                <p className="font-mono text-xs text-secondary">
                  {completedCount} / {orderedItems.length} complete
                </p>
              )}
              {canEditBasics && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  title="Edit course"
                  aria-label="Edit course"
                  className="w-8 h-8 rounded-md border border-hairline text-secondary hover:text-ink hover:bg-paper flex items-center justify-center"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {course && orderedItems.length === 0 && !loading && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">
              {course.catalogue_course_id
                ? `${course.provider ? `${course.provider} hasn't` : "The provider hasn't"} added any content to this course yet.`
                : "This is a personal record — there's no course content to work through here."}
            </p>
          </div>
        )}

        {course && currentItem && (
          <div>
            <ProgressBar percent={progress} className="mb-8" />

            <div className="grid md:grid-cols-[280px_1fr] gap-6">
              <nav>
                {isFocused ? (
                  <ul className="space-y-1">{renderItemRow(currentItem)}</ul>
                ) : (
                  groupedNav.map((group) => {
                    const isOpen = openSectionKeys.has(group.key)
                    return (
                      <div key={group.key} className="mb-4 last:mb-0">
                        {group.title && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleSection(group.key)}
                              aria-expanded={isOpen}
                              className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1 mb-1 font-mono text-[10px] uppercase tracking-wide text-secondary hover:text-ink"
                            >
                              <span className="truncate">{group.title}</span>
                              <Chevron open={isOpen} />
                            </button>
                            {isOpen && group.instructions && (
                              <p className="px-2.5 pb-2 whitespace-pre-wrap text-xs leading-relaxed text-secondary">
                                {group.instructions}
                              </p>
                            )}
                          </>
                        )}
                        {(isOpen || !group.title) && (
                          <ul className="space-y-1">{group.items.map((item) => renderItemRow(item))}</ul>
                        )}
                      </div>
                    )
                  })
                )}
              </nav>

              {isDesktop && (
                <div className="bg-card border border-hairline rounded-lg p-6">
                  {currentSection?.instructions && (
                    <p className="mb-5 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
                      {currentSection.instructions}
                    </p>
                  )}
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
                    {TYPE_LABELS[currentItem.type]}
                  </span>
                  <h3 className="font-display text-xl text-ink mb-4">{currentItem.title}</h3>
                  <CourseItemPlayer
                    item={currentItem}
                    userId={user.id}
                    courseId={course.id}
                    hasNext={currentIndex + 1 < orderedItems.length}
                    hasPrevious={currentIndex > 0}
                    isComplete={Boolean(progressByItemId[currentItem.id]?.status)}
                    progress={progress}
                    onMarkComplete={() => handleMarkComplete(currentItem)}
                    onPrevious={() => selectItem(orderedItems[currentIndex - 1].id)}
                    onProgress={refreshProgress}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {editOpen && course && (
          <CourseModal
            restricted
            course={course}
            skills={[]}
            librarySkills={[]}
            onSave={handleSaveCourse}
            onDelete={handleDeleteCourse}
            onClose={() => setEditOpen(false)}
          />
        )}
      </main>
    </div>
  )
}
