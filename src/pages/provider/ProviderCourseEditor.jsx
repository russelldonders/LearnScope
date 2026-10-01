import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import AccessibleDialog from '../../components/AccessibleDialog'
import CourseThumbnail from '../../components/CourseThumbnail'
import {
  getCatalogueCourse,
  updateProviderCourse,
  submitCatalogueCourseForApproval,
  createDraftCourseVersion,
  uploadCourseImage,
  removeCourseImage,
  listCurrentVersionCatalogues,
} from '../../lib/admin/catalogue'
import { listPublicationCatalogueOptions } from '../../lib/catalogues'
import {
  assignProviderCourseToCatalogue,
  requestProviderGlobalCataloguePublication,
} from '../../lib/admin/providerCatalogues'
import { listCourseTrainers, setCourseTrainers, listOrganisationTrainerCandidates } from '../../lib/courseCatalogue'
import { optimizeCourseImage, COURSE_IMAGE_MAX_INPUT_BYTES } from '../../lib/optimizeImage'
import { COURSE_STATUS_LABELS } from '../../lib/statusLabels'
import { COURSE_TYPES } from '../../lib/courseTypes'
import { DURATION_UNITS } from '../../lib/courseDuration'
import { CURRENCIES } from '../../lib/currencies'
import { CourseSections } from './CourseSections'
import { TrainerPicker, CourseCohorts } from './CourseCohorts'

const MAX_IMAGE_BYTES = COURSE_IMAGE_MAX_INPUT_BYTES

// Catalogue selection during publish is entirely optional -- publishing
// makes this version the org's current live version, full stop. Pushing it
// into a catalogue (so it's discoverable by learners) is a separate choice
// layered on top. Nothing is pre-selected for a genuinely new draft, but a
// version that was already submitted to one or more catalogues (e.g. a
// rejected submission being fixed and resent) opens with those same
// catalogues still ticked, rather than silently dropping them and making
// resubmission look like starting over.
function PublishCourseDialog({ currentCatalogues, submitting, onClose, onPublish }) {
  const hasCurrentCatalogues = (currentCatalogues?.length ?? 0) > 0

  return (
    <AccessibleDialog
      labelledBy="publish-course-title"
      describedBy="publish-course-description"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg rounded-xl bg-card border border-hairline p-5 shadow-xl"
    >
      <h2 id="publish-course-title" className="font-display text-lg text-ink">Publish this version</h2>
      <p id="publish-course-description" className="text-sm text-secondary mt-1 mb-3">
        Publishing makes this the course's live version for your organisation. Adding it to one of your catalogues,
        or submitting it to the platform-wide Global catalogue, are separate steps you can take afterwards.
      </p>

      {hasCurrentCatalogues && (
        <p className="text-xs text-amber-700 mb-3">
          This course is currently visible in {currentCatalogues.map((c) => c.name).join(', ')}. Publishing this
          version will replace it there, and it won't be discoverable again until you push this version to a
          catalogue.
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={submitting}
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </AccessibleDialog>
  )
}

// The one platform-wide review channel that isn't reachable through the
// catalogue-free Publish above or the post-publish "Push to catalogue" step
// (assign_course_to_catalogue requires already being an approver of the
// target catalogue, which no ordinary provider is for Global) --
// submit_course_for_publication with just the Global catalogue's id is the
// only path left, so this is a single-purpose confirm rather than a picker:
// there's exactly one Global catalogue (0090's system-provider migration).
function SubmitToGlobalCatalogueDialog({ organisationId, submitting, onClose, onSubmit }) {
  const [globalCatalogueId, setGlobalCatalogueId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listPublicationCatalogueOptions(organisationId)
      .then((options) => {
        const global = options.find((option) => option.is_global)
        if (!global) throw new Error('The Global catalogue could not be found.')
        setGlobalCatalogueId(global.id)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [organisationId])

  return (
    <AccessibleDialog
      labelledBy="submit-global-catalogue-title"
      describedBy="submit-global-catalogue-description"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg rounded-xl bg-card border border-hairline p-5 shadow-xl"
    >
      <h2 id="submit-global-catalogue-title" className="font-display text-lg text-ink">Submit to Global catalogue</h2>
      <p id="submit-global-catalogue-description" className="text-sm text-secondary mt-1 mb-3">
        Sends this version for review by a platform admin. It becomes visible platform-wide, and this course's own
        live version for your organisation, once approved.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {loading && <p role="status" className="text-sm text-secondary">Loading…</p>}

      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(globalCatalogueId)}
          disabled={submitting || loading || !globalCatalogueId}
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </AccessibleDialog>
  )
}

// Standalone catalogue-push, independent of publishing (PublishCourseDialog
// above) -- lets an already-published version be added to a catalogue at
// any later point, not just at the moment it was first published. Mirrors
// ProviderCatalogueDetail's own "Add course" flow for provider-owned
// catalogues, with the platform-moderated Global destination presented in
// the same picker so providers choose every destination in one place.
function PushToCatalogueDialog({ organisationId, courseId, alreadySelectedIds, onClose, onDone }) {
  const [catalogues, setCatalogues] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listPublicationCatalogueOptions(organisationId)
      .then((options) => setCatalogues(options.filter((option) => !alreadySelectedIds.includes(option.id))))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    // alreadySelectedIds is derived fresh from the loaded course each
    // render -- re-running this on every identity change would refetch for
    // no reason, and the dialog is remounted (key-less) whenever it's
    // reopened anyway.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId])

  function toggleCatalogue(id) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((catalogueId) => catalogueId !== id) : [...current, id]
    )
  }

  async function handlePush() {
    setSubmitting(true)
    setError(null)
    try {
      for (const catalogue of catalogues.filter((option) => selectedIds.includes(option.id))) {
        if (catalogue.is_global) await requestProviderGlobalCataloguePublication(courseId)
        else await assignProviderCourseToCatalogue(catalogue.id, courseId)
      }
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="push-catalogue-title"
      describedBy="push-catalogue-description"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg rounded-xl bg-card border border-hairline p-5 shadow-xl"
    >
      <h2 id="push-catalogue-title" className="font-display text-lg text-ink">Push to catalogue</h2>
      <p id="push-catalogue-description" className="text-sm text-secondary mt-1 mb-5">
        Choose where this published version should appear. Your own catalogues update immediately; the Global
        catalogue makes it available platform-wide after a platform admin approves it.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <p className="text-sm text-secondary">This version is already in every catalogue available to you.</p>
      ) : (
        <div className="divide-y divide-hairline border-y border-hairline">
          {catalogues.map((catalogue) => (
            <label key={catalogue.id} className="flex items-start gap-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.includes(catalogue.id)}
                onChange={() => toggleCatalogue(catalogue.id)}
                className="mt-0.5 h-4 w-4 accent-moss"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink break-words">{catalogue.name}</span>
                  {catalogue.is_global && (
                    <span className="rounded-full border border-gold/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-gold">
                      Approval required
                    </span>
                  )}
                </span>
                {catalogue.description && (
                  <span className="block text-xs text-secondary mt-0.5 break-words">{catalogue.description}</span>
                )}
                <span className="block text-xs text-secondary mt-0.5">
                  {catalogue.is_global ? 'Platform-wide catalogue' : 'Your catalogue · Available immediately'}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={handlePush}
          disabled={submitting || loading || selectedIds.length === 0}
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Pushing…' : 'Push to selected'}
        </button>
      </div>
    </AccessibleDialog>
  )
}

// Info (name/code/type/duration/price/synopsis/image and save/publish) and
// Content (sections/resources) used to sit stacked on one long page --
// split into tabs since the two are edited at different times (details
// first, content once the basics are settled) and content on its own can
// already run long for a course with several sections. Mirrors the
// Overview/Skills/Activities/Details tab pattern in CourseModal.jsx.
const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'content', label: 'Content' },
  { id: 'cohorts', label: 'Cohorts' },
]

// A course's own full-page editor -- structuring content into named,
// ordered sections (0078) needs more room than the summary card in
// ProviderConsole ever had, so editing moved off that inline expand-in-
// place form onto its own route, the same way AdminUserDetail/
// AdminSkillDetail moved their consoles' inline expansions onto dedicated
// pages. Mirrors the learner-facing CourseLearn's grouped-by-section
// structure, just for building it rather than taking it.
export default function ProviderCourseEditor() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const employerContext = searchParams.get('org')
  const { user, organisationMemberships } = useAuth()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('content')
  // Name/type/duration/synopsis form state used to live inside CourseHeader
  // (only mounted on the Info tab), with its own Save/Submit buttons. Lifted
  // here so Save/Publish can sit above the tabs and work from either one --
  // a nice side effect is that unsaved edits now survive switching to the
  // Content tab and back, instead of being lost when CourseHeader unmounted.
  const [form, setForm] = useState(null)
  const loadedCourseIdRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [showGlobalSubmitDialog, setShowGlobalSubmitDialog] = useState(false)
  const [showCatalogueDialog, setShowCatalogueDialog] = useState(false)
  const [saveError, setSaveError] = useState(null)
  // Whichever version is currently live for this course (which may not be
  // the one being edited -- a new draft starts with no publications of its
  // own, 0107) -- surfaced so the publish dialog can warn if publishing
  // with no catalogue selected would pull the course out of a catalogue
  // it's currently visible in.
  const [currentCatalogues, setCurrentCatalogues] = useState([])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [courseId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await getCatalogueCourse(courseId)
      if (!data) {
        setNotFound(true)
      } else {
        setCourse(data)
        if (loadedCourseIdRef.current !== data.id) {
          loadedCourseIdRef.current = data.id
          setForm({
            name: data.name,
            courseCode: data.course_code ?? '',
            provider: data.provider ?? '',
            courseType: data.course_type ?? '',
            // Legacy free-text duration (pre-structured, or never parsed
            // back apart -- see courseDuration.js) shown as a read-only
            // hint when there's no structured value/unit to prefill the
            // picker from, rather than guessing at parsing it.
            legacyDuration: data.duration_value == null ? (data.duration ?? '') : '',
            durationValue: data.duration_value ?? '',
            durationUnit: data.duration_unit ?? 'hours',
            synopsis: data.synopsis ?? '',
            priceAmount: data.price_amount ?? '',
            priceCurrency: data.price_currency ?? '',
          })
        }
        if (data.status === 'draft' || data.status === 'rejected') {
          listCurrentVersionCatalogues(data.version_group_id)
            .then(setCurrentCatalogues)
            .catch(() => setCurrentCatalogues([]))
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e) {
    e?.preventDefault()
    setSaving(true)
    setSaveError(null)
    try {
      await updateProviderCourse(course.id, form)
      await load()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setSubmitting(true)
    setSaveError(null)
    try {
      await updateProviderCourse(course.id, form)
      await submitCatalogueCourseForApproval(course.id, [])
      setShowPublishDialog(false)
      await load()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitToGlobal(globalCatalogueId) {
    setSubmitting(true)
    setSaveError(null)
    try {
      await updateProviderCourse(course.id, form)
      await submitCatalogueCourseForApproval(course.id, [globalCatalogueId])
      setShowGlobalSubmitDialog(false)
      await load()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const myRole = (organisationMemberships ?? []).find((m) => m.organisation_id === course?.organisation_id)?.role
  const canEdit = Boolean(myRole) && (course?.status === 'draft' || course?.status === 'rejected')
  const publishedCatalogues = (course?.course_catalogue_publications ?? [])
    .filter((publication) => publication.published_at && publication.catalogues)
    .map((publication) => publication.catalogues)
  const selectedCatalogueIds = (course?.course_catalogue_publications ?? []).map((publication) => publication.catalogue_id)
  const globalCataloguePending = (course?.course_catalogue_publications ?? []).some(
    (publication) => publication.catalogues?.is_global && !publication.published_at
  )

  async function handleCreateDraftVersion() {
    setSaveError(null)
    setSaving(true)
    try {
      const draftId = await createDraftCourseVersion(course.id)
      navigate(`/organisation/training/${draftId}${employerContext ? `?org=${encodeURIComponent(employerContext)}` : ''}`)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        {/* Reconstructed from the loaded course itself (its organisation and
            the Training section it's always reached from), not passed-through
            navigation state -- so this always returns to the right
            organisation/section even after a refresh or a bookmarked link
            straight to this course. Falls back to a bare /provider before
            the course has loaded. */}
        <Link
          to={employerContext
            ? `/organisation?org=${encodeURIComponent(employerContext)}&section=provider-training`
            : course ? `/organisation?org=${course.organisation_id}&section=training` : '/organisation'}
          className="text-sm text-secondary hover:text-ink mb-4 inline-block"
        >
          ← Back to provider console
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {course && form && (
          <div className="space-y-6">
            {/* Rendered above the tabs (rather than inside the Info-tab-only
                CourseHeader below) so a provider lands on this notice no
                matter which tab the editor opens on -- Content is the
                default tab, so a rejection notice that only lived inside
                CourseHeader was easy to miss entirely. rejection_reason
                itself is untouched -- this only changes where it's shown. */}
            {course.status === 'rejected' && (
              <div role="alert" className="rounded-lg border border-red-700 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">
                  This course was rejected{course.rejection_reason ? ':' : '.'}
                </p>
                <p className="text-sm text-red-700 mt-1">
                  {course.rejection_reason || 'No reason was given.'}
                </p>
                {canEdit && (
                  <p className="text-sm text-red-700 mt-2">
                    Revise the course below, then publish it or submit it to the Global catalogue again.
                  </p>
                )}
              </div>
            )}

            {canEdit && (
              <div className="space-y-2">
                {saveError && <p className="text-sm text-red-700">{saveError}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || submitting}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPublishDialog(true)}
                    disabled={saving || submitting}
                    className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGlobalSubmitDialog(true)}
                    disabled={saving || submitting}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                  >
                    {course.status === 'rejected' ? 'Resubmit to Global catalogue' : 'Submit to Global catalogue'}
                  </button>
                </div>
              </div>
            )}

            {showPublishDialog && (
              <PublishCourseDialog
                currentCatalogues={currentCatalogues}
                submitting={submitting}
                onClose={() => setShowPublishDialog(false)}
                onPublish={handlePublish}
              />
            )}

            {showGlobalSubmitDialog && (
              <SubmitToGlobalCatalogueDialog
                organisationId={course.organisation_id}
                submitting={submitting}
                onClose={() => setShowGlobalSubmitDialog(false)}
                onSubmit={handleSubmitToGlobal}
              />
            )}

            {showCatalogueDialog && (
              <PushToCatalogueDialog
                organisationId={course.organisation_id}
                courseId={course.id}
                alreadySelectedIds={selectedCatalogueIds}
                onClose={() => setShowCatalogueDialog(false)}
                onDone={() => {
                  setShowCatalogueDialog(false)
                  load()
                }}
              />
            )}

            <div className="flex items-center flex-wrap gap-1 border-b border-hairline">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-moss text-ink'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'info' && (
              <div className="space-y-4">
                <CourseHeader
                  course={course}
                  canEdit={canEdit}
                  onSaved={load}
                  form={form}
                  setForm={setForm}
                  onSubmit={handleSave}
                  onCreateDraftVersion={handleCreateDraftVersion}
                  creatingDraft={saving}
                  publishedCatalogues={publishedCatalogues}
                  globalCataloguePending={globalCataloguePending}
                  onPushToCatalogue={() => setShowCatalogueDialog(true)}
                />
                <CourseTrainers courseCatalogueId={course.id} organisationId={course.organisation_id} canManage={Boolean(myRole)} />
              </div>
            )}
            {tab === 'content' && (
              <CourseSections courseId={course.id} organisationId={course.organisation_id} userId={user.id} canEdit={canEdit} />
            )}
            {tab === 'cohorts' && (
              <CourseCohorts courseCatalogueId={course.id} organisationId={course.organisation_id} canManage={Boolean(myRole)} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function CourseHeader({ course, canEdit, onSaved, form, setForm, onSubmit, onCreateDraftVersion, creatingDraft, publishedCatalogues, globalCataloguePending, onPushToCatalogue }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="font-display text-xl text-ink">{course.name}</h1>
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
          Version {course.version_number} · {COURSE_STATUS_LABELS[course.status] ?? course.status}
        </span>
      </div>

      <CourseImageUpload course={course} canEdit={canEdit} onUpdated={onSaved} />

      {course.status === 'approved' && (
        <div className="mb-4 rounded-md border border-hairline bg-paper p-3">
          {course.synopsis && <p className="text-sm text-secondary mb-3">{course.synopsis}</p>}
          <p className="text-sm text-ink mb-2">This published version remains live while you work on the next version.</p>
          <p className="text-sm text-secondary mb-2">
            {publishedCatalogues.length === 0
              ? "Not in any catalogue yet -- it's only visible within your organisation."
              : `Published to: ${publishedCatalogues.map((c) => c.name).join(', ')}.`}
          </p>
          {globalCataloguePending && (
            <p role="status" className="text-sm text-gold mb-2">
              Global catalogue submission pending platform approval.
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onCreateDraftVersion}
              disabled={creatingDraft}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
            >
              {creatingDraft ? 'Creating draft…' : 'Create next version'}
            </button>
            <button
              type="button"
              onClick={onPushToCatalogue}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
            >
              Push to catalogue
            </button>
          </div>
        </div>
      )}

      {!canEdit ? (
        course.status !== 'approved' && course.synopsis && <p className="text-sm text-secondary">{course.synopsis}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseName">
                Name
              </label>
              <input
                id="courseName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseType">
                Course type
              </label>
              <select
                id="courseType"
                value={form.courseType}
                onChange={(e) => setForm((f) => ({ ...f, courseType: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">Choose a type…</option>
                {/* A legacy course_type value from before this was a fixed
                    list isn't in COURSE_TYPES -- shown as an extra option
                    so saving doesn't silently blank it out. */}
                {form.courseType && !COURSE_TYPES.includes(form.courseType) && (
                  <option value={form.courseType}>{form.courseType}</option>
                )}
                {COURSE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseCode">
                Course code / ID
              </label>
              {/* System-generated (set_course_code_trigger, 0113) the moment
                  the course is created -- never hand-entered, so this is a
                  read-only reference the same way AdminProviders/AdminUsers
                  show org_code/user_code, not an editable field. */}
              <p id="courseCode" className="w-full rounded-md border border-hairline bg-paper/60 px-3 py-2 font-mono text-xs text-secondary">
                {form.courseCode || '—'}
              </p>
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseDuration">
                Duration
              </label>
              <div className="flex gap-2">
                <input
                  id="courseDuration"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.durationValue}
                  onChange={(e) => setForm((f) => ({ ...f, durationValue: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <label className="sr-only" htmlFor="courseDurationUnit">Duration unit</label>
                <select
                  id="courseDurationUnit"
                  value={form.durationUnit}
                  onChange={(e) => setForm((f) => ({ ...f, durationUnit: e.target.value }))}
                  className="shrink-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  {DURATION_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              {form.legacyDuration && (
                <p className="mt-1 text-xs text-secondary">Current: {form.legacyDuration} (set a value above to replace it)</p>
              )}
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="coursePriceAmount">
                Price
              </label>
              <input
                id="coursePriceAmount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.priceAmount}
                onChange={(e) => setForm((f) => ({ ...f, priceAmount: e.target.value }))}
                placeholder="Leave blank if not specified, 0 if free"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="coursePriceCurrency">
                Currency
              </label>
              <select
                id="coursePriceCurrency"
                value={form.priceCurrency}
                onChange={(e) => setForm((f) => ({ ...f, priceCurrency: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">Choose a currency…</option>
                {form.priceCurrency && !CURRENCIES.includes(form.priceCurrency) && (
                  <option value={form.priceCurrency}>{form.priceCurrency}</option>
                )}
                {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="courseSynopsis">
                Synopsis
              </label>
              <textarea
                id="courseSynopsis"
                rows={3}
                value={form.synopsis}
                onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

// Course-level trainer list (item 6) -- separate from, and independent of,
// each cohort's own trainer list below: this is who's generally associated
// with delivering the training, not tied to a specific scheduled run.
function CourseTrainers({ courseCatalogueId, organisationId, canManage }) {
  const [candidates, setCandidates] = useState([])
  const [trainers, setTrainers] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [courseCatalogueId, organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [candidateRows, trainerRows] = await Promise.all([
        organisationId ? listOrganisationTrainerCandidates(organisationId) : Promise.resolve([]),
        listCourseTrainers(courseCatalogueId),
      ])
      setCandidates(candidateRows)
      setTrainers(trainerRows)
      setSelectedIds(new Set(trainerRows.map((t) => t.userId)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function toggle(userId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setNotice('')
    try {
      await setCourseTrainers(courseCatalogueId, [...selectedIds])
      setNotice('Trainer list saved.')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h2 className="font-display text-lg text-ink mb-1">Trainers</h2>
      <p className="text-sm text-secondary mb-4">Who's generally associated with delivering this training.</p>
      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : !canManage ? (
        trainers.length === 0 ? (
          <p className="text-sm text-secondary">No trainers listed yet.</p>
        ) : (
          <ul className="text-sm text-ink space-y-1">{trainers.map((t) => <li key={t.userId}>{t.name}</li>)}</ul>
        )
      ) : (
        <div className="space-y-3">
          <TrainerPicker candidates={candidates} selectedIds={selectedIds} onToggle={toggle} disabled={saving} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="text-sm text-moss">{notice}</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save trainers'}
          </button>
        </div>
      )}
    </div>
  )
}

// Overtakes CourseThumbnail's generated placeholder once set. Shown (and,
// while canEdit, editable) regardless of which tab-form state the rest of
// the card is in -- unlike the name/type/duration/synopsis fields, it isn't
// part of the plain-object form state above since it uploads and persists
// immediately on selection, same UX as OrganisationSettingsModal's logo
// upload (a separate storage operation, not a row-field edit that waits for
// Save).
function CourseImageUpload({ course, canEdit, onUpdated }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is too large (max 10MB).')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const optimizedImage = await optimizeCourseImage(file)
      await uploadCourseImage(course.id, optimizedImage)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    setUploading(true)
    setError(null)
    try {
      await removeCourseImage(course.id)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mb-4">
      <span className="block text-sm text-secondary mb-1">Course image</span>
      <div className="flex items-center gap-4">
        <CourseThumbnail
          name={course.name}
          provider={course.provider}
          imageUrl={course.image_url}
          className="w-32 h-20 rounded-md overflow-hidden border border-hairline shrink-0"
        />
        {canEdit && (
          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                {uploading ? 'Uploading…' : course.image_url ? 'Change image' : 'Upload image'}
              </button>
              {course.image_url && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={uploading}
                  className="text-sm text-secondary hover:text-red-700 disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </div>
            {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  )
}

