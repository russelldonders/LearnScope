import { describe, expect, it } from 'vitest'
import { INTERFACE_LANGUAGES, english, loadTranslations } from './translations'

// The translated learner-facing pages and sections -- same rule as
// tokenLinkPages.test.js: every key they use is translated in every language
// rather than silently falling back to English. Add a file here once it's
// wired to t().
const SOURCES = Object.values(import.meta.glob([
  '../../components/ConnectionsTeams.jsx',
  '../../components/ConnectionTeamInviteControl.jsx',
  '../../components/ConnectionsActivityFeed.jsx',
  '../../components/ActivityRow.jsx',
  '../../components/SkillGoal*.jsx',
  '../skillGoalProgress.js',
  '../../components/QuickActivityLog.jsx',
  '../quickActivityLog.js',
  '../../components/RecordActivitySection.jsx',
  '../../components/ImportProfileDataButton.jsx',
  '../../components/ProfilePhoto.jsx',
  '../../components/onboarding/SkillsToLearnStep.jsx',
  '../../pages/ProfilePrivacy.jsx',
  '../../pages/ConnectedAccounts.jsx',
  '../../pages/account-linking/**/*.jsx',
  '!../../pages/account-linking/**/*.test.jsx',
  '../profileTransferPlans.js',
  '../profileTransferPreviews.js',
  '../../pages/Landing.jsx',
  '../../pages/Welcome.jsx',
  '../../pages/ResetPassword.jsx',
  '../../pages/ProfileImport.jsx',
  '../../pages/Onboarding.jsx',
  '../../pages/LtiSession.jsx',
  '../../pages/Help.jsx',
  '../../pages/manager/learner/ManagerTeamSharingPanel.jsx',
  '../../pages/SkillsProfile.jsx',
  '../../pages/ProfileExport.jsx',
  '../../pages/CourseLearn.jsx',
  '../../pages/CourseCatalogue.jsx',
  '../../pages/ProviderProfile.jsx',
  '../../pages/manager/ManagerTeamPanel.jsx',
  '../../pages/manager/ManagerSkillsPanel.jsx',
  '../../pages/manager/ManagerLearningPanel.jsx',
  '../../pages/manager/ManagerCollaborationPanel.jsx',
  '../../pages/manager/ManagerMemberProfile.jsx',
  '../../components/EvidenceFields.jsx',
  '../../components/TableControls.jsx',
  '../../components/RouteTitle.jsx',
  '../../pages/employer/EmployerHome.jsx',
  '../../pages/employer/EmployerAssignedTrainingPanel.jsx',
  '../../pages/employer/EmployerCataloguePanel.jsx',
  '../../pages/roles/LearnerRoleAlignmentContainer.jsx',
  '../../pages/roles/employer-link/*.jsx',
  '!../../pages/roles/employer-link/*.test.jsx',
], { query: '?raw', import: 'default', eager: true }))

function flatKeys(object, prefix) {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'object' ? flatKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`])
}

// Any quoted dotted string starting with a top-level namespace, not just
// t('...') calls -- so keys picked inside a ternary (singular/plural pairs)
// are covered too.
const NAMESPACES = new Set(Object.keys(english))
const staticKeys = [
  ...new Set(SOURCES.flatMap((source) => [...source.matchAll(/'([a-zA-Z]+(?:\.\w+)+)'/g)].map((m) => m[1]))),
].filter((key) => NAMESPACES.has(key.split('.')[0]))
// Keys built with template literals.
const dynamicKeys = [
  ...['skills', 'members', 'learning', 'collaboration', 'settings'].map((key) => `teams.panels.${key}`),
  ...['invite', 'accept', 'share'].flatMap((key) => [`teams.checklist.${key}`, `teams.checklist.${key}Action`]),
  ...['Hidden', 'All', 'Selective'].flatMap((key) => [
    `profile.privacy.skillSearch.option${key}Label`, `profile.privacy.skillSearch.option${key}Detail`,
  ]),
  'profile.privacy.employers.categoryTraining', 'profile.privacy.employers.categoryExperience',
  ...['Pending', 'Approved', 'Executed', 'Cancelled', 'Expired'].flatMap((key) => [
    `connectedAccounts.planApprovalPanel.status${key}`, `connectedAccounts.planApprovalPanel.description${key}`,
  ]),
  ...['directionSent', 'directionReceived', 'statusActive', 'statusRevoked', 'accountTypePersonal',
    'accountTypeWorkSso', 'accountTypeWorkManaged'].map((key) => `connectedAccounts.linkedAccountsList.${key}`),
  // Help.jsx builds every key from its section list.
  ...flatKeys(english.help, 'help.'),
  // The goal components build their option and status keys from lists.
  ...flatKeys(english.skillGoals, 'skillGoals.'),
  // RouteTitle.jsx builds every key from its route list.
  ...flatKeys(english.routeTitles, 'routeTitles.'),
]

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

describe('learner interface translations', () => {
  it('finds the keys the pages use', () => {
    expect(SOURCES.length).toBeGreaterThan(30)
    expect(staticKeys.length).toBeGreaterThan(400)
  })

  it.each(INTERFACE_LANGUAGES.map((l) => l.value))('has every key in %s', async (language) => {
    const dictionary = await loadTranslations(language)
    const missing = [...staticKeys, ...dynamicKeys].filter((key) => typeof resolve(dictionary, key) !== 'string')
    expect(missing).toEqual([])
  })
})
