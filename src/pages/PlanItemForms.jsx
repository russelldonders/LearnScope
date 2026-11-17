import { useCallback, useEffect, useId, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import SkillGoalModal from '../components/SkillGoalModal'
import EvidenceFields from '../components/EvidenceFields'
import { localDateString } from '../lib/skillGoalProgress'
import { ResourceForm } from '../components/SkillResourcesSection'
import { listConnections } from '../lib/connections'
import { addResource } from '../lib/skillResources'
import { listPlannableRecords, PLAN_RESOURCE_VISIBILITIES } from '../lib/learnerPlans'
import { KNOWLEDGE_LEVEL_LABELS, LEVEL_LABELS, LEVELS } from '../lib/levels'

// The forms on a plan's page: completing a step, and adding or editing
// sections and items (see PlanDetail.jsx).

const CONTENT_ITEM_TYPES = ['course', 'skill_goal', 'skill_resource', 'step']

const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-moss'

// Marking a step done: when (today, or an earlier day), what happened, and
// anything that shows it -- recorded on the activity the tick creates.
export function CompleteStepForm({ busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const today = localDateString()
  const [completedOn, setCompletedOn] = useState(today)
  const [comment, setComment] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const idPrefix = `complete-step-${useId()}`

  return (
    <form
      noValidate
      aria-label={t('plans.completeStepTitle')}
      className="mt-2 space-y-3 rounded-md border border-hairline bg-paper p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!completedOn || completedOn > today) return setError(t('plans.errorFutureDate'))
        setError(null)
        onSubmit({ completedOn, comment, evidence: { evidenceUrl, files } })
      }}
    >
      <p className="text-sm font-medium text-ink">{t('plans.completeStepTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label htmlFor={`${idPrefix}-date`} className="text-xs text-secondary">{t('plans.completedOnLabel')}</label>
          <input id={`${idPrefix}-date`} type="date" max={today} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-comment`} className="text-xs text-secondary">{t('plans.commentLabel')}</label>
          <textarea id={`${idPrefix}-comment`} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('plans.commentPlaceholder')} className={inputClass} />
        </div>
      </div>
      {showEvidence ? (
        <EvidenceFields
          evidenceUrl={evidenceUrl}
          onEvidenceUrlChange={setEvidenceUrl}
          files={files}
          onFilesChange={setFiles}
          onHide={() => setShowEvidence(false)}
        />
      ) : (
        <button type="button" onClick={() => setShowEvidence(true)} className="text-xs text-moss font-medium hover:underline">
          {t('plans.addEvidence')}
        </button>
      )}
      <p className="text-xs text-secondary">{t('plans.activityHint')}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">
          {busy ? t('plans.saving') : t('plans.markDoneButton')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}

export function SectionForm({ section = null, busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(section?.title ?? '')
  const [targetOn, setTargetOn] = useState(section?.target_on ?? '')
  const [error, setError] = useState(null)
  const idPrefix = `section-${section?.id ?? 'new'}`
  return (
    <form
      noValidate
      className="space-y-3 rounded-md border border-hairline bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return setError(t('plans.errorSectionTitle'))
        setError(null)
        onSubmit({ title, targetOn })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={`${idPrefix}-title`} className="text-xs text-secondary">{t('plans.sectionTitleLabel')}</label>
          <input id={`${idPrefix}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('plans.sectionTitlePlaceholder')} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-target`} className="text-xs text-secondary">{t('plans.sectionTargetLabel')}</label>
          <input id={`${idPrefix}-target`} type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">
          {section ? t('plans.saveChanges') : t('plans.addSection')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}

function recordLabel(type, record, t) {
  switch (type) {
    case 'course': return record.provider ? `${record.name} — ${record.provider}` : record.name
    case 'skill': return record.name
    case 'skill_goal': return record.skill_name ? `${record.title} (${record.skill_name})` : record.title
    case 'skill_resource': return `${record.title} · ${t(`skillDetail.resources.kinds.${record.kind}`)}`
    default: return ''
  }
}

export function AddItemForm({ userId, busy, allowedTypes = CONTENT_ITEM_TYPES, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const [records, setRecords] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [itemType, setItemType] = useState(allowedTypes[0])
  const [recordId, setRecordId] = useState('')
  const [stepTitle, setStepTitle] = useState('')
  const [stepSkillId, setStepSkillId] = useState('')
  const [targetOn, setTargetOn] = useState('')
  const [note, setNote] = useState('')
  const [planKnowledgeLevel, setPlanKnowledgeLevel] = useState('')
  const [planPracticalLevel, setPlanPracticalLevel] = useState('')
  // Who on the plan sees a resource added to it; everyone, unless chosen.
  const [visibility, setVisibility] = useState('members')
  const [error, setError] = useState(null)
  // Making a new goal or resource here, rather than picking an existing one.
  const [creatingGoal, setCreatingGoal] = useState(false)
  const [creatingResource, setCreatingResource] = useState(false)
  const [resourceSkillId, setResourceSkillId] = useState('')
  const [connections, setConnections] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listPlannableRecords(userId).then(setRecords).catch((err) => setLoadError(err.message))
  }, [userId])

  const ensureConnections = useCallback(() => {
    if (connections !== null) return
    listConnections(userId).then(setConnections).catch(() => setConnections([]))
  }, [connections, userId])

  const options = itemType === 'step' ? [] : records?.[itemType] ?? []
  const skills = records?.skill ?? []
  const resourceSkill = skills.find((skill) => skill.id === resourceSkillId) ?? null

  return (
    <>
      {creatingResource ? (
        <div className="mt-2 space-y-3 rounded-md border border-hairline bg-card p-3">
          <p className="text-sm font-medium text-ink">{t('plans.newResourceTitle')}</p>
          <div>
            <label htmlFor="plan-new-resource-skill" className="text-xs text-secondary">{t('plans.newResourceSkill')}</label>
            {skills.length === 0 ? (
              <p className="text-sm text-secondary">{t('plans.noneYet.skill')}</p>
            ) : (
              <select id="plan-new-resource-skill" value={resourceSkillId} onChange={(e) => setResourceSkillId(e.target.value)} className={inputClass}>
                <option value="">{t('plans.choosePrompt')}</option>
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
              </select>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {resourceSkill ? (
            <ResourceForm
              key={resourceSkill.id}
              hasLibrarySkill={Boolean(resourceSkill.library_skill_id)}
              connections={connections}
              onNeedConnections={ensureConnections}
              busy={busy || saving}
              submitLabel={t('plans.createAndAdd')}
              onCancel={() => setCreatingResource(false)}
              // Who sees it is the plan's choice; the resource itself stays
              // private in the learner's own skill.
              audienceSlot={<PlanVisibilityField idPrefix="plan-new-resource" value={visibility} onChange={setVisibility} />}
              onSubmit={async (values) => {
                setSaving(true)
                setError(null)
                try {
                  const id = await addResource({ userId, skillId: resourceSkill.id, ...values })
                  await onSubmit({ itemType: 'skill_resource', recordId: id, targetOn, note, visibility })
                } catch (err) {
                  setError(err.message)
                } finally {
                  setSaving(false)
                }
              }}
            />
          ) : (
            <button type="button" onClick={() => setCreatingResource(false)} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
          )}
        </div>
      ) : (
        <form
          noValidate
          className="mt-2 space-y-3 rounded-md border border-hairline bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (itemType === 'step' ? !stepTitle.trim() : !recordId) return setError(t(itemType === 'step' ? 'plans.errorStepTitle' : 'plans.errorChooseRecord'))
            if (itemType === 'skill' && !planKnowledgeLevel && !planPracticalLevel) return setError(t('plans.errorPlanSkillLevel'))
            setError(null)
            onSubmit({ itemType, recordId, stepTitle, stepSkillId, targetOn, note, planKnowledgeLevel, planPracticalLevel, visibility })
          }}
        >
          {allowedTypes.length > 1 && <fieldset>
            <legend className="text-xs text-secondary">{t('plans.itemTypeLabel')}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {allowedTypes.map((type) => (
                <label key={type} className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium ${itemType === type ? 'border-moss text-moss' : 'border-hairline text-ink'}`}>
                  <input type="radio" name="plan-item-type" value={type} checked={itemType === type} onChange={() => { setItemType(type); setRecordId(''); setError(null) }} className="sr-only" />
                  {t(`plans.itemTypes.${type}`)}
                </label>
              ))}
            </div>
          </fieldset>}

          {itemType === 'step' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="plan-item-step" className="text-xs text-secondary">{t('plans.stepLabel')}</label>
                <input id="plan-item-step" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} maxLength={200} placeholder={t('plans.stepPlaceholder')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="plan-item-step-skill" className="text-xs text-secondary">{t('plans.stepSkillLabel')}</label>
                <select id="plan-item-step-skill" value={stepSkillId} onChange={(e) => setStepSkillId(e.target.value)} className={inputClass}>
                  <option value="">{t('plans.noSkill')}</option>
                  {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="plan-item-record" className="text-xs text-secondary">{t(`plans.choose.${itemType}`)}</label>
              {loadError ? (
                <p role="alert" className="text-sm text-red-700">{loadError}</p>
              ) : records === null ? (
                <p className="text-sm text-secondary">{t('plans.loading')}</p>
              ) : options.length === 0 ? (
                <p className="text-sm text-secondary">{t(`plans.noneYet.${itemType}`)}</p>
              ) : (
                <select id="plan-item-record" value={recordId} onChange={(e) => setRecordId(e.target.value)} className={inputClass}>
                  <option value="">{t('plans.choosePrompt')}</option>
                  {options.map((record) => (
                    <option key={record.id} value={record.id}>{recordLabel(itemType, record, t)}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {itemType === 'skill' && (
            <fieldset>
              <legend className="text-xs text-secondary">{t('plans.planSkillLevelsLegend')}</legend>
              <p className="mt-0.5 text-xs text-secondary">{t('plans.planSkillLevelsHint')}</p>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="plan-item-knowledge-level" className="text-xs text-secondary">{t('plans.planKnowledgeLevelLabel')}</label>
                  <select id="plan-item-knowledge-level" value={planKnowledgeLevel} onChange={(event) => setPlanKnowledgeLevel(event.target.value)} className={inputClass}>
                    <option value="">{t('plans.noPlanLevel')}</option>
                    {LEVELS.map((level) => <option key={level} value={level}>{level} · {KNOWLEDGE_LEVEL_LABELS[level]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="plan-item-practical-level" className="text-xs text-secondary">{t('plans.planAbilityLevelLabel')}</label>
                  <select id="plan-item-practical-level" value={planPracticalLevel} onChange={(event) => setPlanPracticalLevel(event.target.value)} className={inputClass}>
                    <option value="">{t('plans.noPlanLevel')}</option>
                    {LEVELS.map((level) => <option key={level} value={level}>{level} · {LEVEL_LABELS[level]}</option>)}
                  </select>
                </div>
              </div>
            </fieldset>
          )}

          {itemType === 'skill_goal' && (
            <button type="button" onClick={() => setCreatingGoal(true)} className="text-xs text-moss font-medium hover:underline">
              {t('plans.createGoal')}
            </button>
          )}
          {itemType === 'skill_resource' && (
            <PlanVisibilityField idPrefix="plan-item" value={visibility} onChange={setVisibility} />
          )}
          {itemType === 'skill_resource' && (
            <button type="button" onClick={() => { setError(null); setCreatingResource(true) }} className="text-xs text-moss font-medium hover:underline">
              {t('plans.createResource')}
            </button>
          )}
          {(itemType === 'step' || itemType === 'skill_resource') && (
            <p className="text-xs text-secondary">{t('plans.activityHint')}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="plan-item-target" className="text-xs text-secondary">{t('plans.itemTargetLabel')}</label>
              <input id="plan-item-target" type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="plan-item-note" className="text-xs text-secondary">{t('plans.noteLabel')}</label>
              <input id="plan-item-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputClass} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">{t('plans.addToPlan')}</button>
            <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
          </div>
        </form>
      )}

      {/* The same goal dialog as on Home: the learner describes the goal (AI
          drafts it) and picks or names its skill. The new goal goes straight
          into the plan. */}
      {creatingGoal && (
        <SkillGoalModal
          userId={userId}
          onClose={() => setCreatingGoal(false)}
          onSaved={async (created) => {
            setCreatingGoal(false)
            if (created) await onSubmit({ itemType: 'skill_goal', recordId: created.id, targetOn, note })
          }}
        />
      )}
    </>
  )
}

// Who on the plan sees a resource: only whoever added it, all owners, or
// everyone following the plan (the default).
function PlanVisibilityField({ idPrefix, value, onChange }) {
  const { t } = useLanguage()
  return (
    <fieldset>
      <legend className="text-xs text-secondary">{t('plans.visibilityLabel')}</legend>
      <div className="mt-1 space-y-1.5">
        {PLAN_RESOURCE_VISIBILITIES.slice().reverse().map((option) => (
          <label key={option} className="flex cursor-pointer items-start gap-2 text-sm text-ink">
            <input
              type="radio"
              name={`${idPrefix}-visibility`}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="mt-1 accent-moss"
            />
            <span>
              {t(`plans.visibility.${option}`)}
              <span className="block text-xs text-secondary">{t(`plans.visibilityHints.${option}`)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ItemEditForm({ item, sections, busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const isStep = item.item_type === 'step'
  // Who sees a resource is the choice of whoever added it (0304).
  const isResource = item.item_type === 'skill_resource' && item.is_author !== false
  const [visibility, setVisibility] = useState(item.visibility ?? 'members')
  const isSkill = item.item_type === 'skill'
  // A step's skill is a record of whoever added it, so only they change it.
  const canChangeStepSkill = isStep && item.is_author !== false
  const [stepTitle, setStepTitle] = useState(item.step_title ?? '')
  const [stepSkillId, setStepSkillId] = useState(item.step_skill_id ?? '')
  const [skills, setSkills] = useState([])
  const [targetOn, setTargetOn] = useState(item.target_on ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [sectionId, setSectionId] = useState(item.section_id ?? '')
  const [planKnowledgeLevel, setPlanKnowledgeLevel] = useState(item.plan_knowledge_level ?? '')
  const [planPracticalLevel, setPlanPracticalLevel] = useState(item.plan_practical_level ?? '')
  const [error, setError] = useState(null)
  const idPrefix = `plan-item-${item.id}`

  useEffect(() => {
    if (!canChangeStepSkill) return
    listPlannableRecords(user.id).then((records) => setSkills(records.skill)).catch(() => {})
  }, [canChangeStepSkill, user.id])

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (isStep && !stepTitle.trim()) return setError(t('plans.errorStepTitle'))
        if (isSkill && !planKnowledgeLevel && !planPracticalLevel) return setError(t('plans.errorPlanSkillLevel'))
        setError(null)
        onSubmit({
          targetOn,
          note,
          sectionId,
          stepTitle: isStep ? stepTitle : undefined,
          stepSkillId: canChangeStepSkill ? stepSkillId : undefined,
          planKnowledgeLevel: isSkill ? planKnowledgeLevel : undefined,
          planPracticalLevel: isSkill ? planPracticalLevel : undefined,
          visibility: isResource ? visibility : undefined,
        })
      }}
    >
      {isStep && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-step`} className="text-xs text-secondary">{t('plans.stepLabel')}</label>
            <input id={`${idPrefix}-step`} value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} maxLength={200} className={inputClass} />
          </div>
          {canChangeStepSkill && <div>
            <label htmlFor={`${idPrefix}-step-skill`} className="text-xs text-secondary">{t('plans.stepSkillLabel')}</label>
            <select id={`${idPrefix}-step-skill`} value={stepSkillId} onChange={(e) => setStepSkillId(e.target.value)} className={inputClass}>
              <option value="">{t('plans.noSkill')}</option>
              {/* The current skill stays listed even before the list loads. */}
              {item.step_skill && !skills.some((s) => s.id === item.step_skill.id) && (
                <option value={item.step_skill.id}>{item.step_skill.name}</option>
              )}
              {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </div>}
        </div>
      )}
      {isResource && (
        <PlanVisibilityField idPrefix={idPrefix} value={visibility} onChange={setVisibility} />
      )}
      {isSkill && (
        <fieldset>
          <legend className="text-xs text-secondary">{t('plans.planSkillLevelsLegend')}</legend>
          <p className="mt-0.5 text-xs text-secondary">{t('plans.planSkillLevelsHint')}</p>
          <div className="mt-1 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${idPrefix}-knowledge-level`} className="text-xs text-secondary">{t('plans.planKnowledgeLevelLabel')}</label>
              <select id={`${idPrefix}-knowledge-level`} value={planKnowledgeLevel} onChange={(event) => setPlanKnowledgeLevel(event.target.value)} className={inputClass}>
                <option value="">{t('plans.noPlanLevel')}</option>
                {LEVELS.map((level) => <option key={level} value={level}>{level} · {KNOWLEDGE_LEVEL_LABELS[level]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${idPrefix}-practical-level`} className="text-xs text-secondary">{t('plans.planAbilityLevelLabel')}</label>
              <select id={`${idPrefix}-practical-level`} value={planPracticalLevel} onChange={(event) => setPlanPracticalLevel(event.target.value)} className={inputClass}>
                <option value="">{t('plans.noPlanLevel')}</option>
                {LEVELS.map((level) => <option key={level} value={level}>{level} · {LEVEL_LABELS[level]}</option>)}
              </select>
            </div>
          </div>
        </fieldset>
      )}
      <div className={`grid gap-3 ${isSkill ? '' : 'sm:grid-cols-2'}`}>
        {!isSkill && <div>
          <label htmlFor={`${idPrefix}-section`} className="text-xs text-secondary">{t('plans.sectionLabel')}</label>
          <select id={`${idPrefix}-section`} value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={inputClass}>
            <option value="">{t('plans.noSection')}</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
          </select>
        </div>}
        <div>
          <label htmlFor={`${idPrefix}-target`} className="text-xs text-secondary">{t('plans.itemTargetLabel')}</label>
          <input id={`${idPrefix}-target`} type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-note`} className="text-xs text-secondary">{t('plans.noteLabel')}</label>
        <textarea id={`${idPrefix}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className={inputClass} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">{t('plans.saveChanges')}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}
