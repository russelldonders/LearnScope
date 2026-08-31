import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { useAuth } from '../../context/AuthContext'
import { listOrganisations } from '../../lib/admin/organisations'
import {
  getProviderSkillAlignment,
  listOrganisationOfferedSkills,
  setResourceSkillAlignment,
  setTrainingSkillAlignment,
} from '../../lib/admin/providerSkills'

const TABS = [
  { key: 'training', label: 'Training' },
  { key: 'resources', label: 'Resources' },
]

export default function ProviderSkillDetail() {
  const { organisationId, skillId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const [skill, setSkill] = useState(null)
  const [organisation, setOrganisation] = useState(null)
  const [alignment, setAlignment] = useState({ courses: [], resources: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingKey, setSavingKey] = useState(null)
  const activeTab = searchParams.get('tab') === 'resources' ? 'resources' : 'training'

  useEffect(() => {
    load()
    // load is reused after mutations; the route identifiers are the boundary.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId, skillId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [skills, organisations, alignmentData] = await Promise.all([
        listOrganisationOfferedSkills(organisationId),
        listOrganisations(),
        getProviderSkillAlignment(organisationId, skillId),
      ])
      setSkill(skills.find((item) => item.skillLibraryId === skillId) ?? null)
      setOrganisation(organisations.find((item) => item.id === organisationId) ?? null)
      setAlignment(alignmentData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateCourse(course, aligned, level = course.level) {
    setSavingKey(`course-${course.id}`)
    setError(null)
    try {
      await setTrainingSkillAlignment(course.id, skillId, aligned, level)
      setAlignment(await getProviderSkillAlignment(organisationId, skillId))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingKey(null)
    }
  }

  async function updateResource(resource, aligned) {
    setSavingKey(`resource-${resource.id}`)
    setError(null)
    try {
      await setResourceSkillAlignment(resource.id, skillId, user.id, aligned)
      setAlignment(await getProviderSkillAlignment(organisationId, skillId))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingKey(null)
    }
  }

  const alignedTraining = alignment.courses.filter((item) => item.alignmentId).length
  const alignedResources = alignment.resources.filter((item) => item.alignmentId).length

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <Link
          to="/provider"
          state={{ providerSection: 'skills', organisationId }}
          className="inline-flex items-center min-h-11 text-sm text-moss font-medium hover:underline underline-offset-2"
        >
          ← Back to skills
        </Link>

        {loading ? (
          <p className="text-secondary py-8">Loading skill…</p>
        ) : error && !skill ? (
          <div className="mt-4 rounded-lg border border-hairline bg-card p-5">
            <h1 className="font-display text-xl text-ink">Skill unavailable</h1>
            <p className="text-sm text-red-700 mt-2">{error}</p>
          </div>
        ) : !skill ? (
          <div className="mt-4 rounded-lg border border-hairline bg-card p-5">
            <h1 className="font-display text-xl text-ink">Skill not found</h1>
            <p className="text-sm text-secondary mt-2">This skill is not offered by the selected organisation.</p>
          </div>
        ) : (
          <>
            <header className="mt-3 mb-7 max-w-3xl">
              <p className="text-sm text-secondary mb-1">{organisation?.name || 'Provider organisation'}</p>
              <h1 className="font-display text-2xl sm:text-3xl text-ink text-balance">{skill.name}</h1>
              <p className="text-sm text-secondary mt-2">
                {[skill.category, skill.description].filter(Boolean).join(' · ') || 'Align this skill with your organisation’s learning offer.'}
              </p>
            </header>

            {error && <p className="text-sm text-red-700 mb-4" role="alert">{error}</p>}

            <div className="border-b border-hairline mb-6" role="tablist" aria-label="Skill management">
              <div className="flex gap-1 overflow-x-auto">
                {TABS.map((tab) => {
                  const count = tab.key === 'training' ? alignedTraining : alignedResources
                  const selected = activeTab === tab.key
                  return (
                    <button
                      key={tab.key}
                      id={`${tab.key}-tab`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`${tab.key}-panel`}
                      onClick={() => setSearchParams(tab.key === 'training' ? {} : { tab: tab.key })}
                      className={`min-h-11 px-4 -mb-px border-b-2 whitespace-nowrap text-sm ${selected ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'}`}
                    >
                      {tab.label}
                      <span className="ml-2 rounded-full bg-moss/10 px-2 py-0.5 text-xs text-moss">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {activeTab === 'training' ? (
              <AlignmentSection
                id="training-panel"
                title="Training aligned to this skill"
                description="Select editable training and set the level a learner can work towards. Published and pending versions remain visible but locked."
                empty="No training has been created yet."
              >
                {alignment.courses.map((course) => {
                  const editable = course.status === 'draft' || course.status === 'rejected'
                  const busy = savingKey === `course-${course.id}`
                  return (
                    <li key={course.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                      <label className={`flex min-w-0 flex-1 items-start gap-3 ${editable ? 'cursor-pointer' : 'opacity-60'}`}>
                        <input type="checkbox" checked={Boolean(course.alignmentId)} disabled={!editable || busy} onChange={(e) => updateCourse(course, e.target.checked)} className="mt-1 size-4 accent-moss" />
                        <span className="min-w-0"><span className="block text-sm text-ink font-medium break-words">{course.name}</span><span className="block text-xs text-secondary mt-0.5">{course.status.replace('_', ' ')}{!editable && ' · create or edit a draft to change alignment'}</span></span>
                      </label>
                      {course.alignmentId && editable && (
                        <label className="flex items-center gap-2 text-xs text-secondary pl-7 sm:pl-0">Target level
                          <select value={course.level} disabled={busy} onChange={(e) => updateCourse(course, true, Number(e.target.value))} className="rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
                            {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
                          </select>
                        </label>
                      )}
                    </li>
                  )
                })}
              </AlignmentSection>
            ) : (
              <AlignmentSection
                id="resources-panel"
                title="Resources aligned to this skill"
                description="Select reusable resources that support development of this skill. The original resource stays in your library."
                empty="No resources have been added yet."
              >
                {alignment.resources.map((resource) => (
                  <li key={resource.id} className="p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={Boolean(resource.alignmentId)} disabled={savingKey === `resource-${resource.id}`} onChange={(e) => updateResource(resource, e.target.checked)} className="mt-1 size-4 accent-moss" />
                      <span className="min-w-0"><span className="block text-sm text-ink font-medium break-words">{resource.title}</span><span className="block text-xs text-secondary mt-0.5">{resource.type.replace('_', ' ')}</span></span>
                    </label>
                  </li>
                ))}
              </AlignmentSection>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function AlignmentSection({ id, title, description, empty, children }) {
  const items = Array.isArray(children) ? children : [children].filter(Boolean)
  return (
    <section id={id} role="tabpanel" aria-labelledby={`${id.replace('-panel', '')}-tab`}>
      <div className="mb-4 max-w-2xl">
        <h2 className="font-display text-lg text-ink">{title}</h2>
        <p className="text-sm text-secondary mt-1">{description}</p>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg"><p className="text-secondary">{empty}</p></div>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-lg bg-card">{children}</ul>
      )}
    </section>
  )
}
