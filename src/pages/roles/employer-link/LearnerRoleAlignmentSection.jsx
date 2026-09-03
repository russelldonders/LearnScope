import { useState } from 'react'
import CurrentRoleCard from './CurrentRoleCard'
import RoleProfileLinkPicker from './RoleProfileLinkPicker'
import RoleAlignmentSummary from './RoleAlignmentSummary'
import { computeRoleAlignment } from './roleAlignment'
import {
  FIXTURE_CURRENT_ROLE,
  FIXTURE_LEARNER_SKILLS,
  FIXTURE_LINKABLE_ROLE_PROFILES,
  FIXTURE_LINKED_ROLE_PROFILE,
} from './roleAlignmentFixtures'

// Self-contained fixture-backed demo composing the learner-facing pieces
// above: shows the learner's own current role always, then either the
// picker (not linked) or the alignment summary (linked) -- never both.
// Local state stands in for the real per-learner link this will eventually
// read/write; not wired into App.jsx/profile pages, kept isolated per this
// phase's scope.
export default function LearnerRoleAlignmentSection({
  currentRole = FIXTURE_CURRENT_ROLE,
  learnerSkills = FIXTURE_LEARNER_SKILLS,
  linkableRoleProfiles = FIXTURE_LINKABLE_ROLE_PROFILES,
  initialLinkedRoleProfile = null,
}) {
  const [linkedRoleProfile, setLinkedRoleProfile] = useState(initialLinkedRoleProfile)

  function handleLink(roleProfileId) {
    // Fixture-only: this demo only has full requirement/training detail for
    // one role profile (FIXTURE_LINKED_ROLE_PROFILE); linking any other
    // picked from the list reuses that detail but keeps the id/name/employer
    // actually chosen, so the summary stays consistent with the picker.
    const chosen = linkableRoleProfiles.find((p) => p.id === roleProfileId)
    setLinkedRoleProfile({
      ...FIXTURE_LINKED_ROLE_PROFILE,
      id: roleProfileId,
      name: chosen?.name ?? FIXTURE_LINKED_ROLE_PROFILE.name,
      employerName: chosen?.employerName ?? FIXTURE_LINKED_ROLE_PROFILE.employerName,
      linkedAt: new Date().toISOString().slice(0, 10),
    })
  }

  function handleDisconnect() {
    setLinkedRoleProfile(null)
  }

  const { aligned, gaps } = linkedRoleProfile
    ? computeRoleAlignment(learnerSkills, linkedRoleProfile.requiredSkills)
    : { aligned: [], gaps: [] }

  return (
    <div className="space-y-6">
      <CurrentRoleCard currentRole={currentRole} />
      {linkedRoleProfile ? (
        <RoleAlignmentSummary
          linkedRoleProfile={linkedRoleProfile}
          aligned={aligned}
          gaps={gaps}
          training={linkedRoleProfile.training}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <RoleProfileLinkPicker linkableRoleProfiles={linkableRoleProfiles} onLink={handleLink} />
      )}
    </div>
  )
}
