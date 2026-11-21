import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import ConfirmDialog from '../components/ConfirmDialog'
import QuickActivityLog from '../components/QuickActivityLog'
import { computeGoalProgress } from '../lib/skillGoalProgress'
import { cancelCourse } from '../lib/courseCatalogue'
import CohortPickerModal from '../components/CohortPickerModal'
import CourseOverlay from '../components/CourseOverlay'
import AccessibleDialog from '../components/AccessibleDialog'
import InviteRaterModal from '../components/InviteRaterModal'
import RecommendSkillModal from '../components/RecommendSkillModal'
import RecordActivityModal from '../components/RecordActivityModal'
import AssessBaselineModal from '../components/AssessBaselineModal'
import SetTargetModal from '../components/SetTargetModal'
import ValidateSkillModal from '../components/ValidateSkillModal'
import RequestValidationModal from '../components/RequestValidationModal'
import ConfirmingBaselineQuizModal from '../components/ConfirmingBaselineQuizModal'
import InterviewModal from '../components/InterviewModal'
import { TimelineDetailModal } from './SkillHistorySection'
import { ActivitiesModal, SelfAssessModal } from './SkillDetailModals'
import { ScheduleSection, DetailsSection, DeleteSection, SettingsSection } from './SkillSettingsSections'

// The skill page's dialogs. Which one is open is the page's state; this only renders them.
export default function SkillDetailDialogs({
  activitiesListOpen,
  allTags,
  assessMode,
  assessorName,
  backTo,
  cancellingCourse,
  cohortEnrolling,
  cohortError,
  cohortPicker,
  confirmingBaselineOpen,
  displayedKnowledgeLevel,
  displayedPracticalLevel,
  expertValidationOpen,
  focusSkill,
  handleAddTag,
  handleCohortEnrol,
  handleRecordActivity,
  handleRemoveTag,
  history,
  interviewOpen,
  inviteAfterSelfAssess,
  inviteOpen,
  knowledgeCalibrating,
  latestKnowledgeAssessment,
  loadHistory,
  loadSkill,
  openCourse,
  peerRatings,
  practicalStatements,
  quickLogGoals,
  quickLogOpen,
  recommendOpen,
  recordActivityOpen,
  refreshAvailableCourses,
  runLearningAction,
  selectedActivityEvent,
  selfAssessKnowledgeOpen,
  selfAssessOpen,
  setActivitiesListOpen,
  setAssessMode,
  setCancellingCourse,
  setCohortPicker,
  setConfirmingBaselineOpen,
  setExpertValidationOpen,
  setInterviewOpen,
  setInviteAfterSelfAssess,
  setInviteOpen,
  setOpenCourse,
  setQuickLogOpen,
  setRecommendOpen,
  setRecordActivityOpen,
  setSelectedActivityEvent,
  setSelfAssessKnowledgeOpen,
  setSelfAssessOpen,
  setSettingsOpen,
  setSkill,
  setTargetOpen,
  setValidateOpen,
  settingsOpen,
  skill,
  skillTags,
  statements,
  targetOpen,
  targets,
  validateOpen,
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useLanguage()

  return (
    <>
      {openCourse && (
        <CourseOverlay
          course={openCourse}
          onClose={() => {
            setOpenCourse(null)
            // Lessons studied or the course completed show straight away.
            loadHistory()
            refreshAvailableCourses()
          }}
        />
      )}

      {cohortPicker && (
        <CohortPickerModal
          courseName={cohortPicker.course.name}
          cohorts={cohortPicker.cohorts}
          enrolling={cohortEnrolling}
          error={cohortError}
          onEnrol={handleCohortEnrol}
          onClose={() => setCohortPicker(null)}
        />
      )}

      {cancellingCourse && (
        <ConfirmDialog
          message={t('skillDetail.learning.cancelConfirm', { course: cancellingCourse.name })}
          confirmLabel={t('skillDetail.learning.cancelConfirmLabel')}
          onConfirm={async () => {
            await runLearningAction(() => cancelCourse(cancellingCourse.id))
            setCancellingCourse(null)
          }}
          onCancel={() => setCancellingCourse(null)}
        />
      )}

      {inviteOpen && (
        <InviteRaterModal
          skill={skill}
          afterSelfAssessment={inviteAfterSelfAssess}
          onClose={() => {
            setInviteOpen(false)
            setInviteAfterSelfAssess(false)
          }}
        />
      )}

      {recommendOpen && <RecommendSkillModal skill={skill} onClose={() => setRecommendOpen(false)} />}

      {selfAssessOpen && (
        <SelfAssessModal
          skill={skill}
          user={user}
          currentLevel={displayedPracticalLevel}
          history={history}
          onClose={() => setSelfAssessOpen(false)}
          onAssessed={() => {
            loadHistory()
            loadSkill()
            setSelfAssessOpen(false)
            setInviteAfterSelfAssess(true)
            setInviteOpen(true)
          }}
          onGuideGenerated={(statements) =>
            setSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
          }
        />
      )}

      {selfAssessKnowledgeOpen && (
        <SelfAssessModal
          skill={skill}
          user={user}
          axis="knowledge"
          currentLevel={displayedKnowledgeLevel}
          history={history}
          onClose={() => setSelfAssessKnowledgeOpen(false)}
          onAssessed={() => {
            loadHistory()
            loadSkill()
            setSelfAssessKnowledgeOpen(false)
          }}
          onGuideGenerated={(statements) =>
            setSkill((s) => (s ? { ...s, knowledge_level_guide: statements } : s))
          }
        />
      )}

      {confirmingBaselineOpen && (
        <ConfirmingBaselineQuizModal
          skill={skill}
          user={user}
          actor={{ name: assessorName, email: user.email }}
          latestKnowledgeAssessment={latestKnowledgeAssessment}
          calibrating={knowledgeCalibrating}
          onClose={() => setConfirmingBaselineOpen(false)}
          onConfirmed={() => {
            loadHistory()
            loadSkill()
            setConfirmingBaselineOpen(false)
          }}
        />
      )}

      {interviewOpen && (
        <InterviewModal
          skill={skill}
          user={user}
          actor={{ name: assessorName, email: user.email }}
          latestKnowledgeAssessment={latestKnowledgeAssessment}
          calibrating={knowledgeCalibrating}
          onClose={() => setInterviewOpen(false)}
          onConfirmed={() => {
            loadHistory()
            loadSkill()
            setInterviewOpen(false)
          }}
        />
      )}

      {recordActivityOpen && (
        <RecordActivityModal
          actor={{ name: assessorName, email: user.email }}
          skills={[]}
          relatedSkill={{ id: skill.id, name: skill.name }}
          onSave={handleRecordActivity}
          onClose={() => setRecordActivityOpen(false)}
        />
      )}

      {quickLogOpen && (
        <AccessibleDialog
          labelledBy="quick-log-heading"
          onClose={() => setQuickLogOpen(false)}
          panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
        >
          <div className="flex justify-end -mb-6">
            <button type="button" onClick={() => setQuickLogOpen(false)} className="text-secondary hover:text-ink text-sm">
              {t('skillDetail.close')}
            </button>
          </div>
          <QuickActivityLog
            user={user}
            focusSkill={focusSkill}
            goalItems={quickLogGoals.map((goal) => ({ goal, progress: computeGoalProgress(goal, statements) }))}
            onLogged={async () => {
              const fresh = await loadHistory()
              return quickLogGoals.map((goal) => ({ goal, progress: computeGoalProgress(goal, fresh) }))
            }}
            onOpenFullForm={() => {
              setQuickLogOpen(false)
              setRecordActivityOpen(true)
            }}
          />
        </AccessibleDialog>
      )}

      {activitiesListOpen && (
        <ActivitiesModal
          statements={practicalStatements}
          onSelect={(event) => {
            setActivitiesListOpen(false)
            setSelectedActivityEvent(event)
          }}
          onClose={() => setActivitiesListOpen(false)}
        />
      )}

      {selectedActivityEvent && (
        <TimelineDetailModal
          event={selectedActivityEvent}
          onClose={() => setSelectedActivityEvent(null)}
        />
      )}

      {assessMode && (
        <AssessBaselineModal
          skill={skill}
          user={user}
          assessments={history}
          peerRatings={peerRatings}
          statements={practicalStatements}
          mode={assessMode}
          onClose={() => setAssessMode(null)}
          onAssessed={() => {
            loadHistory()
            loadSkill()
            setAssessMode(null)
          }}
        />
      )}

      {targetOpen && (
        <SetTargetModal
          skill={skill}
          user={user}
          targets={targets}
          currentLevel={displayedPracticalLevel}
          onClose={() => setTargetOpen(false)}
          onSet={() => {
            loadHistory()
            loadSkill()
            setTargetOpen(false)
          }}
          onGuideGenerated={(statements) =>
            setSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
          }
        />
      )}

      {validateOpen && targets[0] && (
        <ValidateSkillModal
          skill={skill}
          target={targets[0]}
          onClose={() => setValidateOpen(false)}
          onValidated={() => {
            loadHistory()
            loadSkill()
            setValidateOpen(false)
          }}
        />
      )}

      {expertValidationOpen && targets[0] && (
        <RequestValidationModal
          skill={skill}
          user={user}
          targetLevel={targets[0].target_level}
          onClose={() => setExpertValidationOpen(false)}
          onRequested={() => {
            loadHistory()
            setExpertValidationOpen(false)
          }}
        />
      )}

      {settingsOpen && (
        <AccessibleDialog
          labelledBy="skill-settings-dialog-title"
          onClose={() => setSettingsOpen(false)}
          overlayClassName="z-40"
          panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
        >
            <div className="flex items-center justify-between mb-4">
              <h2 id="skill-settings-dialog-title" className="font-display text-2xl text-ink">{t('skillDetail.skillSettings')}</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-secondary hover:text-ink text-sm"
              >
                {t('skillDetail.close')}
              </button>
            </div>
            <div className="space-y-6">
              <DetailsSection
                skill={skill}
                skillTags={skillTags}
                allTags={allTags}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
                user={user}
                onUpdated={loadSkill}
              />
              <SettingsSection skill={skill} user={user} onUpdated={loadSkill} />
              <ScheduleSection skill={skill} onUpdated={loadSkill} />
              <DeleteSection
                skill={skill}
                onUpdated={loadSkill}
                onDeleted={() => navigate(backTo, { state: { tab: 'skills' } })}
              />
            </div>
        </AccessibleDialog>
      )}
    </>
  )
}
