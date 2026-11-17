import { useId, useMemo, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { listLibrarySkills } from '../lib/skillLibrary'
import { listCatalogueCourses } from '../lib/courseCatalogue'
import { KNOWLEDGE_LEVEL_LABELS, LEVEL_LABELS, LEVELS } from '../lib/levels'
import {
  PLAN_SEQUENCES,
  PREREQUISITE_ENFORCEMENTS,
  addPrerequisite,
  addPrerequisiteGroup,
  removePrerequisite,
  removePrerequisiteGroup,
  setPlanSequence,
  prerequisiteLabel,
  setPrerequisiteGroupEnforcement,
} from '../lib/planSettings'

const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-moss'

// A plan's less-used settings, behind the cog in edit mode: the order its
// activities are worked through in, and its prerequisites. Every change
// saves straight away through `run`, which reloads the plan.
export default function PlanSettingsDialog({ plan, prerequisites, busy, run, onClose, t }) {
  const titleId = useId()
  const orderId = useId()
  // Which group an option is being added to: a group's id, 'new' for a new
  // group, or null.
  const [addingTo, setAddingTo] = useState(null)
  // The library and catalogue, loaded the first time an option is added.
  const [choices, setChoices] = useState(null)
  const [choicesError, setChoicesError] = useState(null)

  function openAdd(target) {
    setAddingTo(target)
    if (choices) return
    Promise.all([listLibrarySkills(), listCatalogueCourses()])
      .then(([skills, courses]) => setChoices({ skill: skills, course: courses }))
      .catch((err) => setChoicesError(err.message))
  }

  return (
    <AccessibleDialog
      labelledBy={titleId}
      onClose={onClose}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-hairline bg-card shadow-xl"
    >
      <div className="flex max-h-[90vh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            <h2 id={titleId} className="font-display text-xl text-ink">{t('plans.settings.title')}</h2>
            <p className="mt-1 text-sm text-secondary">{t('plans.settings.description')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('plans.settings.close')} className="-mr-1 rounded-md p-1.5 text-secondary hover:bg-paper hover:text-ink">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="min-h-0 space-y-6 overflow-y-auto px-5 py-4">
          <fieldset aria-describedby={`${orderId}-hint`}>
            <legend className="text-sm font-medium text-ink">{t('plans.settings.orderHeading')}</legend>
            <p id={`${orderId}-hint`} className="text-xs text-secondary">{t('plans.settings.orderHint')}</p>
            <div className="mt-2 space-y-2">
              {PLAN_SEQUENCES.map((value) => (
                <label key={value} className="flex cursor-pointer items-start gap-2 rounded-md border border-hairline px-3 py-2 has-[:checked]:border-moss has-[:checked]:bg-moss/5">
                  <input
                    type="radio"
                    name={`${orderId}-sequence`}
                    value={value}
                    checked={(plan.sequence ?? 'none') === value}
                    disabled={busy}
                    onChange={() => run(() => setPlanSequence(plan.id, value))}
                    className="mt-0.5 accent-moss"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{t(`plans.settings.sequence.${value}`)}</span>
                    <span className="block text-xs text-secondary">{t(`plans.settings.sequenceHint.${value}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <section aria-labelledby={`${titleId}-prereqs`}>
            <h3 id={`${titleId}-prereqs`} className="text-sm font-medium text-ink">{t('plans.settings.prerequisitesHeading')}</h3>
            <p className="text-xs text-secondary">{t('plans.settings.prerequisitesHint')}</p>
            {choicesError && <p role="alert" className="mt-2 text-sm text-red-700">{choicesError}</p>}

            <ol className="mt-3 space-y-3">
              {prerequisites.map((group, index) => (
                <li key={group.id}>
                  {index > 0 && <p aria-hidden="true" className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-secondary">{t('plans.settings.and')}</p>}
                  <div data-prerequisite-group={group.enforcement} className="rounded-md border border-hairline p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-secondary">{group.options.length > 1 ? t('plans.settings.anyOneOf') : t('plans.settings.needs')}</p>
                      <div className="flex items-center gap-3">
                        <label className="sr-only" htmlFor={`${group.id}-enforcement`}>{t('plans.settings.enforcementLabel')}</label>
                        <select
                          id={`${group.id}-enforcement`}
                          value={group.enforcement}
                          disabled={busy}
                          onChange={(e) => run(() => setPrerequisiteGroupEnforcement(group.id, e.target.value))}
                          className="rounded-md border border-hairline bg-paper px-2 py-1 text-xs text-ink focus:outline-none focus:border-moss"
                        >
                          {PREREQUISITE_ENFORCEMENTS.map((value) => <option key={value} value={value}>{t(`plans.settings.enforcement.${value}`)}</option>)}
                        </select>
                        <button type="button" disabled={busy} onClick={() => run(() => removePrerequisiteGroup(group.id))} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60">
                          {t('plans.remove')}
                        </button>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {group.options.map((option, optionIndex) => (
                        <li key={option.id} className="flex items-start justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words text-ink">
                            {optionIndex > 0 && <span className="mr-1 text-xs text-secondary">{t('plans.settings.or')}</span>}
                            {prerequisiteLabel(option, t)}
                          </span>
                          {group.options.length > 1 && (
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={t('plans.settings.removeOption', { name: option.name ?? '' })}
                              onClick={() => run(() => removePrerequisite(option.id))}
                              className="shrink-0 text-xs text-secondary hover:text-red-700 disabled:opacity-60"
                            >
                              ×
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {addingTo === group.id ? (
                      <PrerequisiteForm
                        choices={choices}
                        busy={busy}
                        t={t}
                        exclude={group.options}
                        onCancel={() => setAddingTo(null)}
                        onSubmit={async (values) => {
                          const ok = await run(() => addPrerequisite(plan.id, group.id, values))
                          if (ok) setAddingTo(null)
                        }}
                      />
                    ) : (
                      <button type="button" onClick={() => openAdd(group.id)} className="mt-2 text-xs font-medium text-moss hover:underline">
                        {t('plans.settings.addAlternative')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {addingTo === 'new' ? (
              <PrerequisiteForm
                choices={choices}
                busy={busy}
                t={t}
                withEnforcement
                onCancel={() => setAddingTo(null)}
                onSubmit={async ({ enforcement, ...values }) => {
                  const ok = await run(async () => {
                    const groupId = await addPrerequisiteGroup(plan.id, { enforcement, position: prerequisites.length })
                    try {
                      await addPrerequisite(plan.id, groupId, values)
                    } catch (err) {
                      // Don't leave an empty group behind.
                      await removePrerequisiteGroup(groupId).catch(() => {})
                      throw err
                    }
                  })
                  if (ok) setAddingTo(null)
                }}
              />
            ) : (
              <button type="button" onClick={() => openAdd('new')} className="mt-3 rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss">
                {t('plans.settings.addPrerequisite')}
              </button>
            )}
          </section>
        </div>
      </div>
    </AccessibleDialog>
  )
}

// Choosing one option: a skill from the library at a level, or a course
// from the catalogue. With `withEnforcement`, also whether it's required.
function PrerequisiteForm({ choices, busy, t, exclude = [], withEnforcement = false, onSubmit, onCancel }) {
  const idPrefix = useId()
  const [kind, setKind] = useState('skill')
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(null)
  const [practical, setPractical] = useState('3')
  const [knowledge, setKnowledge] = useState('')
  const [enforcement, setEnforcement] = useState('guidance')
  const [error, setError] = useState(null)

  const matches = useMemo(() => {
    const taken = new Set(exclude.map((option) => option.library_skill_id ?? option.catalogue_course_id))
    const q = query.trim().toLowerCase()
    return (choices?.[kind] ?? [])
      .filter((entry) => !taken.has(entry.id) && (!q || entry.name.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [choices, kind, query, exclude])

  return (
    <form
      noValidate
      aria-label={t('plans.settings.addPrerequisite')}
      className="mt-3 space-y-3 rounded-md border border-hairline bg-paper p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!chosen) return setError(t(kind === 'skill' ? 'plans.settings.errorChooseSkill' : 'plans.settings.errorChooseCourse'))
        if (kind === 'skill' && !practical && !knowledge) return setError(t('plans.settings.errorChooseLevel'))
        setError(null)
        onSubmit(kind === 'skill'
          ? { kind, librarySkillId: chosen.id, minPracticalLevel: practical, minKnowledgeLevel: knowledge, enforcement }
          : { kind, catalogueCourseId: chosen.id, enforcement })
      }}
    >
      <div role="radiogroup" aria-label={t('plans.settings.kindLabel')} className="flex gap-2">
        {['skill', 'course'].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => { setKind(value); setChosen(null); setQuery(''); setError(null) }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${kind === value ? 'bg-moss text-paper' : 'border border-hairline text-secondary hover:text-ink'}`}
          >
            {t(`plans.settings.kind.${value}`)}
          </button>
        ))}
      </div>

      {chosen ? (
        <p className="flex items-center justify-between gap-3 text-sm text-ink">
          <span className="min-w-0 break-words font-medium">{chosen.name}</span>
          <button type="button" onClick={() => setChosen(null)} className="shrink-0 text-xs text-moss font-medium hover:underline">{t('plans.settings.change')}</button>
        </p>
      ) : (
        <div>
          <label htmlFor={`${idPrefix}-search`} className="text-xs text-secondary">
            {t(kind === 'skill' ? 'plans.settings.searchSkills' : 'plans.settings.searchCourses')}
          </label>
          <input id={`${idPrefix}-search`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} />
          {!choices ? (
            <p className="mt-2 text-xs text-secondary">{t('plans.settings.loadingChoices')}</p>
          ) : matches.length === 0 ? (
            <p className="mt-2 text-xs text-secondary">{t('plans.settings.noMatches')}</p>
          ) : (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => { setChosen(entry); setError(null) }} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-moss/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss">
                    {entry.name}
                    {kind === 'course' && entry.provider && <span className="text-xs text-secondary"> — {entry.provider}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === 'skill' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-practical`} className="text-xs text-secondary">{t('plans.settings.minAbility')}</label>
            <select id={`${idPrefix}-practical`} value={practical} onChange={(e) => setPractical(e.target.value)} className={inputClass}>
              <option value="">{t('plans.settings.anyLevel')}</option>
              {LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABELS[level]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-knowledge`} className="text-xs text-secondary">{t('plans.settings.minKnowledge')}</label>
            <select id={`${idPrefix}-knowledge`} value={knowledge} onChange={(e) => setKnowledge(e.target.value)} className={inputClass}>
              <option value="">{t('plans.settings.anyLevel')}</option>
              {LEVELS.map((level) => <option key={level} value={level}>{KNOWLEDGE_LEVEL_LABELS[level]}</option>)}
            </select>
          </div>
        </div>
      )}

      {withEnforcement && (
        <div>
          <label htmlFor={`${idPrefix}-enforcement`} className="text-xs text-secondary">{t('plans.settings.enforcementLabel')}</label>
          <select id={`${idPrefix}-enforcement`} value={enforcement} onChange={(e) => setEnforcement(e.target.value)} className={inputClass}>
            {PREREQUISITE_ENFORCEMENTS.map((value) => <option key={value} value={value}>{t(`plans.settings.enforcement.${value}`)}</option>)}
          </select>
          <p className="mt-1 text-xs text-secondary">{t(`plans.settings.enforcementHint.${enforcement}`)}</p>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">
          {t('plans.settings.add')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}
