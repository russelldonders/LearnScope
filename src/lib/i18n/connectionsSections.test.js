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

// The Connections/Dashboard inline sections, the profile photo/import
// controls and the privacy settings page -- same rule as
// tokenLinkPages.test.js: every key they use is translated in every language
// rather than silently falling back to English.
const SOURCES = [
  teamsSource, teamInviteSource, activityFeedSource, activityRowSource,
  recordActivitySource, importDataSource, profilePhotoSource, profilePrivacySource,
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
]

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

describe('connections, dashboard and privacy settings translations', () => {
  it('finds the keys the sections use', () => {
    expect(staticKeys.length).toBeGreaterThan(150)
  })

  it.each(INTERFACE_LANGUAGES.map((l) => l.value))('has every key in %s', async (language) => {
    const dictionary = await loadTranslations(language)
    const missing = [...staticKeys, ...dynamicKeys].filter((key) => typeof resolve(dictionary, key) !== 'string')
    expect(missing).toEqual([])
  })
})
