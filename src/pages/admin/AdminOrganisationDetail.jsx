import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'
import OrganisationCapabilityFields from './OrganisationCapabilityFields'
import { OrganisationStaffPanel } from './AdminProviders'
import {
  getOrganisation,
  setOrganisationCapabilities,
  setOrganisationStatus,
  updateOrganisation,
} from '../../lib/admin/organisations'
import { listOrganisationCatalogueCourses } from '../../lib/admin/catalogue'
import { formatAbsoluteDate } from '../../lib/dates'

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'staff', label: 'Staff' },
  { id: 'courses', label: 'Courses' },
  { id: 'status', label: 'Status' },
]

const COURSE_STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}

function activeCapabilities(organisation) {
  return (organisation?.organisation_capabilities ?? [])
    .filter((item) => item.status === 'active')
    .map((item) => item.capability)
}

// One organisation's own page in the platform console, reached from the
// Organisations list -- the same "table lists, its own page edits" split as
// Users. Tabs (kept in ?tab=) for its details and capabilities, staff, the
// courses it has created, and its active/inactive status.
export default function AdminOrganisationDetail() {
  const { organisationId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'details'

  const [organisation, setOrganisation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setOrganisation(await getOrganisation(organisationId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [organisationId])

  useEffect(() => { load() }, [load])

  function selectTab(id) {
    const next = new URLSearchParams(searchParams)
    if (id === 'details') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next)
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <Link to="/admin/organisations" className="text-sm text-moss font-medium">
          ← Back to organisations
        </Link>

        {loading && !organisation ? (
          <p className="text-secondary">Loading…</p>
        ) : !organisation ? (
          <p className="text-sm text-red-700">{error || 'Organisation not found.'}</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl text-ink">{organisation.name}</h2>
                <StatusBadge
                  label={organisation.status === 'active' ? 'Active' : 'Inactive'}
                  tone={organisation.status === 'active' ? 'success' : 'danger'}
                />
                {organisation.is_system && <StatusBadge label="System organisation" tone="neutral" />}
              </div>
              {organisation.org_code && <p className="font-mono text-xs text-secondary mt-1">{organisation.org_code}</p>}
            </div>

            <nav aria-label="Organisation sections" className="flex flex-wrap gap-1 border-b border-hairline">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`px-3 py-2 -mb-px border-b-2 text-sm whitespace-nowrap ${
                    tab === t.id ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === 'details' && <DetailsTab key={organisation.id} organisation={organisation} onSaved={load} />}
            {tab === 'staff' && <OrganisationStaffPanel organisation={organisation} alwaysShowForm />}
            {tab === 'courses' && <CoursesTab organisation={organisation} />}
            {tab === 'status' && <StatusTab organisation={organisation} onChanged={load} />}
          </>
        )}
      </div>
    </AdminLayout>
  )
}

function DetailsTab({ organisation, onSaved }) {
  const savedCapabilities = activeCapabilities(organisation)
  const [name, setName] = useState(organisation.name ?? '')
  const [url, setUrl] = useState(organisation.url ?? '')
  const [capabilities, setCapabilities] = useState(savedCapabilities)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setFeedback(null)
    try {
      await Promise.all([
        updateOrganisation(organisation.id, { name, url }),
        setOrganisationCapabilities(organisation.id, capabilities),
      ])
      await onSaved()
      setFeedback({ status: 'success', message: 'Changes saved.' })
    } catch (err) {
      setFeedback({ status: 'error', message: `Couldn't save changes to this organisation: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-6 space-y-4">
      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="orgDetailName">Name</label>
        <input
          id="orgDetailName"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>
      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="orgDetailUrl">Website URL</label>
        <input
          id="orgDetailUrl"
          type="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>
      <OrganisationCapabilityFields
        idPrefix="orgDetailCapability"
        value={capabilities}
        initialValue={savedCapabilities}
        onChange={setCapabilities}
      />
      <MutationFeedback status={feedback?.status} message={feedback?.message} />
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}

function CoursesTab({ organisation }) {
  const [courses, setCourses] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    listOrganisationCatalogueCourses(organisation.id)
      .then((data) => { if (!cancelled) setCourses(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [organisation.id])

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-secondary">Courses created by this organisation (latest version of each).</p>
        <Link to={`/admin/courses?org=${organisation.id}`} className="text-sm text-moss font-medium hover:underline">
          Open in Courses
        </Link>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">Couldn't load courses: {error}</p>
      ) : courses === null ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : courses.length === 0 ? (
        <p className="text-sm text-secondary">This organisation hasn't created any courses yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {courses.map((course) => (
            <li key={course.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/admin/courses/${course.id}`} className="text-sm text-ink hover:text-moss hover:underline">
                {course.name}
              </Link>
              <span className="flex items-center gap-3 text-xs text-secondary">
                <span>{COURSE_STATUS_LABELS[course.status] ?? course.status}</span>
                {course.updated_at && <span>{formatAbsoluteDate(course.updated_at)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusTab({ organisation, onChanged }) {
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)
  const active = organisation.status === 'active'

  async function handleConfirm() {
    setWorking(true)
    setError(null)
    try {
      await setOrganisationStatus(organisation.id, active ? 'inactive' : 'active')
      setConfirming(false)
      await onChanged()
    } catch (err) {
      setError(`Couldn't update this organisation's status: ${err.message}`)
      setConfirming(false)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6 space-y-3">
      <p className="text-sm text-ink">
        This organisation is <span className="font-medium">{active ? 'active' : 'inactive'}</span>.
      </p>
      <p className="text-sm text-secondary max-w-2xl">
        {active
          ? 'Deactivating it stops its staff and administrators using its workspace until it is reactivated. Nothing is deleted: its courses, staff and settings are kept.'
          : 'Reactivating it gives its staff and administrators access to its workspace again.'}
      </p>
      <MutationFeedback status="error" message={error} />
      {organisation.is_system ? (
        <p className="text-sm text-secondary">The system organisation can't be deactivated.</p>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`rounded-md border py-2 px-4 text-sm font-medium hover:bg-paper ${
            active ? 'border-red-300 text-red-700' : 'border-hairline text-ink'
          }`}
        >
          {active ? 'Deactivate organisation' : 'Reactivate organisation'}
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          message={
            active
              ? `Deactivate ${organisation.name}? Its users lose access until it's reactivated.`
              : `Reactivate ${organisation.name}? Its users regain access.`
          }
          confirmLabel={active ? 'Deactivate' : 'Reactivate'}
          confirming={working}
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
