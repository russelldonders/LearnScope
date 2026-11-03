import { describe, expect, it } from 'vitest'
import { INTERFACE_LANGUAGES, english, loadTranslations } from './translations'
import teamsSource from '../../components/ConnectionsTeams.jsx?raw'
import teamInviteSource from '../../components/ConnectionTeamInviteControl.jsx?raw'
import activityFeedSource from '../../components/ConnectionsActivityFeed.jsx?raw'
import activityRowSource from '../../components/ActivityRow.jsx?raw'
import recordActivitySource from '../../components/RecordActivitySection.jsx?raw'
import importDataSource from '../../components/ImportProfileDataButton.jsx?raw'
import profilePhotoSource from '../../components/ProfilePhoto.jsx?raw'
import profilePrivacySource from '../../pages/ProfilePrivacy.jsx?raw'
import connected0 from '../../pages/ConnectedAccounts.jsx?raw'
import connected1 from '../../pages/account-linking/LtiAccounts.jsx?raw'
import connected2 from '../../pages/account-linking/CreateLinkInvitationForm.jsx?raw'
import connected3 from '../../pages/account-linking/LinkInvitationSuccess.jsx?raw'
import connected4 from '../../pages/account-linking/RedeemInvitationPanel.jsx?raw'
import connected5 from '../../pages/account-linking/LinkedAccountsList.jsx?raw'
import connected6 from '../../pages/account-linking/LinkedWorkspaceAccessPanel.jsx?raw'
import transferPlansSource from '../profileTransferPlans.js?raw'
import transferPreviewsSource from '../profileTransferPreviews.js?raw'
import connected8 from '../../pages/account-linking/transfer/TransferPreviewConsentPanel.jsx?raw'
import connected9 from '../../pages/account-linking/transfer/TransferPreviewPanel.jsx?raw'
import connected10 from '../../pages/account-linking/transfer/AccountProfileSummaryCard.jsx?raw'
import connected11 from '../../pages/account-linking/transfer/TransferConflictsSummary.jsx?raw'
import connected12 from '../../pages/account-linking/transfer-plan/TransferPlanReviewPanel.jsx?raw'
import connected13 from '../../pages/account-linking/transfer-plan/PlanAccountsSummary.jsx?raw'
import connected14 from '../../pages/account-linking/transfer-plan/PlanCategoryBreakdown.jsx?raw'
import connected15 from '../../pages/account-linking/transfer-plan/PlanConflictResolutionList.jsx?raw'
import connected16 from '../../pages/account-linking/transfer-plan/PlanApprovalPanel.jsx?raw'

// The Connections/Dashboard inline sections, the profile photo/import
// controls, the privacy settings page and the connected accounts area -- same
// rule as tokenLinkPages.test.js: every key they use is translated in every
// language rather than silently falling back to English.
const SOURCES = [
  teamsSource, teamInviteSource, activityFeedSource, activityRowSource,
  recordActivitySource, importDataSource, profilePhotoSource, profilePrivacySource,
  connected0, connected1, connected2, connected3, connected4, connected5, connected6, transferPlansSource, connected8,
  connected9, connected10, connected11, connected12, connected13, connected14, connected15, connected16,
  transferPreviewsSource,
]

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
]

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

describe('connections, dashboard, privacy and connected accounts translations', () => {
  it('finds the keys the sections use', () => {
    expect(staticKeys.length).toBeGreaterThan(300)
  })

  it.each(INTERFACE_LANGUAGES.map((l) => l.value))('has every key in %s', async (language) => {
    const dictionary = await loadTranslations(language)
    const missing = [...staticKeys, ...dynamicKeys].filter((key) => typeof resolve(dictionary, key) !== 'string')
    expect(missing).toEqual([])
  })
})
