import { useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import ManagerSkillsPanel from './ManagerSkillsPanel'
import ManagerTeamPanel from './ManagerTeamPanel'
import ManagerLearningPanel from './ManagerLearningPanel'
import ManagerCollaborationPanel from './ManagerCollaborationPanel'
import { handleTabListKeyDown } from '../../lib/tabsKeyboard'
import { FIXTURE_TEAM, FIXTURE_LEARNING, FIXTURE_RECORDS } from './managerFixtures'

const SECTIONS = [
  { key: 'skills', label: 'Skills' },
  { key: 'members', label: 'Members' },
  { key: 'learning', label: 'Learning' },
  { key: 'collaboration', label: 'Collaboration' },
]

// Independent-manager workspace: a UI/access layer above the existing
// domains, not a lightweight employer -- it extends connections (Team) and
// adds team-scoped collaborative learning and manager-authored
// collaboration records, with no employer-owned member profiles. A manager
// only ever sees what a team member has explicitly shared (skills,
// evidence) plus learning that's inherently team-scoped (done together) --
// never a member's complete learner profile or personal course history.
// See each panel's own header comment for its exact view-model contract.
//
// This shell and its four panels are presentation only. Every prop below
// defaults to feature-local fixture data (managerFixtures.js) purely so the
// console renders something meaningful before real data exists -- pass real
// arrays/callbacks as props to override. Wiring this console into /manager,
// its route guard, its data-access service (src/lib/managerTeams.js) and any
// AuthContext changes is deliberately out of scope for this pass. Mirrors
// AdminLayout.jsx/EmployerConsole.jsx's own shell shape so this console
// looks and behaves consistently with the other three.
export default function ManagerConsole({
  team = FIXTURE_TEAM,
  learningRecords = FIXTURE_LEARNING,
  collaborationRecords = FIXTURE_RECORDS,
  loading = false,
  error = null,
  onInviteToTeam,
  onCreateCollaborationRecord,
  onRateSkill,
  onLoadSkillAssessments,
  onLoadSkillDetail,
  onSetTarget,
  teamOptions: ledTeamOptions = [],
  selectedTeamId,
  onSelectTeam,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const activeSection = requestedSection === 'overview' ? 'skills' : requestedSection === 'team' ? 'members'
    : SECTIONS.some((section) => section.key === requestedSection) ? requestedSection : 'skills'
  const sectionTabRefs = useRef({})

  function buildParams(overrides) {
    const next = new URLSearchParams(searchParams)
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === null || value === undefined) next.delete(key)
      else next.set(key, value)
    })
    return next
  }

  const teamOptions = team.map((m) => ({ id: m.id, name: m.name }))

  return (
    <div className="min-h-screen bg-paper">
      {/* hideNavLinks: same reasoning as the other three consoles -- this is
          a distinct workspace from the learner-facing app, with its own nav
          (below) for switching between sections. */}
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">Manager console</h1>
        <p className="text-sm text-secondary mb-6">
          Start with the skills your learners share. Review progress, add your rating and set clear development targets.
        </p>

        {ledTeamOptions.length > 0 && <label className="block max-w-sm text-sm text-ink mb-6">Team you lead
          <select className="mt-1 w-full rounded-md border border-hairline bg-card px-3 py-2" value={selectedTeamId ?? ''}
            disabled={loading} onChange={(event) => onSelectTeam?.(event.target.value)}>
            {ledTeamOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}

        <div role="tablist" aria-label="Console section" className="flex items-center flex-wrap gap-1 mb-6 border-b border-hairline">
          {SECTIONS.map((section) => (
            <Link
              key={section.key}
              ref={(el) => { sectionTabRefs.current[section.key] = el }}
              id={`manager-section-tab-${section.key}`}
              to={`?${buildParams({ section: section.key }).toString()}`}
              role="tab"
              aria-selected={activeSection === section.key}
              aria-controls={`manager-section-panel-${section.key}`}
              tabIndex={activeSection === section.key ? 0 : -1}
              onKeyDown={(event) =>
                handleTabListKeyDown(event, {
                  keys: SECTIONS.map((s) => s.key),
                  activeKey: activeSection,
                  refs: sectionTabRefs,
                  onChange: (sectionKey) => setSearchParams(buildParams({ section: sectionKey })),
                })
              }
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                activeSection === section.key
                  ? 'border-moss text-ink font-medium'
                  : 'border-transparent text-secondary hover:text-ink'
              }`}
            >
              {section.label}
            </Link>
          ))}
        </div>

        <div
          id={`manager-section-panel-${activeSection}`}
          role="tabpanel"
          aria-labelledby={`manager-section-tab-${activeSection}`}
          tabIndex={0}
        >
          {activeSection === 'skills' && (
            <ManagerSkillsPanel members={team} loading={loading} error={error} onRateSkill={onRateSkill}
              onLoadSkillAssessments={onLoadSkillAssessments} onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} />
          )}
          {activeSection === 'members' && (
            <ManagerTeamPanel
              members={team}
              loading={loading}
              error={error}
              onInvite={onInviteToTeam}
              onRateSkill={onRateSkill}
              onLoadSkillAssessments={onLoadSkillAssessments}
              onLoadSkillDetail={onLoadSkillDetail}
              onSetTarget={onSetTarget}
            />
          )}
          {activeSection === 'learning' && (
            <ManagerLearningPanel records={learningRecords} loading={loading} error={error} />
          )}
          {activeSection === 'collaboration' && (
            <ManagerCollaborationPanel
              records={collaborationRecords}
              teamOptions={teamOptions}
              loading={loading}
              error={error}
              onCreateRecord={onCreateCollaborationRecord}
            />
          )}
        </div>
      </main>
    </div>
  )
}
