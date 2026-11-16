import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../context/LanguageContext'
import { formatMonthYear } from '../lib/dates'
import { nestedExperienceTypesFor } from '../lib/experienceTypes'
import SkillCard from '../components/SkillCard'
import FindSkillModal from '../components/FindSkillModal'
import AddExperienceButton from '../components/AddExperienceButton'

// The experience page's Courses and Skills tabs and its action buttons
// (see ExperienceDetail.jsx).

export function CoursesSubsection({ item, linkedCourses, onChange }) {
  const { t } = useLanguage()
  const [error, setError] = useState(null)

  async function unlinkCourse(linkId) {
    setError(null)
    const { error } = await supabase.from('course_experience_links').delete().eq('id', linkId)
    if (error) setError(error.message)
    else await onChange()
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">{t('experience.coursesHeading')}</h4>

      {linkedCourses.length === 0 ? (
        <p className="text-sm text-secondary mb-3">{t('experience.noCoursesLinkedYet')}</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {linkedCourses
            .filter((l) => l.courses)
            .map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 bg-paper border border-hairline rounded-md px-3 py-2"
              >
                <Link
                  to={`/courses/${l.courses.id}/learn`}
                  state={{ backTo: `/experience/${item.id}`, backLabel: item.title }}
                  className="min-w-0"
                >
                  <p className="text-sm text-ink truncate hover:underline">{l.courses.name}</p>
                  {l.courses.completed_date && (
                    <p className="font-mono text-xs text-secondary">
                      {t('experience.completedPrefix')} {formatMonthYear(l.courses.completed_date)}
                    </p>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => unlinkCourse(l.id)}
                  className="shrink-0 text-xs text-red-700 font-medium"
                >
                  {t('experience.unlink')}
                </button>
              </li>
            ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}

export function SkillsSubsection({
  item,
  skillLinks,
  onChange,
  user,
  addOpen = false,
  onAddOpenChange = () => {},
  recommendations = [],
  selectedRecommendations = new Set(),
  onToggleRecommendation = () => {},
  onAddRecommendations = () => {},
  onDismissRecommendations = () => {},
  addingRecommendations = false,
  recommendationError = null,
  recommendationNotice = null,
}) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)

  const skillIds = [...new Set(skillLinks.map((l) => l.skill_id))]

  useEffect(() => {
    loadSkills()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [skillLinks])

  async function loadSkills() {
    if (skillIds.length === 0) {
      setSkills([])
      setTagsBySkill(new Map())
      setLoading(false)
      return
    }
    setLoading(true)
    const [{ data: skillRows }, { data: tagLinks }, { data: confirmedValidations }] = await Promise.all([
      supabase.from('skills').select('*').eq('user_id', user.id).in('id', skillIds),
      supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', user.id).in('skill_id', skillIds),
      supabase
        .from('skill_validation_requests')
        .select('skill_id')
        .eq('requester_id', user.id)
        .eq('status', 'confirmed')
        .in('skill_id', skillIds),
    ])
    const personValidatedSkillIds = new Set((confirmedValidations ?? []).map((v) => v.skill_id))
    setSkills((skillRows ?? []).map((s) => ({ ...s, hasConfirmedValidation: personValidatedSkillIds.has(s.id) })))
    const map = new Map()
    for (const link of tagLinks ?? []) {
      if (!link.tags?.name) continue
      if (!map.has(link.skill_id)) map.set(link.skill_id, [])
      map.get(link.skill_id).push(link.tags.name)
    }
    setTagsBySkill(map)
    setLoading(false)
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">{t('experience.skillsLinkedHeading')}</h4>

      {recommendationError && (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {recommendationError}
        </p>
      )}
      {recommendationNotice && (
        <p role="status" className="text-sm text-secondary mb-3">
          {recommendationNotice}
        </p>
      )}

      {recommendations.length > 0 && (
        <section aria-labelledby="skill-recommendations-heading" className="bg-paper rounded-lg p-4 mb-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h5 id="skill-recommendations-heading" className="font-display text-lg text-ink">
                {t('experience.recommendedForExperience')}
              </h5>
              <p className="text-sm text-secondary mt-1">{t('experience.chooseUpToThree')}</p>
            </div>
            <span className="text-xs text-secondary tabular-nums shrink-0">
              {t('experience.selectedCount', { count: selectedRecommendations.size })}
            </span>
          </div>
          <div className="divide-y divide-hairline">
            {recommendations.map((recommendation, index) => (
              <label key={recommendation.name} className="flex items-start gap-3 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRecommendations.has(recommendation.name)}
                  onChange={() => onToggleRecommendation(recommendation.name)}
                  className="mt-1 size-4 accent-moss"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-ink">{recommendation.name}</span>
                    <span className="text-xs text-secondary">{t('experience.priorityLabel', { number: index + 1 })}</span>
                  </span>
                  <span className="block text-sm text-secondary mt-0.5">{recommendation.reason}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onAddRecommendations}
              disabled={selectedRecommendations.size === 0 || addingRecommendations}
              className="rounded-md bg-moss text-paper px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {addingRecommendations
                ? t('experience.addingSkills')
                : selectedRecommendations.size === 1
                  ? t('experience.addSelectedSkillSingular', { count: selectedRecommendations.size || '' })
                  : t('experience.addSelectedSkillPlural', { count: selectedRecommendations.size || '' })}
            </button>
            <button
              type="button"
              onClick={onDismissRecommendations}
              disabled={addingRecommendations}
              className="rounded-md px-3 py-2 text-sm text-secondary hover:text-ink disabled:opacity-60"
            >
              {t('experience.dismiss')}
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="text-sm text-secondary">{t('common.loading')}</p>
      ) : skills.length === 0 ? (
        <p className="text-sm text-secondary">{t('experience.noSkillsLinkedYet')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              tags={tagsBySkill.get(skill.id)}
              onEdit={(s) =>
                navigate(`/skills/${s.id}`, {
                  state: { from: `/experience/${item.id}`, fromLabel: item.title },
                })
              }
            />
          ))}
        </div>
      )}

      {addOpen && (
        <FindSkillModal
          experienceId={item.id}
          onClose={() => onAddOpenChange(false)}
          onCreated={() => {
            onAddOpenChange(false)
            onChange()
          }}
        />
      )}
    </div>
  )
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.3 4.2a5 5 0 0 0 3.3 3.3L21 12l-4.4 1.5a5 5 0 0 0-3.3 3.3L12 21l-1.3-4.2a5 5 0 0 0-3.3-3.3L3 12l4.4-1.5a5 5 0 0 0 3.3-3.3L12 3Z" />
    </svg>
  )
}

export function ExperienceActionButtons({
  itemType,
  onAddExperience,
  onLogActivity,
  canManageSkills = false,
  onAddSkill,
  onRecommendSkills,
  recommending = false,
  addingRecommendations = false,
  hasRecommendations = false,
}) {
  const { t } = useLanguage()
  const nestedTypes = nestedExperienceTypesFor(itemType)
  const showAddButton = nestedTypes.length > 0 || canManageSkills
  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      {showAddButton && (
        <AddExperienceButton
          types={nestedTypes}
          onSelect={onAddExperience}
          label={t('experience.addShort')}
          leadingOptions={canManageSkills ? [{ value: 'skill', label: t('experience.skillOptionLabel'), onSelect: onAddSkill }] : []}
        />
      )}
      <button
        type="button"
        onClick={onLogActivity}
        className="inline-flex items-center gap-2 rounded-md border border-moss text-moss px-3 py-2 text-sm font-medium hover:bg-moss/10 disabled:opacity-60"
      >
        {t('skillDetail.logSkillActivity')}
      </button>
      {canManageSkills && (
        <button
          type="button"
          onClick={onRecommendSkills}
          disabled={recommending || addingRecommendations}
          className="inline-flex items-center gap-2 rounded-md border border-moss text-moss px-3 py-2 text-sm font-medium hover:bg-moss/10 disabled:opacity-60"
        >
          <SparkIcon />
          {recommending ? t('experience.findingSkills') : hasRecommendations ? t('experience.suggestAgain') : t('experience.suggestAdditionalSkills')}
        </button>
      )}
    </div>
  )
}
