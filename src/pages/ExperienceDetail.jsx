import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate, isEndBeforeStart } from '../lib/dates'
import { experienceTypeLabel } from '../lib/experienceTypes'
import AppHeader from '../components/AppHeader'
import OrganizationLogo from '../components/OrganizationLogo'
import ExperienceModal from '../components/ExperienceModal'
import RecordActivityModal from '../components/RecordActivityModal'
import { relatedSkillsFromStatement } from '../lib/xapiStatement'
import { saveActivity } from '../lib/activitySkillLinks'
import { linkSkillToExperiences } from '../lib/currentRole'
import { addRecommendedSkills, recommendExperienceSkills } from '../lib/experienceSkillRecommendations'
import { useMyRoleAssignments } from './roles/useMyRoleAssignments'
import RoleProfileAlignmentDetail from '../components/RoleProfileAlignmentDetail'
import { getExperienceTabs, validateWithinParent } from '../lib/experienceDetail'
import { DetailsTab } from './ExperienceDetailsForm'
import { OverviewTab } from './ExperienceOverviewTab'
import { CoursesSubsection, ExperienceActionButtons, SkillsSubsection } from './ExperienceLearningSections'

export default function ExperienceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [item, setItem] = useState(null)
  const [loadingItem, setLoadingItem] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState(location.state?.tab ?? 'overview')
  const [linkedCourses, setLinkedCourses] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [skillHistory, setSkillHistory] = useState([])
  const [experienceActivities, setExperienceActivities] = useState([])
  const [allExperienceActivities, setAllExperienceActivities] = useState([])
  const [activitySkills, setActivitySkills] = useState([])
  const [activityOpen, setActivityOpen] = useState(false)
  const [learningLoaded, setLearningLoaded] = useState(false)
  const [childExperiences, setChildExperiences] = useState([])
  const [parentExperience, setParentExperience] = useState(null)
  const [childModalType, setChildModalType] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addSkillOpen, setAddSkillOpen] = useState(false)
  const [recommendations, setRecommendations] = useState([])
  const [selectedRecommendations, setSelectedRecommendations] = useState(new Set())
  const [recommending, setRecommending] = useState(false)
  const [addingRecommendations, setAddingRecommendations] = useState(false)
  const [recommendationError, setRecommendationError] = useState(null)
  const [recommendationNotice, setRecommendationNotice] = useState(null)

  // Every employer role profile linked to THIS experience -- can be more
  // than one (accepting a proposal can target an existing experience
  // instead of always creating a new one, decide_employer_role_assignment,
  // 20260912170000). Same hook/shape ExperienceSection.jsx's timeline uses,
  // reused rather than re-fetching+re-computing alignment a second way.
  const {
    linkedAssignments, alignmentByAssignmentId,
    loading: assignmentsLoading, disconnectAssignment,
  } = useMyRoleAssignments()
  const roleProfilesForThisExperience = useMemo(() => (
    linkedAssignments
      .filter((assignment) => assignment.linkedExperienceId === item?.id)
      .map((assignment) => {
        const alignment = alignmentByAssignmentId[assignment.assignmentId] ?? { aligned: [], gaps: [], training: [] }
        return {
          employerName: assignment.employerName,
          roleProfileName: assignment.roleProfile.name,
          aligned: alignment.aligned,
          gaps: alignment.gaps,
          training: alignment.training,
          disconnecting: assignmentsLoading,
          onDisconnect: () => disconnectAssignment(assignment.assignmentId),
        }
      })
  ), [linkedAssignments, alignmentByAssignmentId, assignmentsLoading, disconnectAssignment, item?.id])

  useEffect(() => {
    loadItem()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [id])

  useEffect(() => {
    if (item) {
      loadLearning()
      loadRelated()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [item?.id])

  useEffect(() => {
    if (!learningLoaded) return
    if (tab === 'courses' && linkedCourses.length === 0) setTab('overview')
    else if (tab === 'skills' && item?.end_date) setTab('overview')
  }, [learningLoaded, linkedCourses.length, tab, item?.end_date])

  async function loadItem() {
    setLoadingItem(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('experience')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
    } else {
      setItem(data)
    }
    setLoadingItem(false)
  }

  async function loadLearning() {
    // Skills linked to a child experience (e.g. a subject under this
    // education, or a project under this job) count as developed under
    // this experience too -- a subject is a chapter of the parent, not a
    // separate one, so its skills roll up into the parent's own "Skills
    // developed" section rather than only ever showing on the subject's
    // own page.
    const { data: children } = await supabase
      .from('experience')
      .select('id')
      .eq('parent_experience_id', item.id)
    const experienceIds = [item.id, ...(children ?? []).map((c) => c.id)]

    const [{ data: cl }, { data: sl }, { data: ach }, { data: activities }, { data: allSkills }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, course_id, courses(id, name, provider, completed_date)')
        .eq('experience_id', item.id),
      supabase
        .from('skill_experience_links')
        .select('id, skill_id, skills(id, name, level, source)')
        .in('experience_id', experienceIds)
        .order('created_at'),
      supabase
        .from('skill_assessments')
        .select('*, skills(name), courses(name)')
        .eq('experience_id', item.id)
        .order('assessed_at', { ascending: false }),
      supabase
        .from('xapi_statements')
        .select('id, statement, recorded_at, skill_id, experience_id, evidence_url, evidence_paths, skills(id, name)')
        .in('experience_id', experienceIds)
        .order('recorded_at', { ascending: false }),
      supabase
        .from('skills')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name'),
    ])
    // A skill linked both directly and via a child experience would
    // otherwise appear twice -- keep one row per skill (earliest-linked,
    // since sl is ordered by created_at).
    const uniqueSkillLinks = [...new Map((sl ?? []).map((link) => [link.skill_id, link])).values()]
    const skillIds = uniqueSkillLinks.map((link) => link.skill_id)
    const { data: history } = skillIds.length
      ? await supabase
          .from('skill_assessments')
          .select('id, skill_id, level, axis, source, comments, assessed_at')
          .in('skill_id', skillIds)
          .eq('axis', 'practical')
          .order('assessed_at', { ascending: true })
      : { data: [] }
    setLinkedCourses(cl ?? [])
    setSkillLinks(uniqueSkillLinks)
    setAchievements(ach ?? [])
    setSkillHistory(history ?? [])
    // The Overview timeline only ever shows this experience's own logged
    // activity; a child's activity stays on the child's own page. The
    // broader set (including children) is used only for the "activities
    // logged" count in the skills rollup below.
    setExperienceActivities((activities ?? []).filter((a) => a.experience_id === item.id))
    setAllExperienceActivities(activities ?? [])
    setActivitySkills(allSkills ?? [])
    setLearningLoaded(true)
  }

  async function loadRelated() {
    const [{ data: children }, parentResult] = await Promise.all([
      supabase
        .from('experience')
        .select('id, type, title, other_type, start_date, end_date, study_duration, study_duration_value, study_duration_unit')
        .eq('parent_experience_id', item.id)
        .order('start_date', { ascending: false }),
      item.parent_experience_id
        ? supabase
            .from('experience')
            .select('id, type, title, organization, organization_url, start_date, end_date')
            .eq('id', item.parent_experience_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setChildExperiences(children ?? [])
    setParentExperience(parentResult.data ?? null)
  }

  async function handleAddChildExperience(values) {
    const childValues = values.type === 'subject'
      ? { ...values, organization: item.organization, organization_url: item.organization_url }
      : values
    const validationError = validateWithinParent(childValues, item, t)
    if (validationError) throw new Error(validationError)
    const { error } = await supabase.from('experience').insert({
      ...childValues,
      user_id: user.id,
      parent_experience_id: item.id,
    })
    if (error) throw error
    setChildModalType(null)
    await loadRelated()
  }

  async function handleSaveDetails(values) {
    const savedValues = item.type === 'subject' && parentExperience
      ? { ...values, organization: parentExperience.organization, organization_url: parentExperience.organization_url }
      : values
    if (item.parent_experience_id && parentExperience) {
      const validationError = validateWithinParent(savedValues, parentExperience, t)
      if (validationError) throw new Error(validationError)
    }
    const { error } = await supabase.from('experience').update(savedValues).eq('id', item.id)
    if (error) throw error
    await loadItem()
  }

  async function handleDelete() {
    const { error } = await supabase.from('experience').delete().eq('id', item.id)
    if (error) throw error
    navigate('/experience')
  }

  async function handleLogActivity(statement, evidence) {
    const relatedSkills = relatedSkillsFromStatement(statement)
    await saveActivity({ userId: user.id, statement, evidence, skillIds: relatedSkills.map((s) => s.id), experienceId: item.id })
    // Logging an activity against a skill within this experience is itself
    // evidence the skill was applied here -- link it the same way an
    // explicit "Find a skill" link would, per the "reusable records"
    // principle (one association table, not a parallel notion of "skills
    // touched by activities"). Every related skill gets linked, not just
    // the primary one.
    for (const skill of relatedSkills) {
      await linkSkillToExperiences(user.id, skill.id, [item.id])
    }
    setActivityOpen(false)
    await loadLearning()
  }

  async function handleRecommend() {
    setRecommending(true)
    setRecommendationError(null)
    setRecommendationNotice(null)
    try {
      const result = await recommendExperienceSkills(
        item,
        skillLinks.map((link) => link.skills?.name).filter(Boolean)
      )
      setRecommendations(result)
      setSelectedRecommendations(new Set(result.map((recommendation) => recommendation.name)))
      if (result.length === 0) setRecommendationNotice(t('experience.noAdditionalSkillsIdentified'))
    } catch (err) {
      setRecommendationError(err.message)
    } finally {
      setRecommending(false)
    }
  }

  function toggleRecommendation(name) {
    setSelectedRecommendations((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function handleAddRecommendations() {
    const names = recommendations
      .map((recommendation) => recommendation.name)
      .filter((name) => selectedRecommendations.has(name))
    if (names.length === 0) return

    setAddingRecommendations(true)
    setRecommendationError(null)
    setRecommendationNotice(null)
    try {
      const added = await addRecommendedSkills({ userId: user.id, experienceId: item.id, names })
      setRecommendations([])
      setSelectedRecommendations(new Set())
      setRecommendationNotice(
        added.length === 1
          ? t('experience.skillsAddedSingular', { count: added.length })
          : t('experience.skillsAddedPlural', { count: added.length })
      )
      await loadLearning()
    } catch (err) {
      setRecommendationError(`${err.message} ${t('experience.skillsAddedBeforeErrorSaved')}`)
      await loadLearning()
    } finally {
      setAddingRecommendations(false)
    }
  }

  const backTo = location.state?.backTo ?? (parentExperience ? `/experience/${parentExperience.id}` : '/experience')
  const backLabel = location.state?.backLabel ?? (parentExperience ? parentExperience.title : t('experience.defaultBackLabel'))

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <Link to={backTo} className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          {t('experience.backTo', { label: backLabel })}
        </Link>

        {loadingItem && <p className="text-secondary">{t('common.loading')}</p>}
        {notFound && <p className="text-secondary">{t('experience.notFound')}</p>}

        {item && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {experienceTypeLabel(item)}
                </span>
                <h1 className="font-display text-2xl text-ink mt-0.5">{item.title}</h1>
                {item.type !== 'subject' && item.organization && (
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.organization_url && (
                      <OrganizationLogo organizationUrl={item.organization_url} size={24} />
                    )}
                    <p className="text-sm text-secondary">{item.organization}</p>
                  </div>
                )}
                {parentExperience && (
                  <p className="text-xs text-secondary mt-1">
                    {t('skillDetail.partOfPrefix')}{' '}
                    <Link to={`/experience/${parentExperience.id}`} className="text-moss hover:underline">
                      {parentExperience.title}
                    </Link>
                  </p>
                )}
                {isEndBeforeStart(item.start_date, item.end_date) && (
                  <p role="status" className="text-xs text-amber-700 mt-2">
                    {t('experience.datesReversedNotice', { start: formatFullDate(item.start_date), end: formatFullDate(item.end_date) })}{' '}
                    <button type="button" onClick={() => setSettingsOpen(true)} className="underline hover:opacity-75">
                      {t('experience.datesReversedFix')}
                    </button>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label={t('experience.settings')}
                title={t('experience.settings')}
                className="p-2 -m-2 rounded-md text-moss hover:opacity-75 transition-opacity shrink-0"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>

            <ExperienceActionButtons
              itemType={item.type}
              onAddExperience={setChildModalType}
              onLogActivity={() => setActivityOpen(true)}
              canManageSkills={!item.end_date && item.type !== 'project' && item.type !== 'course'}
              onAddSkill={() => {
                setTab('skills')
                setAddSkillOpen(true)
              }}
              onRecommendSkills={() => {
                setTab('skills')
                handleRecommend()
              }}
              recommending={recommending}
              addingRecommendations={addingRecommendations}
              hasRecommendations={recommendations.length > 0}
            />

            {activityOpen && (
              <RecordActivityModal
                actor={{ name: user.user_metadata?.full_name ?? '', email: user.email }}
                skills={activitySkills}
                relatedExperience={{
                  id: item.id,
                  title: item.title,
                  type: item.type,
                  start_date: item.start_date,
                  end_date: item.end_date,
                  parent: parentExperience
                    ? { id: parentExperience.id, title: parentExperience.title, type: parentExperience.type }
                    : null,
                }}
                onSave={handleLogActivity}
                onClose={() => setActivityOpen(false)}
              />
            )}

            {childModalType && (
              <ExperienceModal
                type={childModalType}
                initialOrganization={item.organization ?? ''}
                initialOrganizationUrl={item.organization_url ?? ''}
                minimumDate={item.start_date}
                maximumDate={item.end_date ?? undefined}
                onSave={handleAddChildExperience}
                onClose={() => setChildModalType(null)}
              />
            )}

            {roleProfilesForThisExperience.map((roleProfile, i) => (
              <RoleProfileAlignmentDetail
                key={`${roleProfile.employerName}-${roleProfile.roleProfileName}-${i}`}
                {...roleProfile}
              />
            ))}

            <div className="flex items-center gap-1 border-b border-hairline mt-4 mb-4">
              {getExperienceTabs(item, linkedCourses).map((tabOption) => (
                <button
                  key={tabOption.id}
                  type="button"
                  onClick={() => setTab(tabOption.id)}
                  className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === tabOption.id
                      ? 'border-moss text-ink'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t(`experience.tabs.${tabOption.id}`)}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <OverviewTab
                item={item}
                linkedCourses={linkedCourses}
                skillLinks={skillLinks}
                skillHistory={skillHistory}
                achievements={achievements}
                childExperiences={childExperiences}
                activities={experienceActivities}
                allActivities={allExperienceActivities}
                loaded={learningLoaded}
                highlightActivityId={location.state?.highlightActivityId}
              />
            )}

            {tab === 'courses' && (
              <CoursesSubsection item={item} linkedCourses={linkedCourses} onChange={loadLearning} />
            )}

            {tab === 'skills' && (
              <SkillsSubsection
                item={item}
                skillLinks={skillLinks}
                onChange={loadLearning}
                user={user}
                addOpen={addSkillOpen}
                onAddOpenChange={setAddSkillOpen}
                recommendations={recommendations}
                selectedRecommendations={selectedRecommendations}
                onToggleRecommendation={toggleRecommendation}
                onAddRecommendations={handleAddRecommendations}
                onDismissRecommendations={() => {
                  setRecommendations([])
                  setSelectedRecommendations(new Set())
                }}
                addingRecommendations={addingRecommendations}
                recommendationError={recommendationError}
                recommendationNotice={recommendationNotice}
              />
            )}

            {settingsOpen && (
              <div
                className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-40"
                onClick={() => setSettingsOpen(false)}
              >
                <div
                  className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-2xl text-ink">{t('experience.settings')}</h2>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(false)}
                      className="text-secondary hover:text-ink text-sm"
                    >
                      {t('skillDetail.close')}
                    </button>
                  </div>
                  <DetailsTab item={item} parentExperience={parentExperience} onSave={handleSaveDetails} onDelete={handleDelete} />
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
