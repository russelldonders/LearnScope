import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { getAdminCourseDetail } from '../../lib/admin/catalogue'
import { formatCoursePrice } from '../../lib/courseCatalogue'
import { COURSE_STATUS_LABELS, RESOURCE_TYPE_LABELS } from '../../lib/statusLabels'
import { LEVEL_LABELS } from '../../lib/levels'
import StatusBadge from '../../components/StatusBadge'

// Read-only drill-in for a platform admin -- mirrors AdminSkillDetail.jsx's
// shape (metadata card, then a few focused sections below). Editing stays on
// the provider console's own ProviderCourseEditor; this is purely "let an
// admin see the course themselves" (BACKLOG.md), not a second editor.
export default function AdminCourseDetail() {
  const { courseId } = useParams()
  const [course, setCourse] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getAdminCourseDetail(courseId)
      .then(setCourse)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [courseId])

  const destinations = (course?.course_catalogue_publications ?? [])
    .map((p) => p.catalogues)
    .filter(Boolean)

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="mb-2">
          <Link to="/admin/catalogue" className="text-sm text-moss font-medium">
            ← Back to courses
          </Link>
        </div>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : !course ? (
          <p className="text-sm text-secondary">Course not found.</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl text-ink mb-1">{course.name}</h2>
                  <p className="font-mono text-xs text-secondary">{course.course_code || 'Not set'}</p>
                </div>
                <StatusBadge
                  label={COURSE_STATUS_LABELS[course.status] ?? course.status}
                  tone={course.status === 'rejected' || course.status === 'inactive' ? 'danger' : 'neutral'}
                />
              </div>
              {course.synopsis && <p className="text-sm text-secondary mt-2">{course.synopsis}</p>}
              <div className="flex flex-wrap gap-2 text-xs mt-3">
                {course.organisations?.name && <StatusBadge size="inherit" label={course.organisations.name} />}
                {course.course_type && <StatusBadge size="inherit" label={course.course_type} />}
                {course.duration && <StatusBadge size="inherit" label={course.duration} />}
                <StatusBadge size="inherit" label={`Version ${course.version_number}`} />
                {formatCoursePrice(course) && <StatusBadge size="inherit" label={formatCoursePrice(course)} />}
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
                <div>
                  <dt className="text-xs text-secondary">Participants</dt>
                  <dd className="text-ink font-medium">{course.participantCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-secondary">Created</dt>
                  <dd className="text-ink font-medium">{course.created_at ? new Date(course.created_at).toLocaleDateString() : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-secondary">Last updated</dt>
                  <dd className="text-ink font-medium">{course.updated_at ? new Date(course.updated_at).toLocaleDateString() : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-secondary">Destinations</dt>
                  <dd className="text-ink font-medium">{destinations.length > 0 ? destinations.map((d) => d.name).join(', ') : '—'}</dd>
                </div>
              </dl>
            </div>

            {course.skills.length > 0 && (
              <div>
                <h3 className="font-display text-lg text-ink mb-2">Skills targeted ({course.skills.length})</h3>
                <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                  <ul className="divide-y divide-hairline">
                    {course.skills.map((skill) => (
                      <li key={skill.id} className="px-4 py-2 text-sm flex items-center justify-between gap-2">
                        <Link to={`/admin/skills/${skill.id}`} className="text-moss font-medium hover:underline">
                          {skill.name}
                        </Link>
                        <span className="text-secondary text-xs shrink-0">Targets {LEVEL_LABELS[skill.level] ?? skill.level}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div>
              <h3 className="font-display text-lg text-ink mb-2">
                Content ({course.sections.reduce((sum, s) => sum + s.resources.length, 0) + course.ungroupedResources.length} items)
              </h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                {course.sections.length === 0 && course.ungroupedResources.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-secondary">No content added to this course yet.</p>
                ) : (
                  <div className="divide-y divide-hairline">
                    {course.sections.map((section) => (
                      <div key={section.id} className="px-4 py-3">
                        <p className="text-sm font-medium text-ink mb-1.5">{section.title}</p>
                        {section.resources.length === 0 ? (
                          <p className="text-xs text-secondary">No content in this section.</p>
                        ) : (
                          <ul className="space-y-1">
                            {section.resources.map((resource) => (
                              <li key={resource.linkId} className="text-xs text-secondary flex items-center gap-2">
                                <span className="font-mono uppercase tracking-wide text-[10px] rounded-full px-1.5 py-0.5 border border-hairline shrink-0">
                                  {RESOURCE_TYPE_LABELS[resource.type] ?? resource.type}
                                </span>
                                <span className="text-ink">{resource.title}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                    {course.ungroupedResources.length > 0 && (
                      <div className="px-4 py-3">
                        <ul className="space-y-1">
                          {course.ungroupedResources.map((resource) => (
                            <li key={resource.linkId} className="text-xs text-secondary flex items-center gap-2">
                              <span className="font-mono uppercase tracking-wide text-[10px] rounded-full px-1.5 py-0.5 border border-hairline shrink-0">
                                {RESOURCE_TYPE_LABELS[resource.type] ?? resource.type}
                              </span>
                              <span className="text-ink">{resource.title}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-display text-lg text-ink mb-2">Version history ({course.versions.length})</h3>
              <div className="bg-card border border-hairline rounded-lg overflow-hidden">
                <ul className="divide-y divide-hairline">
                  {course.versions.map((version) => (
                    <li key={version.id} className="px-4 py-3 text-sm flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-ink font-medium">
                          Version {version.version_number}
                          {version.id === course.id ? ' (this page)' : ''}
                        </p>
                        <p className="text-xs text-secondary mt-0.5">
                          {COURSE_STATUS_LABELS[version.status] ?? version.status}
                          {version.creator?.full_name ? ` · by ${version.creator.full_name}` : ''}
                        </p>
                      </div>
                      {version.id !== course.id && (
                        <Link to={`/admin/catalogue/${version.id}`} className="text-xs text-moss font-medium hover:underline">
                          View this version
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
