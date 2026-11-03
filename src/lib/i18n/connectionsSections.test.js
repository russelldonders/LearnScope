import { describe, expect, it } from 'vitest'
import { INTERFACE_LANGUAGES, loadTranslations } from './translations'
import teamsSource from '../../components/ConnectionsTeams.jsx?raw'
import teamInviteSource from '../../components/ConnectionTeamInviteControl.jsx?raw'
import activityFeedSource from '../../components/ConnectionsActivityFeed.jsx?raw'
import activityRowSource from '../../components/ActivityRow.jsx?raw'
import recordActivitySource from '../../components/RecordActivitySection.jsx?raw'
import importDataSource from '../../components/ImportProfileDataButton.jsx?raw'
import profilePhotoSource from '../../components/ProfilePhoto.jsx?raw'

// The Connections/Dashboard inline sections and the profile photo/import
// controls -- same rule as tokenLinkPages.test.js: every key they use is
// translated in every language rather than silently falling back to English.
const SOURCES = [
  teamsSource, teamInviteSource, activityFeedSource, activityRowSource,
  recordActivitySource, importDataSource, profilePhotoSource,
]

const staticKeys = [
  ...new Set(SOURCES.flatMap((source) => [...source.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]))),
]
// ConnectionsTeams builds these two families with template literals.
const dynamicKeys = [
  ...['skills', 'members', 'learning', 'collaboration', 'settings'].map((key) => `teams.panels.${key}`),
  ...['invite', 'accept', 'share'].flatMap((key) => [`teams.checklist.${key}`, `teams.checklist.${key}Action`]),
]

function resolve(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary)
}

describe('connections and dashboard section translations', () => {
  it('finds the keys the sections use', () => {
    expect(staticKeys.length).toBeGreaterThan(80)
  })

  it.each(INTERFACE_LANGUAGES.map((l) => l.value))('has every key in %s', async (language) => {
    const dictionary = await loadTranslations(language)
    const missing = [...staticKeys, ...dynamicKeys].filter((key) => typeof resolve(dictionary, key) !== 'string')
    expect(missing).toEqual([])
  })
})
