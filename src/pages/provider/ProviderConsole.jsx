import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import AppHeader from '../../components/AppHeader'
import { OrganisationStaffPanel } from '../admin/AdminProviders'
import { listOrganisations } from '../../lib/admin/organisations'
import { listOrganisationCatalogueCourses, submitProviderCourse } from '../../lib/admin/catalogue'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}

const EMPTY_FORM = { name: '', provider: '', courseType: '', duration: '', synopsis: '' }

// Console for a provider's own staff (organisation_members rows) -- built on
// top of the RLS/role model 0065/0066 already shipped: any org member
// (admin or trainer) can submit training into their own organisation_id,
// only an org admin can manage staff. No new role concept -- "provider
// admin" is organisation_members.role = 'admin', scoped by the unique
// (organisation_id, user_id) constraint.
export default function ProviderConsole() {
  const { user, organisationMemberships } = useAuth()
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedOrgId, setSelectedOrgId] = useState(null)

  const myOrgIds = useMemo(
    () => (organisationMemberships ?? []).map((m) => m.organisation_id),
    [organisationMemberships]
  )
  // Deactivating an organisation revokes its staff's actual access (RLS,
  // 0069) -- filter to active orgs here too, so a staff member doesn't see a
  // tab for an org that can no longer submit training or manage staff and
  // hit a confusing RLS error trying to use it.
  const myOrgs = useMemo(
    () => organisations.filter((o) => o.status === 'active' && myOrgIds.includes(o.id)),
    [organisations, myOrgIds]
  )
  const myRole = (organisationMemberships ?? []).find((m) => m.organisation_id === selectedOrgId)?.role
  const selectedOrg = myOrgs.find((o) => o.id === selectedOrgId)

  useEffect(() => {
    listOrganisations()
      .then((data) => {
        setOrganisations(data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedOrgId && myOrgs.length > 0) {
      setSelectedOrgId(myOrgs[0].id)
    }
  }, [myOrgs, selectedOrgId])

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="font-display text-xl text-ink mb-1">Provider console</h2>
        <p className="text-sm text-secondary mb-6">
          Submit training for approval and manage your organisation's staff.
        </p>

        {error && <p className="text-sm text-red-700 mb-4">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : myOrgs.length === 0 ? (
          <p className="text-secondary">
            {myOrgIds.length > 0
              ? "The organisation(s) you're staff at are currently deactivated."
              : "You're not part of any provider organisation."}
          </p>
        ) : (
          <>
            {myOrgs.length > 1 && (
              <div className="flex items-center flex-wrap gap-1 mb-6 border-b border-hairline">
                {myOrgs.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                      selectedOrgId === org.id
                        ? 'border-moss text-ink font-medium'
                        : 'border-transparent text-secondary hover:text-ink'
                    }`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}

            {selectedOrg && (
              <div className="space-y-8">
                <ProviderTrainingSection key={selectedOrg.id} organisation={selectedOrg} userId={user.id} />
                {myRole === 'admin' && (
                  <div>
                    <h3 className="font-display text-lg text-ink mb-3">Staff</h3>
                    <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                      <OrganisationStaffPanel organisation={selectedOrg} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function ProviderTrainingSection({ organisation, userId }) {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    load()
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setCourses(await listOrganisationCatalogueCourses(organisation.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await submitProviderCourse(userId, organisation.id, form)
      setForm(EMPTY_FORM)
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-ink">Training</h3>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
        >
          {showForm ? 'Cancel' : '+ Submit training'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-card border border-hairline rounded-lg p-4 space-y-3 mb-4">
          <p className="text-xs text-secondary">
            Submissions go to a platform admin for approval before they appear in the catalogue.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseName">
                Name
              </label>
              <input
                id="providerCourseName"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseType">
                Course type
              </label>
              <input
                id="providerCourseType"
                value={form.courseType}
                onChange={(e) => setForm((f) => ({ ...f, courseType: e.target.value }))}
                placeholder="Online, In-person, Workshop…"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseDuration">
                Duration
              </label>
              <input
                id="providerCourseDuration"
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-secondary mb-1" htmlFor="providerCourseSynopsis">
                Synopsis
              </label>
              <textarea
                id="providerCourseSynopsis"
                rows={3}
                value={form.synopsis}
                onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : courses.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No training submitted yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {courses.map((course) => (
            <div key={course.id} className="bg-card border border-hairline rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-ink font-medium">{course.name}</p>
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
                  {STATUS_LABELS[course.status] ?? course.status}
                </span>
              </div>
              {course.synopsis && <p className="text-sm text-secondary mt-1">{course.synopsis}</p>}
              {course.status === 'rejected' && course.rejection_reason && (
                <p className="text-xs text-red-700 mt-1">Rejected: {course.rejection_reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
