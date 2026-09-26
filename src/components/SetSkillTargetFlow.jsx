import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../context/LanguageContext'
import AccessibleDialog from './AccessibleDialog'
import SetTargetModal from './SetTargetModal'

// "Set new target" on the Skills tab's development-targets section: picks
// one of the learner's own skills first, then hands off to the existing
// per-skill SetTargetModal (the same one SkillDetail.jsx opens) -- this
// component only adds the skill-selection step in front of it, so setting a
// target doesn't require navigating to that skill's own page first.
export default function SetSkillTargetFlow({ skills, user, onClose, onSet }) {
  const { t } = useLanguage()
  const [chosenSkill, setChosenSkill] = useState(null)
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState([])
  const [loadingTargets, setLoadingTargets] = useState(false)
  const [loadError, setLoadError] = useState(null)

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return skills
    return skills.filter((s) => s.name.toLocaleLowerCase().includes(normalized))
  }, [skills, query])

  async function chooseSkill(skill) {
    setChosenSkill(skill)
    setLoadingTargets(true)
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('skill_targets')
        .select('*')
        .eq('skill_id', skill.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setTargets(data ?? [])
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoadingTargets(false)
    }
  }

  if (chosenSkill) {
    if (loadingTargets) {
      return (
        <AccessibleDialog
          labelledBy="set-target-flow-loading-title"
          onClose={onClose}
          panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
        >
          <h2 id="set-target-flow-loading-title" className="sr-only">{chosenSkill.name}</h2>
          <p className="text-secondary">Loading…</p>
        </AccessibleDialog>
      )
    }
    if (loadError) {
      return (
        <AccessibleDialog
          labelledBy="set-target-flow-error-title"
          onClose={onClose}
          panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
        >
          <h2 id="set-target-flow-error-title" className="font-display text-lg text-ink mb-2">{chosenSkill.name}</h2>
          <p role="alert" className="text-sm text-red-700 mb-4">{loadError}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
          >
            {t('modals.setTarget.cancel')}
          </button>
        </AccessibleDialog>
      )
    }
    return (
      <SetTargetModal
        skill={chosenSkill}
        user={user}
        targets={targets}
        currentLevel={chosenSkill.displayedLevel}
        onClose={onClose}
        onSet={onSet}
      />
    )
  }

  return (
    <AccessibleDialog
      labelledBy="set-target-flow-choose-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="set-target-flow-choose-title" className="font-display text-2xl text-ink mb-4">{t('skills.chooseSkill')}</h2>

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('skills.searchPlaceholder')}
        className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-moss"
      />

      {filteredSkills.length === 0 ? (
        <p className="text-sm text-secondary py-4">{t('skills.noMatch.title')}</p>
      ) : (
        <ul className="divide-y divide-hairline max-h-80 overflow-y-auto">
          {filteredSkills.map((skill) => (
            <li key={skill.id}>
              <button
                type="button"
                onClick={() => chooseSkill(skill)}
                className="w-full flex items-center justify-between gap-2 py-3 text-left hover:text-moss"
              >
                <span className="text-sm text-ink">{skill.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md border border-hairline text-ink py-2 mt-4 hover:bg-paper"
      >
        {t('modals.setTarget.cancel')}
      </button>
    </AccessibleDialog>
  )
}
