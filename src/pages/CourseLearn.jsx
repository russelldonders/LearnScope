import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useIsDesktop } from '../lib/device'
import {
  listCourseSections,
  listCourseResources,
  listContentProgress,
  markContentComplete,
  saveContentScore,
  contentFileUrl,
} from '../lib/courseContent'
import {
  completeMyCourse,
  getCourseCohort,
  getCourseCompletionPolicy,
  cohortDisplayName,
  formatCohortDateTime,
} from '../lib/courseCatalogue'
import { RESOURCE_TYPE_LABELS } from '../lib/statusLabels'
import ScormPlayer from '../components/ScormPlayer'
import XapiPlayer from '../components/XapiPlayer'
import Cmi5Player from '../components/Cmi5Player'
import LtiPlayer from '../components/LtiPlayer'
import EditedVideoPlayer from '../components/EditedVideoPlayer'
import AppHeader from '../components/AppHeader'
import BackLink from '../components/BackLink'
import ProgressBar from '../components/ProgressBar'
import CourseModal from '../components/CourseModal'
import PageContent from '../components/PageContent'
import { pageHasScoredTest } from '../lib/pageBuilder'
import Chevron from '../components/Chevron'
import { useLanguage } from '../context/LanguageContext'
import { getGoogleConnection, launchGoogleMeet, listGoogleMeetDetails, listMySessionAttendance, startGoogleMeetConnection, syncGoogleMeetAttendance } from '../lib/googleMeet'

// The fixed back-link labels callers pass in location.state (everything else
// they pass is a record's own name, shown as-is).
const BACK_LABEL_KEYS = { Dashboard: 'dashboard', Learning: 'learning', Training: 'training' }

export function isContentComplete(status) {
  return status === 'completed' || status === 'passed' || status === 'failed'
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
// onDone: what "Done" does -- shown on the last item once it's complete --
// when the course is open over another page (close it); without it, Done
// just records the item as complete, as before.
export function CourseItemPlayer({
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
  pageNumber,
  pageCount,
  onDone = null,
}) {
  const { t } = useLanguage()
  const isPageCourse = pageCount > 0
  const showsDone = isComplete && !hasNext
  const isScoredPage = item.type === 'page' && pageHasScoredTest(item.page_content)
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
          <span className="font-mono text-[10px] uppercase tracking-wide text-moss shrink-0">{t('courseLearn.download')}</span>
        </a>
      )}

      {item.type === 'scorm' && (
        <ScormPlayer key={item.id} contentItem={item} userId={userId} onProgress={onProgress} />
      )}

      {item.type === 'xapi' && <XapiPlayer key={item.id} contentItem={item} userId={userId} courseId={courseId} />}

      {item.type === 'cmi5' && <Cmi5Player key={item.id} contentItem={item} userId={userId} courseId={courseId} />}

      {item.type === 'lti' && <LtiPlayer key={item.id} contentItem={item} userId={userId} courseId={courseId} />}

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
          <span className="font-medium text-moss shrink-0">{t('courseLearn.openLink')}</span>
        </a>
      )}

      {item.type === 'page' && <PageContent key={item.id} document={item.page_content} onScore={async ({ score, passed }) => { await saveContentScore(item.id, userId, score, passed); await onProgress() }} />}

      {isPageCourse && (
        <p className="mt-6 text-center font-mono text-xs text-secondary">
          {t('courseLearn.pagePosition', { current: pageNumber, total: pageCount })}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-hairline">
        {hasPrevious ? (
          <button
            type="button"
            onClick={onPrevious}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
          >
            {isPageCourse ? t('courseLearn.previousPage') : t('courseLearn.previous')}
          </button>
        ) : (
          <span />
        )}
        {item.type !== 'scorm' && (!isScoredPage || isComplete) && (
          <button
            type="button"
            onClick={showsDone && onDone ? onDone : onMarkComplete}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
          >
            {/* A page is done once read, so moving on is just "Next page"
                (it's still recorded as complete). */}
            {isPageCourse
              ? hasNext
                ? t('courseLearn.nextPage')
                : (isComplete ? t('courseLearn.done') : t('courseLearn.completePage'))
              : isComplete
                ? (hasNext ? t('courseLearn.next') : t('courseLearn.done'))
                : hasNext ? t('courseLearn.markCompleteContinue') : t('courseLearn.markComplete')}
          </button>
        )}
        {isScoredPage && !isComplete && <p className="text-sm text-secondary">Submit the test above to complete this page.</p>}
      </div>

      {progress === 100 && (
        <div className="mt-4 rounded-md border border-moss bg-moss/5 px-3 py-2">
          <p className="text-sm text-ink">{t('courseLearn.allComplete')}</p>
        </div>
      )}
    </>
  )
}

// inOverlay: shown inside a FullScreenOverlay (CourseOverlay) over another
// page, which gives the course's title and the way back -- so no app header,
// back link, title or course editing here (deleting would leave the page).
// onProgressChange: told { done, total, percent } as the learner works
// through the course (null when there's nothing to work through), for the
// overlay to show in its own header instead of here. onDone: what the last
// item's Done button does in an overlay (close it).
export default function CourseLearn({ courseId: courseIdProp = null, embeddedScorm = false, inOverlay = false, onProgressChange = null, onDone = null }) {
  const { id: routeCourseId } = useParams()
  const id = courseIdProp ?? routeCourseId
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const backTo = location.state?.backTo ?? '/learning'
  const { t } = useLanguage()
  const rawBackLabel = location.state?.backLabel ?? 'Learning'
  const backLabel = t('courseLearn.backTo', {
    label: BACK_LABEL_KEYS[rawBackLabel] ? t(`courseLearn.backLabels.${BACK_LABEL_KEYS[rawBackLabel]}`) : rawBackLabel,
  })
  // Translated where known; the shared English map covers any other type.
  const resourceTypeLabel = (type) => {
    const key = `courseLearn.resourceTypes.${type}`
    const label = t(key)
    return label === key ? RESOURCE_TYPE_LABELS[type] : label
  }

  const [course, setCourse] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [sections, setSections] = useState([])
  const [items, setItems] = useState([])
  const [progressByItemId, setProgressByItemId] = useState({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [currentItemId, setCurrentItemId] = useState(null)
  const [scormResumeItemId, setScormResumeItemId] = useState(null)
  const [completionPolicy, setCompletionPolicy] = useState('all_content')
  const [completionError, setCompletionError] = useState(null)
  const [completingCourse, setCompletingCourse] = useState(false)
  const completionAttemptedRef = useRef(false)
  // Below md the content opens inline in the nav (an accordion under the
  // clicked item) instead of the side pane used at md+ -- see the provider
  // course editor's own outline for the same pattern. Kept separate from
  // currentItemId (which drives Next/Previous, completion tracking and nav
  // highlighting, and must stay set for the page to render at all) so
  // collapsing the accordion on mobile can't blank the whole page.
  const [expandedItemId, setExpandedItemId] = useState(null)
  // Only the current item's section is open; moving into another section
  // closes the rest (the learner can still open others to look ahead), so
  // the outline stays short. Below md, an open item goes further into
  // "focus mode":
  // everything else in the nav (other sections, other items) hides so only
  // that item's row and its player are visible, scrolled to the top of the
  // screen; collapsing it brings the outline back.
  const [openSectionKeys, setOpenSectionKeys] = useState(() => new Set())
  const isDesktop = useIsDesktop()
  // Only set when this enrolment is linked to a specific cohort
  // (courses.cohort_id, 20260902270000) -- shows that cohort's own schedule
  // so an enrolled learner can see when their live sessions actually are.
  const [cohort, setCohort] = useState(null)
  const [sessionMeetings, setSessionMeetings] = useState(new Map())
  const [sessionAttendance, setSessionAttendance] = useState(new Map())
  const [googleConnection, setGoogleConnection] = useState(null)
  const [meetingBusyId, setMeetingBusyId] = useState(null)
  const [meetingError, setMeetingError] = useState(null)
  const attendanceSyncAttemptedRef = useRef(new Set())

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [id])

  useEffect(() => {
    if (!embeddedScorm) return undefined
    function receiveScormContext(event) {
      if (event.source !== window.parent || event.data?.type !== 'learnscope.scorm.context') return
      let suspend = null
      try { suspend = JSON.parse(event.data.state?.suspendData || 'null') } catch { /* A host LMS may contain older plain-text state. */ }
      setScormResumeItemId(suspend?.itemId || event.data.state?.location || null)
    }
    window.addEventListener('message', receiveScormContext)
    window.parent.postMessage({ type: 'learnscope.scorm.ready', version: 1 }, '*')
    return () => window.removeEventListener('message', receiveScormContext)
  }, [embeddedScorm])

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
    completionAttemptedRef.current = false

    if (data.catalogue_course_id) {
      const [sectionRows, contentItems, policy] = await Promise.all([
        listCourseSections(data.catalogue_course_id),
        listCourseResources(data.catalogue_course_id),
        getCourseCompletionPolicy(data.catalogue_course_id),
      ])
      setCompletionPolicy(policy)
      setSections(sectionRows)
      setItems(contentItems)
      setProgressByItemId(await listContentProgress(user.id, contentItems.map((i) => i.id)))
      const firstItem = sortBySection(contentItems, sectionRows)[0]
      setCurrentItemId((prev) => prev ?? firstItem?.id ?? null)
    }

    const cohortRow = data.cohort_id ? await getCourseCohort(data.cohort_id) : null
    setCohort(cohortRow)
    const sessionIds = cohortRow?.sessions.map((session) => session.id) ?? []
    if (sessionIds.length > 0) {
      const [meetingRows, attendanceRows, connection] = await Promise.all([
        listGoogleMeetDetails(sessionIds),
        listMySessionAttendance(sessionIds, user.id),
        getGoogleConnection(),
      ])
      setSessionMeetings(meetingRows)
      setSessionAttendance(attendanceRows)
      setGoogleConnection(connection)
    } else {
      setSessionMeetings(new Map())
      setSessionAttendance(new Map())
      setGoogleConnection(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!cohort || sessionMeetings.size === 0) return
    const dueSessionIds = cohort.sessions
      .filter((session) => session.ends_at && new Date(session.ends_at) <= new Date() && sessionMeetings.has(session.id))
      .map((session) => session.id)
      .filter((sessionId) => !attendanceSyncAttemptedRef.current.has(sessionId))
    if (dueSessionIds.length === 0) return
    dueSessionIds.forEach((sessionId) => attendanceSyncAttemptedRef.current.add(sessionId))
    Promise.allSettled(dueSessionIds.map((sessionId) => syncGoogleMeetAttendance(sessionId)))
      .then(() => listMySessionAttendance(cohort.sessions.map((session) => session.id), user.id))
      .then(setSessionAttendance)
      .catch(() => {})
  }, [cohort, sessionMeetings, user.id])

  async function handleConnectGoogle() {
    setMeetingError(null)
    try {
      await startGoogleMeetConnection(`${window.location.pathname}${window.location.search}`)
    } catch (err) {
      setMeetingError(err.message)
    }
  }

  async function handleJoinMeeting(sessionId) {
    setMeetingBusyId(sessionId)
    setMeetingError(null)
    try {
      await launchGoogleMeet(sessionId)
    } catch (err) {
      setMeetingError(err.message)
      setMeetingBusyId(null)
    }
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
  const isPageCourse = orderedItems.length > 0 && orderedItems.every((item) => item.type === 'page')

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
      groups.push({ key: 'ungrouped', title: sections.length > 0 ? t('courseLearn.otherSection') : null, items: bySection.get('ungrouped') })
    }
    return groups
  }, [orderedItems, sections, t])

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
  // just left). Its section opens through currentSectionKey below.
  function selectItem(itemId) {
    setCurrentItemId(itemId)
    setExpandedItemId((current) => (current === null ? null : itemId))
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
    (i) => isContentComplete(progressByItemId[i.id]?.status)
  ).length
  const progress = orderedItems.length ? Math.round((completedCount / orderedItems.length) * 100) : 0
  const isFocused = !isDesktop && expandedItemId !== null

  const hasContent = Boolean(currentItem)
  useEffect(() => {
    onProgressChange?.(hasContent ? { done: completedCount, total: orderedItems.length, percent: progress } : null)
    // Reported when the numbers change, not when the callback's identity does.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContent, completedCount, orderedItems.length, progress])

  // Whenever the current item moves into another section, that section is
  // the one open in the outline. Adjusted while rendering (not in an effect)
  // so the outline never shows a frame with the wrong sections open.
  const currentSectionKey = currentItem ? (currentItem.sectionId ?? 'ungrouped') : null
  const [openedForSection, setOpenedForSection] = useState(null)
  if (currentSectionKey !== openedForSection) {
    setOpenedForSection(currentSectionKey)
    if (currentSectionKey) setOpenSectionKeys(new Set([currentSectionKey]))
  }

  // Moving to another item (Next, Previous, or the outline) starts it from
  // its top, rather than leaving the view where the last one ended. Inside
  // an overlay this scrolls the overlay; on its own page, the page. Below md
  // the accordion effect further down does the same for the open row.
  const contentTopRef = useRef(null)
  const previousItemIdRef = useRef(null)
  useEffect(() => {
    const previous = previousItemIdRef.current
    previousItemIdRef.current = currentItemId
    if (!isDesktop || !previous || !currentItemId || previous === currentItemId) return
    contentTopRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [currentItemId, isDesktop])

  useEffect(() => {
    if (
      completionPolicy !== 'all_content'
      || course?.completed_date
      || orderedItems.length === 0
      || completedCount !== orderedItems.length
      || completionAttemptedRef.current
    ) return
    completionAttemptedRef.current = true
    setCompletingCourse(true)
    setCompletionError(null)
    completeMyCourse(id)
      .then((completedDate) => setCourse((current) => ({ ...current, completed_date: completedDate })))
      .catch((err) => {
        completionAttemptedRef.current = false
        setCompletionError(err.message)
      })
      .finally(() => setCompletingCourse(false))
  }, [completionPolicy, course?.completed_date, orderedItems.length, completedCount, id])

  async function handleCompleteCourse() {
    setCompletingCourse(true)
    setCompletionError(null)
    try {
      const completedDate = await completeMyCourse(id)
      setCourse((current) => ({ ...current, completed_date: completedDate }))
    } catch (err) {
      setCompletionError(err.message)
    } finally {
      setCompletingCourse(false)
    }
  }

  useEffect(() => {
    if (!embeddedScorm || !scormResumeItemId || !orderedItems.some((item) => item.id === scormResumeItemId)) return
    selectItem(scormResumeItemId)
    setScormResumeItemId(null)
    // selectItem is intentionally local to this screen and recreated each render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [embeddedScorm, orderedItems, scormResumeItemId])

  useEffect(() => {
    if (!embeddedScorm || loading || !course) return
    const status = course.completed_date || progress === 100 ? 'completed' : completedCount > 0 ? 'incomplete' : 'not attempted'
    window.parent.postMessage({
      type: 'learnscope.scorm.progress',
      version: 1,
      status,
      score: progress,
      location: currentItemId ?? '',
      suspendData: JSON.stringify({ itemId: currentItemId, progress }),
    }, '*')
  }, [embeddedScorm, loading, course, progress, completedCount, currentItemId])

  useEffect(() => {
    if (!expandedItemId) return
    document.getElementById(`nav-item-${expandedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [expandedItemId])

  function renderItemRow(item) {
    const isCurrent = item.id === currentItem.id
    const status = progressByItemId[item.id]?.status
    const isDone = isContentComplete(status)
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
          <span className="min-w-0 flex-1 line-clamp-2 leading-snug" title={item.title}>{item.title}</span>
          <Chevron open={isExpanded} className="md:hidden" />
        </button>
        {isExpanded && (
          <div className="mt-1 mb-1 bg-card border border-hairline rounded-lg p-4">
            {currentSection?.instructions && (
              <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">{currentSection.instructions}</p>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1 block">
              {resourceTypeLabel(item.type)}
            </span>
            <CourseItemPlayer
              item={item}
              userId={user.id}
              courseId={course.id}
              hasNext={itemIndex + 1 < orderedItems.length}
              hasPrevious={itemIndex > 0}
              isComplete={isContentComplete(status)}
              progress={progress}
              onMarkComplete={() => handleMarkComplete(item)}
              onDone={onDone}
              onPrevious={() => selectItem(orderedItems[itemIndex - 1].id)}
              onProgress={refreshProgress}
              pageNumber={isPageCourse ? itemIndex + 1 : 0}
              pageCount={isPageCourse ? orderedItems.length : 0}
            />
          </div>
        )}
      </li>
    )
  }

  // The overlay's own page has the main landmark already.
  const Main = inOverlay ? 'div' : 'main'
  const bare = embeddedScorm || inOverlay

  return (
    <div className={inOverlay ? 'bg-paper min-h-full' : 'min-h-screen bg-paper'}>
      {!bare && <AppHeader />}
      <Main
        {...(inOverlay ? {} : { id: 'main-content', tabIndex: -1 })}
        className={`max-w-5xl mx-auto px-4 ${bare ? 'py-5' : 'py-8'}`}
      >
        {/* Back to whatever opened this course: a page that said so, else
            the previous page in the app, else Learning. */}
        {!bare && (
          <BackLink
            to={location.state?.backTo ?? null}
            label={backLabel}
            fallbackTo={backTo}
            fallbackLabel={backLabel}
            className="text-sm text-secondary hover:text-ink mb-4 inline-block"
          />
        )}

        {loading && <p className="text-secondary">{t('common.loading')}</p>}
        {notFound && <p className="text-secondary">{t('courseLearn.notFound')}</p>}

        {/* In an overlay, its header carries the title and progress. */}
        {course && !inOverlay && (
          <div className="flex items-center gap-4 flex-wrap mb-2 justify-between">
            <h1 className="font-display text-2xl text-ink">{course.name}</h1>
            <div className="flex items-center gap-3 shrink-0">
              {currentItem && (
                <p className="font-mono text-xs text-secondary">
                  {t('courseLearn.completeCount', { done: completedCount, total: orderedItems.length })}
                </p>
              )}
              {canEditBasics && !bare && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  title={t('courseLearn.editCourse')}
                  aria-label={t('courseLearn.editCourse')}
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

        {cohort && (
          <div className="bg-card border border-hairline rounded-lg p-4 mb-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{cohortDisplayName(cohort)}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {cohort.start_date ? t('courseLearn.startedOn', { date: formatCohortDateTime(cohort.start_date) }) : t('courseLearn.startTbc')}
                </p>
              </div>
              {sessionMeetings.size > 0 && googleConnection?.status !== 'active' && (
                <button type="button" onClick={handleConnectGoogle} className="shrink-0 text-left text-xs font-medium text-moss underline decoration-hairline underline-offset-4 hover:decoration-current sm:text-right">
                  {googleConnection ? 'Reconnect Google to match attendance' : 'Connect Google to match attendance'}
                </button>
              )}
            </div>
            {meetingError && <p role="alert" className="mt-2 text-xs text-red-700">{meetingError}</p>}
            {cohort.sessions.length > 0 ? (
              <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
                {cohort.sessions.map((session) => (
                  <li key={session.id} className="flex flex-col gap-2 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p>
                        {new Date(session.starts_at).toLocaleString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                        {session.title ? ` · ${session.title}` : ''}
                      </p>
                      {sessionAttendance.has(session.id) && (
                        <p className="mt-0.5 text-xs text-secondary">
                          Attendance: <span className="font-mono tabular-nums text-ink">{Number(sessionAttendance.get(session.id).attendance_percent).toFixed(1)}%</span>
                          {' · '}{sessionAttendance.get(session.id).calculation_status === 'final' ? 'Final' : 'Provisional'}
                        </p>
                      )}
                      {!sessionMeetings.has(session.id) && session.location_or_link && (
                        /^https?:\/\//i.test(session.location_or_link) ? (
                          <a href={session.location_or_link} target="_blank" rel="noopener noreferrer" className="mt-0.5 block break-words text-xs text-moss underline decoration-hairline underline-offset-4 hover:decoration-current">
                            Open meeting link <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        ) : <span className="block text-xs text-secondary mt-0.5 break-words">{session.location_or_link}</span>
                      )}
                    </div>
                    {sessionMeetings.has(session.id) && (
                      <button type="button" disabled={meetingBusyId === session.id} onClick={() => handleJoinMeeting(session.id)} className="shrink-0 rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">
                        {meetingBusyId === session.id ? 'Opening…' : 'Join Google Meet'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-secondary mt-2">{t('courseLearn.noSessions')}</p>
            )}
          </div>
        )}

        {course && orderedItems.length === 0 && !loading && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">
              {course.catalogue_course_id
                ? (course.provider ? t('courseLearn.noContentProvider', { provider: course.provider }) : t('courseLearn.noContentGeneric'))
                : t('courseLearn.personalRecord')}
            </p>
          </div>
        )}

        {course && currentItem && (
          <div>
            {!inOverlay && <ProgressBar percent={progress} className="mb-4" />}
            <div className="mb-8 flex items-start justify-between gap-4 border-b border-hairline pb-4 max-sm:flex-col">
              <div>
                <p className="text-sm font-medium text-ink">
                  {course.completed_date
                    ? t('courseLearn.courseCompleted')
                    : completionPolicy === 'manual'
                      ? t('courseLearn.manualCompletion')
                      : t('courseLearn.allContentCompletion')}
                </p>
                <p className="mt-0.5 text-xs text-secondary">
                  {course.completed_date
                    ? t('courseLearn.completedOn', { date: new Date(`${course.completed_date}T00:00:00`).toLocaleDateString() })
                    : completionPolicy === 'manual'
                      ? t('courseLearn.manualCompletionHint')
                      : t('courseLearn.allContentCompletionHint')}
                </p>
                {completionError && <p role="alert" className="mt-1 text-sm text-red-700">{completionError}</p>}
              </div>
              {completionPolicy === 'manual' && !course.completed_date && (
                <button
                  type="button"
                  onClick={handleCompleteCourse}
                  disabled={completingCourse}
                  className="shrink-0 rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
                >
                  {completingCourse ? t('courseLearn.completingCourse') : t('courseLearn.markCourseComplete')}
                </button>
              )}
            </div>

            <div ref={contentTopRef} className="grid md:grid-cols-[280px_1fr] gap-6">
              <nav>
                {isFocused ? (
                  <ul className="space-y-1">{renderItemRow(currentItem)}</ul>
                ) : (
                  // Three levels, each clearly its own: the section (numbered,
                  // its title in the body font with its own progress), a short,
                  // quieter description, then its items indented beneath.
                  groupedNav.map((group, index) => {
                    const isOpen = openSectionKeys.has(group.key)
                    const done = group.items.filter((item) => isContentComplete(progressByItemId[item.id]?.status)).length
                    const allDone = done === group.items.length
                    const progressText = t('courseLearn.completeCount', { done, total: group.items.length })
                    return (
                      <div key={group.key} className="border-t border-hairline/60 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
                        {group.title && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleSection(group.key)}
                              aria-expanded={isOpen}
                              className="group w-full flex items-start justify-between gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-card"
                            >
                              <span className="min-w-0">
                                <span className="block font-mono text-[10px] uppercase tracking-wide text-secondary">
                                  {t('courseLearn.sectionNumber', { number: index + 1 })}
                                </span>
                                <span className={`block text-sm font-semibold leading-snug line-clamp-2 ${isOpen ? 'text-ink' : 'text-ink/80 group-hover:text-ink'}`}>
                                  {group.title}
                                </span>
                              </span>
                              <span className="shrink-0 flex items-center gap-2 pt-3.5">
                                {allDone ? (
                                  <span role="img" aria-label={progressText} title={progressText} className="flex items-center justify-center w-4 h-4 rounded-full bg-moss text-paper text-[9px] font-bold">✓</span>
                                ) : (
                                  <span aria-label={progressText} title={progressText} className="font-mono text-[11px] tabular-nums text-secondary">
                                    {done}/{group.items.length}
                                  </span>
                                )}
                                <Chevron open={isOpen} />
                              </span>
                            </button>
                            {isOpen && group.instructions && (
                              // Shown in full above the item itself; here, just enough to place it.
                              <p className="px-2.5 mt-1 mb-2 whitespace-pre-wrap text-xs leading-relaxed text-secondary/80 line-clamp-3">
                                {group.instructions}
                              </p>
                            )}
                          </>
                        )}
                        {(isOpen || !group.title) && (
                          <ul className={`space-y-1 ${group.title ? 'mt-1 ml-2.5 pl-2 border-l border-hairline/60' : ''}`}>
                            {group.items.map((item) => renderItemRow(item))}
                          </ul>
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
                    {resourceTypeLabel(currentItem.type)}
                  </span>
                  <h3 className="font-display text-xl text-ink mb-4">{currentItem.title}</h3>
                  <CourseItemPlayer
                    item={currentItem}
                    userId={user.id}
                    courseId={course.id}
                    hasNext={currentIndex + 1 < orderedItems.length}
                    hasPrevious={currentIndex > 0}
                    isComplete={isContentComplete(progressByItemId[currentItem.id]?.status)}
                    progress={progress}
                    onMarkComplete={() => handleMarkComplete(currentItem)}
                    onDone={onDone}
                    onPrevious={() => selectItem(orderedItems[currentIndex - 1].id)}
                    onProgress={refreshProgress}
                    pageNumber={isPageCourse ? currentIndex + 1 : 0}
                    pageCount={isPageCourse ? orderedItems.length : 0}
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
      </Main>
    </div>
  )
}
