import { useAuth } from '../context/AuthContext'
import SkillNetworkSection from '../components/SkillNetworkSection'
import PeopleWithSkillModal from '../components/PeopleWithSkillModal'

// The skill page's Skill network tab: connections and people with this skill.
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

  return (
    <div id="skill-detail-panel-network" role="tabpanel" aria-labelledby="skill-detail-tab-network">
    <SkillNetworkSection
      librarySkillId={skill.library_skill_id}
      isOwner={skill.user_id === user.id}
      recommendInvites={recommendInvites}
      recommendAcceptors={recommendAcceptors}
      knownPeople={knownPeople}
      connections={connectionsWithSkill}
      totalTrackersCount={totalTrackersCount}
      onFindExpert={() => setFindExpertOpen(true)}
      onRecommend={() => setRecommendOpen(true)}
    />

    {findExpertOpen && (
      <PeopleWithSkillModal
        librarySkillId={skill.library_skill_id}
        skillName={skill.name}
        skillId={skill.id}
        onClose={() => setFindExpertOpen(false)}
      />
    )}
    </div>
  )
}
