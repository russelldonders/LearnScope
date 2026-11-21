import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import SkillLearningSection from '../components/SkillLearningSection'
import SkillResourcesSection from '../components/SkillResourcesSection'
import { planCatalogueCourse, removePlannedCourse } from '../lib/courseCatalogue'
import { LevelDetail, SkillPanel } from './SkillDetailPanels'

// The skill page's Knowledge tab: the knowledge level, then learning and resources.
export default function SkillKnowledgeTab({
  availableCourses,
  courseLinks,
  displayedKnowledgeLevel,
  displayedPracticalLevel,
  enrollingCourseId,
  handleEnrol,
  knowledgeMilestone,
  knowledgeVerification,
  learningError,
  loadHistory,
  progressByCatalogueId,
  runLearningAction,
  setCancellingCourse,
  setConfirmingBaselineOpen,
  setInterviewOpen,
  setOpenCourse,
  setSelfAssessKnowledgeOpen,
  setSkill,
  skill,
  trainingScopeState,
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useLanguage()

  return (
    <div id="skill-detail-panel-knowledge" role="tabpanel" aria-labelledby="skill-detail-tab-knowledge">
    <div className="mt-4 pt-4 border-t border-hairline">
      <SkillPanel
        title={t('skillDetail.knowledge')}
        accent="slate"
        status={
          <LevelDetail
            skill={skill}
            axis="knowledge"
            level={displayedKnowledgeLevel}
            trustStatus={knowledgeVerification}
            trustLabel={knowledgeVerification ?? t('skillDetail.knowledgeFoundation')}
            milestoneLevel={knowledgeMilestone}
            onSelfAssess={() => setSelfAssessKnowledgeOpen(true)}
            onAssess={() => setConfirmingBaselineOpen(true)}
            onInterview={() => setInterviewOpen(true)}
            onGuideGenerated={(statements) =>
              setSkill((s) => (s ? { ...s, knowledge_level_guide: statements } : s))
            }
          />
        }
        actions={[]}
      />
    </div>

    {learningError && <p role="alert" className="text-sm text-red-700 mt-3">{learningError}</p>}
    <SkillLearningSection
      courseLinks={courseLinks}
      availableCourses={availableCourses}
      progressByCatalogueId={progressByCatalogueId}
      enrollingId={enrollingCourseId}
      onOpenCourse={skill.user_id === user.id ? setOpenCourse : null}
      onEnrol={skill.user_id === user.id ? (course) => handleEnrol(course, course.id) : null}
      onPlan={skill.user_id === user.id ? (course) => runLearningAction(() => planCatalogueCourse(user.id, course, skill.id)) : null}
      onRemovePlanned={skill.user_id === user.id ? (course) => runLearningAction(() => removePlannedCourse(course.id)) : null}
      onEnrolPlanned={skill.user_id === user.id
        ? (course) => (course.catalogue_course_id
          ? handleEnrol(
            { id: course.catalogue_course_id, name: course.name, provider: course.provider, course_type: course.course_type, duration: course.duration },
            course.id,
            course,
          )
          // Not from the catalogue: enrol through Training as before.
          : navigate('/training', { state: trainingScopeState }))
        : null}
      onCancel={skill.user_id === user.id ? (course) => setCancellingCourse(course) : null}
      onFindCourse={skill.user_id === user.id ? () => navigate('/training', { state: trainingScopeState }) : null}
      onOpenAvailable={() => navigate('/training', { state: trainingScopeState })}
    />
    {skill.user_id === user.id && (
      <SkillResourcesSection
        onActivityChange={loadHistory}
        skill={skill}
        user={user}
        knowledgeLevel={displayedKnowledgeLevel}
        practicalLevel={displayedPracticalLevel}
      />
    )}
    </div>
  )
}
