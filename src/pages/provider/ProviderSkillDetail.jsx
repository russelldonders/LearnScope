import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import { useAuth } from '../../context/AuthContext'
import { listOrganisations } from '../../lib/admin/organisations'
import { getProviderSkillAlignment, listOrganisationOfferedSkills, setResourceSkillAlignment, setTrainingSkillAlignment } from '../../lib/admin/providerSkills'

const TABS = [{ key: 'training', label: 'Training' }, { key: 'resources', label: 'Resources' }]

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
  const [showAdd, setShowAdd] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [selectedResourceId, setSelectedResourceId] = useState('')
  const [targetLevel, setTargetLevel] = useState(1)
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
        listOrganisationOfferedSkills(organisationId), listOrganisations(), getProviderSkillAlignment(organisationId, skillId),
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

  async function refreshAlignment() {
    setAlignment(await getProviderSkillAlignment(organisationId, skillId))
  }

  async function addTraining() {
    if (!selectedCourseId) return
    setSavingKey(`course-${selectedCourseId}`)
    setError(null)
    try {
      await setTrainingSkillAlignment(selectedCourseId, skillId, true, targetLevel)
      setSelectedCourseId('')
      setTargetLevel(1)
      setShowAdd(false)
      await refreshAlignment()
    } catch (err) { setError(err.message) } finally { setSavingKey(null) }
  }

  async function updateTrainingLevel(course, level) {
    setSavingKey(`course-${course.id}`)
    setError(null)
    try {
      await setTrainingSkillAlignment(course.id, skillId, true, level)
      await refreshAlignment()
    } catch (err) { setError(err.message) } finally { setSavingKey(null) }
  }

  async function removeTraining(course) {
    setSavingKey(`course-${course.id}`)
    setError(null)
    try {
      await setTrainingSkillAlignment(course.id, skillId, false)
      await refreshAlignment()
    } catch (err) { setError(err.message) } finally { setSavingKey(null) }
  }

  async function addResource() {
    if (!selectedResourceId) return
    setSavingKey(`resource-${selectedResourceId}`)
    setError(null)
    try {
      await setResourceSkillAlignment(selectedResourceId, skillId, user.id, true)
      setSelectedResourceId('')
      setShowAdd(false)
      await refreshAlignment()
    } catch (err) { setError(err.message) } finally { setSavingKey(null) }
  }

  async function removeResource(resource) {
    setSavingKey(`resource-${resource.id}`)
    setError(null)
    try {
      await setResourceSkillAlignment(resource.id, skillId, user.id, false)
      await refreshAlignment()
    } catch (err) { setError(err.message) } finally { setSavingKey(null) }
  }

  const alignedTraining = alignment.courses.filter((item) => item.alignmentId)
  const availableTraining = alignment.courses.filter((item) => !item.alignmentId)
  const alignedResources = alignment.resources.filter((item) => item.alignmentId)
  const availableResources = alignment.resources.filter((item) => !item.alignmentId)

  function changeTab(tab) {
    setShowAdd(false)
    setSearchParams(tab === 'training' ? {} : { tab })
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/provider" state={{ providerSection: 'skills', organisationId }} className="inline-flex items-center min-h-11 text-sm text-moss font-medium hover:underline underline-offset-2">← Back to skills</Link>
        {loading ? <p className="text-secondary py-8">Loading skill…</p> : !skill ? (
          <div className="mt-4 rounded-lg border border-hairline bg-card p-5"><h1 className="font-display text-xl text-ink">Skill unavailable</h1><p className={`text-sm mt-2 ${error ? 'text-red-700' : 'text-secondary'}`}>{error || 'This skill is not offered by the selected organisation.'}</p></div>
        ) : (
          <>
            <header className="mt-3 mb-7 max-w-3xl">
              <p className="text-sm text-secondary mb-1">{organisation?.name || 'Provider organisation'}</p>
              <h1 className="font-display text-2xl sm:text-3xl text-ink text-balance">{skill.name}</h1>
              <p className="text-sm text-secondary mt-2">{[skill.category, skill.description].filter(Boolean).join(' · ') || 'Align this skill with your organisation’s published learning offer.'}</p>
            </header>
            {error && <p className="text-sm text-red-700 mb-4" role="alert">{error}</p>}
            <div className="border-b border-hairline mb-6" role="tablist" aria-label="Skill management"><div className="flex gap-1 overflow-x-auto">
              {TABS.map((tab) => {
                const count = tab.key === 'training' ? alignedTraining.length : alignedResources.length
                const selected = activeTab === tab.key
                return <button key={tab.key} id={`${tab.key}-tab`} type="button" role="tab" aria-selected={selected} aria-controls={`${tab.key}-panel`} onClick={() => changeTab(tab.key)} className={`relative min-h-11 px-4 whitespace-nowrap text-sm ${selected ? 'text-ink font-medium after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-moss' : 'text-secondary hover:text-ink'}`}>{tab.label}<span className="ml-2 rounded-full bg-moss/10 px-2 py-0.5 text-xs text-moss">{count}</span></button>
              })}
            </div></div>

            {activeTab === 'training' ? (
              <AlignmentSection id="training-panel" title="Training aligned to this skill" description="Add from your organisation’s current published training and set the level learners can work towards." addLabel={showAdd ? 'Close add form' : '+ Add training'} onAdd={() => setShowAdd((value) => !value)}>
                {showAdd && <TrainingAddForm items={availableTraining} selectedId={selectedCourseId} level={targetLevel} saving={Boolean(savingKey)} onSelect={setSelectedCourseId} onLevel={setTargetLevel} onAdd={addTraining} onCancel={() => setShowAdd(false)} />}
                <AlignedList empty="No published training is aligned yet.">
                  {alignedTraining.map((course) => <li key={course.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="min-w-0 flex-1"><p className="text-sm text-ink font-medium break-words">{course.name}</p><p className="text-xs text-secondary mt-0.5">Published · version {course.version_number ?? 1}</p></div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-secondary">Target level<select value={course.level} disabled={savingKey === `course-${course.id}`} onChange={(event) => updateTrainingLevel(course, Number(event.target.value))} className="rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">{[1,2,3,4,5].map((level) => <option key={level} value={level}>{level}</option>)}</select></label><button type="button" disabled={savingKey === `course-${course.id}`} onClick={() => removeTraining(course)} className="min-h-11 text-xs text-red-700 font-medium hover:underline disabled:opacity-50">Remove</button></div></li>)}
                </AlignedList>
              </AlignmentSection>
            ) : (
              <AlignmentSection id="resources-panel" title="Resources aligned to this skill" description="Add from your organisation’s current published resources. The original resource stays in the library." addLabel={showAdd ? 'Close add form' : '+ Add resource'} onAdd={() => setShowAdd((value) => !value)}>
                {showAdd && <ResourceAddForm items={availableResources} selectedId={selectedResourceId} saving={Boolean(savingKey)} onSelect={setSelectedResourceId} onAdd={addResource} onCancel={() => setShowAdd(false)} />}
                <AlignedList empty="No published resources are aligned yet.">
                  {alignedResources.map((resource) => <li key={resource.id} className="p-4 flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm text-ink font-medium break-words">{resource.title}</p><p className="text-xs text-secondary mt-0.5">{resource.type.replace('_', ' ')} · version {resource.version_number ?? 1}</p></div><button type="button" disabled={savingKey === `resource-${resource.id}`} onClick={() => removeResource(resource)} className="shrink-0 min-h-11 text-xs text-red-700 font-medium hover:underline disabled:opacity-50">Remove</button></li>)}
                </AlignedList>
              </AlignmentSection>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function AlignmentSection({ id, title, description, addLabel, onAdd, children }) {
  return <section id={id} role="tabpanel" aria-labelledby={`${id.replace('-panel', '')}-tab`}><div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4"><div className="max-w-2xl"><h2 className="font-display text-lg text-ink">{title}</h2><p className="text-sm text-secondary mt-1">{description}</p></div><button type="button" onClick={onAdd} className="self-start shrink-0 rounded-md bg-moss text-paper py-2 px-3 text-sm font-medium hover:opacity-90">{addLabel}</button></div>{children}</section>
}

function TrainingAddForm({ items, selectedId, level, saving, onSelect, onLevel, onAdd, onCancel }) {
  return <div className="bg-card border border-hairline rounded-lg p-4 mb-4"><h3 className="font-display text-base text-ink mb-3">Add published training</h3>{items.length === 0 ? <p className="text-sm text-secondary">All published training is already aligned.</p> : <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px_auto] gap-3 sm:items-end"><label className="text-xs text-secondary">Training<select value={selectedId} onChange={(event) => onSelect(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"><option value="">Choose training…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs text-secondary">Target level<select value={level} onChange={(event) => onLevel(Number(event.target.value))} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><div className="flex gap-2"><button type="button" onClick={onAdd} disabled={!selectedId || saving} className="rounded-md bg-moss text-paper px-4 py-2 text-sm font-medium disabled:opacity-50">Add</button><button type="button" onClick={onCancel} className="rounded-md border border-hairline px-3 py-2 text-sm text-ink">Cancel</button></div></div>}</div>
}

function ResourceAddForm({ items, selectedId, saving, onSelect, onAdd, onCancel }) {
  return <div className="bg-card border border-hairline rounded-lg p-4 mb-4"><h3 className="font-display text-base text-ink mb-3">Add published resource</h3>{items.length === 0 ? <p className="text-sm text-secondary">All published resources are already aligned.</p> : <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 sm:items-end"><label className="text-xs text-secondary">Resource<select value={selectedId} onChange={(event) => onSelect(event.target.value)} className="mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"><option value="">Choose a resource…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title} ({item.type.replace('_', ' ')})</option>)}</select></label><div className="flex gap-2"><button type="button" onClick={onAdd} disabled={!selectedId || saving} className="rounded-md bg-moss text-paper px-4 py-2 text-sm font-medium disabled:opacity-50">Add</button><button type="button" onClick={onCancel} className="rounded-md border border-hairline px-3 py-2 text-sm text-ink">Cancel</button></div></div>}</div>
}

function AlignedList({ empty, children }) {
  const items = Array.isArray(children) ? children : [children].filter(Boolean)
  return items.length === 0 ? <div className="text-center py-12 border border-dashed border-hairline rounded-lg"><p className="text-secondary">{empty}</p></div> : <ul className="divide-y divide-hairline border border-hairline rounded-lg bg-card">{children}</ul>
}
