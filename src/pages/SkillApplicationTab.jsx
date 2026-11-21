import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { RatingsFromOthers } from '../components/SkillNetworkSection'
import CompositeSkillProgress from '../components/CompositeSkillProgress'
import SkillGoalsSection from '../components/SkillGoalsSection'
import { LevelDetail, NestedSkillPanel, SkillPanel } from './SkillDetailPanels'
import ActivityTimeline from '../components/ActivityTimeline'

// The skill page's Application tab: the practical level, demonstrating and validating it, goals and a composite skill's parts.
export default function SkillApplicationTab({
  assessorName,
  canShowDemonstrateAction,
  canShowValidateAction,
  composite,
  compositeError,
  currentTarget,
  decidedValidationRequestsCount,
  demonstrateRows,
  displayedPracticalLevel,
  handleDemonstrateSkill,
  handleStartComponent,
  handleValidateSkillStage,
  invites,
  knownPeople,
  loadHistory,
  loadingComposite,
  peerRatings,
  pendingValidationRequestsCount,
  practicalStatements,
  practicalVerification,
  raterAvatars,
  relationshipLinks,
  setActivitiesListOpen,
  setExpertValidationOpen,
  setInviteOpen,
  setQuickLogOpen,
  setSelectedActivityEvent,
  setSelfAssessOpen,
  setSkill,
  setTargetOpen,
  skill,
  startComponentError,
  startingComponentId,
  statements,
  targets,
  visibleTarget,
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t } = useLanguage()

  return (
    <div id="skill-detail-panel-application" role="tabpanel" aria-labelledby="skill-detail-tab-application">
    <div className="mt-4 pt-4 border-t border-hairline">
      <SkillPanel
        title={t('skillDetail.application')}
        status={
          <LevelDetail
            skill={skill}
            axis="practical"
            level={displayedPracticalLevel}
            trustStatus={practicalVerification}
            trustLabel={practicalVerification ?? t('skillDetail.practicalFoundation')}
            ringTargetLevel={visibleTarget?.level}
            currentTarget={currentTarget}
            onSelfAssess={() => setSelfAssessOpen(true)}
            onSetTarget={() => setTargetOpen(true)}
            onAskToRate={skill.user_id === user.id ? () => setInviteOpen(true) : null}
            onGuideGenerated={(statements) =>
              setSkill((s) => (s ? { ...s, practical_level_guide: statements } : s))
            }
          />
        }
        actions={[]}
        nested={
          <div className="space-y-3">
            <NestedSkillPanel
              title={t('skillDetail.stages.demonstrate')}
              status={
                // The latest activities right here, drawn as the
                // dashboard's timeline; the rest are one tap away.
                <div>
                  <p className="text-sm text-secondary">
                    {practicalStatements.length} {practicalStatements.length === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
                    {relationshipLinks.length > 0
                      ? ` · ${t('skillDetail.linkedToPrefix')} ${relationshipLinks.length} ${relationshipLinks.length === 1 ? t('skillDetail.experienceEntrySingular') : t('skillDetail.experienceEntryPlural')}`
                      : ''}
                  </p>
                  {demonstrateRows.length > 0 && (
                    <div className="mt-3">
                      <ActivityTimeline
                        rows={demonstrateRows}
                        allRows={practicalStatements}
                        onOpen={(row) => setSelectedActivityEvent({ type: 'activity', statement: row })}
                      />
                    </div>
                  )}
                  {practicalStatements.length > demonstrateRows.length && (
                    <button
                      type="button"
                      onClick={() => setActivitiesListOpen(true)}
                      className="mt-3 text-sm text-moss font-medium hover:underline"
                    >
                      {t('activity.timeline.seeAll', { total: practicalStatements.length })}
                    </button>
                  )}
                </div>
              }
              actions={[
                { label: t('skillDetail.logSkillActivity'), onClick: () => setQuickLogOpen(true) },
                ...(canShowDemonstrateAction
                  ? [{ label: t('skillDetail.demonstrateSkillAction'), onClick: handleDemonstrateSkill }]
                  : []),
                ...(canShowValidateAction
                  ? [{ label: t('skillDetail.moveToValidating'), onClick: handleValidateSkillStage }]
                  : []),
              ]}
            />
            <NestedSkillPanel
              title={t('skillDetail.stages.validate')}
              status={
                <div className="space-y-3">
                <p className="text-sm text-secondary">
                  {peerRatings.length > 0
                    ? `${peerRatings.length} ${peerRatings.length === 1 ? t('skillDetail.peerRatingSingular') : t('skillDetail.peerRatingPlural')}`
                    : t('skillDetail.noPeerRatingsYet')}
                  {pendingValidationRequestsCount > 0
                    ? ` · ${pendingValidationRequestsCount} ${pendingValidationRequestsCount === 1 ? t('skillDetail.requestPendingSingular') : t('skillDetail.requestPendingPlural')}`
                    : ''}
                  {decidedValidationRequestsCount > 0 ? ` · ${decidedValidationRequestsCount} ${t('skillDetail.decidedSuffix')}` : ''}
                </p>
                {/* Who has rated you and who you're waiting on -- the
                    learner's own invites and ratings, so only on their
                    own skill. */}
                {skill.user_id === user.id && (
                  <RatingsFromOthers
                    ratings={peerRatings}
                    raterAvatars={raterAvatars}
                    rateInvites={invites}
                    knownPeople={knownPeople}
                  />
                )}
                </div>
              }
              actions={[
                // Ratings are what Validate is about, so asking for one
                // is here too (as well as in Skill network and beside
                // the level). Only on the learner's own skill.
                ...(skill.user_id === user.id
                  ? [{ label: t('skillDetail.askToRateAbility'), onClick: () => setInviteOpen(true) }]
                  : []),
                // "✨ Request AI assessment" now lives in the header next
                // to the skill name -- see the button beside setSettingsOpen
                // above, which shares this exact same onClick/disabled logic.
                ...(targets.length > 0
                  ? [{ label: t('skillDetail.requestValidationAction'), onClick: () => setExpertValidationOpen(true) }]
                  : []),
              ]}
            />
          </div>
        }
      />
    </div>

    {/* Goals are private to the skill's owner, whoever else can view the skill. */}
    {skill.user_id === user.id && (
      <SkillGoalsSection
        skill={skill}
        user={user}
        actor={{ name: assessorName, email: user.email }}
        statements={statements}
        onActivitiesChanged={loadHistory}
        onSetLevelTarget={() => setTargetOpen(true)}
        editGoalId={location.state?.editGoalId}
        onEditGoalOpened={() =>
          navigate(`${location.pathname}${location.search}`, {
            replace: true,
            state: { ...location.state, editGoalId: undefined },
          })}
      />
    )}

    <CompositeSkillProgress
      composite={composite}
      loading={loadingComposite}
      error={compositeError}
      onStartComponent={handleStartComponent}
      startingComponentId={startingComponentId}
      startError={startComponentError}
    />
    </div>
  )
}
