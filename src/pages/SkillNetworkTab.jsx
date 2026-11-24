import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import SkillNetworkSection from '../components/SkillNetworkSection'
import SkillCoachingSection from '../components/SkillCoachingSection'
import PeopleWithSkillModal from '../components/PeopleWithSkillModal'

// The skill page's Skill network tab: connections and people with this
// skill, and -- on the learner's own skill -- coaching (0335). Find a coach
// opens Find an expert showing coaches only.
export default function SkillNetworkTab({
  connectionsWithSkill,
  findExpertOpen,
  knownPeople,
  recommendAcceptors,
  recommendInvites,
  setFindExpertOpen,
  setRecommendOpen,
  skill,
  totalTrackersCount,
}) {
  const { user } = useAuth()
  const isOwner = skill.user_id === user.id
  const [coachesOnly, setCoachesOnly] = useState(false)
  const [coachingChanged, setCoachingChanged] = useState(0)

  function openFinder(onlyCoaches) {
    setCoachesOnly(onlyCoaches)
    setFindExpertOpen(true)
  }

  return (
    <div id="skill-detail-panel-network" role="tabpanel" aria-labelledby="skill-detail-tab-network">
    <SkillNetworkSection
      librarySkillId={skill.library_skill_id}
      isOwner={isOwner}
      recommendInvites={recommendInvites}
      recommendAcceptors={recommendAcceptors}
      knownPeople={knownPeople}
      connections={connectionsWithSkill}
      totalTrackersCount={totalTrackersCount}
      onFindExpert={() => openFinder(false)}
      onRecommend={() => setRecommendOpen(true)}
    />

    {isOwner && (
      <SkillCoachingSection
        skill={skill}
        userId={user.id}
        onFindCoach={() => openFinder(true)}
        refreshKey={coachingChanged}
      />
    )}

    {findExpertOpen && (
      <PeopleWithSkillModal
        librarySkillId={skill.library_skill_id}
        skillName={skill.name}
        skillId={skill.id}
        coachesOnly={coachesOnly}
        canAskForCoaching={isOwner}
        onCoachingChange={() => setCoachingChanged((n) => n + 1)}
        onClose={() => setFindExpertOpen(false)}
      />
    )}
    </div>
  )
}
