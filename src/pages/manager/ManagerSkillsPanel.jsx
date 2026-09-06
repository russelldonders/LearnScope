import { useMemo, useState } from 'react'
import PersonAvatar from '../../components/PersonAvatar'
import MutationFeedback from '../../components/MutationFeedback'
import { LEVEL_LABELS } from '../../lib/levels'
import ManagerMemberProfile from './ManagerMemberProfile'

function skillKey(skill) {
  return skill.name?.trim().toLocaleLowerCase() ?? skill.id
}

export default function ManagerSkillsPanel({
  members = [], loading = false, error = null, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget, onSuggestSkill,
}) {
  const [selection, setSelection] = useState(null)
  const selectedMember = members.find((member) => member.id === selection?.memberId)
  const skills = useMemo(() => {
    const grouped = new Map()
    members.forEach((member) => member.sharedSkills?.forEach((skill) => {
      const key = skillKey(skill)
      const current = grouped.get(key) ?? { key, name: skill.name, learners: [] }
      current.learners.push({ member, skill })
      grouped.set(key, current)
    }))
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [members])
  const sharedCount = skills.reduce((total, skill) => total + skill.learners.length, 0)
  const ratedCount = skills.reduce((total, skill) => total + skill.learners.filter(({ skill: item }) => item.managerRating).length, 0)

  if (selectedMember) return <ManagerMemberProfile member={selectedMember} initialSkillId={selection.skillId}
    onBack={() => setSelection(null)} onRateSkill={onRateSkill} onLoadSkillAssessments={onLoadSkillAssessments}
    onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} onSuggestSkill={onSuggestSkill} />

  return <section aria-labelledby="team-skills-title" className="space-y-6">
    <div className="max-w-3xl">
      <h2 id="team-skills-title" className="font-display text-2xl text-ink">Skills across your team</h2>
      <p className="mt-1 text-sm text-secondary">See the skills your learners have shared, compare their current levels and open any skill to add your rating or set a target.</p>
    </div>
    <MutationFeedback status="error" message={error} />
    {loading ? <p role="status" className="text-sm text-secondary">Loading team skills…</p> : skills.length === 0 ?
      <div className="rounded-lg border border-dashed border-hairline px-5 py-12 text-center">
        <h3 className="font-display text-lg text-ink">No shared skills yet</h3>
        <p className="mx-auto mt-1 max-w-xl text-sm text-secondary">Invite learners from the Members tab. Their skills will appear here when they choose to share them with you.</p>
      </div> : <>
        <p className="border-y border-hairline py-3 text-sm text-secondary">
          <span className="font-medium text-ink">{skills.length} {skills.length === 1 ? 'skill' : 'skills'}</span>
          {' · '}{sharedCount} learner {sharedCount === 1 ? 'profile' : 'profiles'}
          {' · '}{ratedCount} rated by you
        </p>
        <div className="divide-y divide-hairline border-y border-hairline">
          {skills.map((group) => <section key={group.key} aria-labelledby={`team-skill-${group.key.replace(/[^a-z0-9]+/g, '-')}`} className="py-5 first:pt-0 last:pb-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`team-skill-${group.key.replace(/[^a-z0-9]+/g, '-')}`} className="font-display text-xl text-ink">{group.name}</h3>
              <span className="text-sm text-secondary">{group.learners.length} {group.learners.length === 1 ? 'learner' : 'learners'}</span>
            </div>
            <div className="divide-y divide-hairline rounded-lg bg-card px-4">
              {group.learners.map(({ member, skill }) => <div key={`${member.id}-${skill.id}`} className="flex flex-wrap items-center gap-3 py-3">
                <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={8} />
                <div className="min-w-48 flex-1">
                  <p className="font-medium text-ink">{member.name}</p>
                  <p className="text-sm text-secondary">Self rating: {LEVEL_LABELS[skill.level] ?? 'Not assessed'} · {skill.evidenceCount ?? 0} evidence {skill.evidenceCount === 1 ? 'item' : 'items'}</p>
                  <p className="text-sm text-secondary">Your rating: {LEVEL_LABELS[skill.managerRating?.level] ?? 'Not rated yet'}</p>
                </div>
                <button type="button" onClick={() => setSelection({ memberId: member.id, skillId: skill.id })}
                  aria-label={`Review ${group.name} for ${member.name}`}
                  className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-moss">
                  Review skill
                </button>
              </div>)}
            </div>
          </section>)}
        </div>
      </>}
  </section>
}
