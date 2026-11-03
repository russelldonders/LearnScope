import { useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import { useLanguage } from '../context/LanguageContext'

const ROLE_KEYS = ['learner', 'manager', 'employer']

// Each guide is a list of sections, each a title key plus its paragraph keys
// under help.<role>.*. Paragraphs can mark **an object name** or
// [[a place in the app]]; RichText renders those with the same emphasis the
// guide used before it was translated.
const GUIDES = {
  learner: [
    ['ownershipTitle', ['ownershipP1', 'ownershipP2']],
    ['objectsTitle', ['objectsSkills', 'objectsExperience', 'objectsCourses']],
    ['connectionsTitle', ['connectionsP1', 'connectionsP2']],
    ['managerTitle', ['managerP1']],
    ['employerTitle', ['employerP1', 'employerP2', 'employerP3']],
    ['loginsTitle', ['loginsP1']],
    ['controlTitle', ['controlP1']],
  ],
  manager: [
    ['workspaceTitle', ['workspaceP1']],
    ['teamTitle', ['teamP1']],
    ['visibilityTitle', ['visibilityP1']],
    ['notesTitle', ['notesP1']],
  ],
  employer: [
    ['membershipTitle', ['membershipP1']],
    ['consentTitle', ['consentP1']],
    ['trainingTitle', ['trainingP1']],
    ['rolesTitle', ['rolesP1']],
    ['providersTitle', ['providersP1']],
  ],
}

// A learner-owned reference guide to how LearnScope's object types connect
// across roles -- not a feature announcement or a database reference.
// Written from each role's own point of view: what that role can see, what
// it can never see, and where the boundary between "your own record" and
// "explicitly shared" actually sits. Every claim here should trace back to
// an actual RLS policy or RPC in supabase/migrations/, not an assumption.
export default function Help() {
  const { t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeRole = ROLE_KEYS.includes(searchParams.get('role')) ? searchParams.get('role') : 'learner'
  const roleTabRefs = useRef({})

  function buildParams(overrides) {
    const next = new URLSearchParams(searchParams)
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === null || value === undefined) next.delete(key)
      else next.set(key, value)
    })
    return next
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="font-display text-xl text-ink mb-1">{t('help.heading')}</h1>
        <p className="text-sm text-secondary mb-6">{t('help.intro')}</p>

        <div
          role="tablist"
          aria-label={t('help.perspectiveLabel')}
          className="flex items-center flex-wrap gap-1 mb-6 border-b border-hairline"
        >
          {ROLE_KEYS.map((roleKey) => (
            <button
              key={roleKey}
              type="button"
              ref={(el) => { roleTabRefs.current[roleKey] = el }}
              id={`help-role-tab-${roleKey}`}
              role="tab"
              aria-selected={activeRole === roleKey}
              aria-controls={`help-role-panel-${roleKey}`}
              tabIndex={activeRole === roleKey ? 0 : -1}
              onClick={() => setSearchParams(buildParams({ role: roleKey }))}
              onKeyDown={(event) =>
                handleTabListKeyDown(event, {
                  keys: ROLE_KEYS,
                  activeKey: activeRole,
                  refs: roleTabRefs,
                  onChange: (key) => setSearchParams(buildParams({ role: key })),
                })
              }
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                activeRole === roleKey
                  ? 'border-moss text-ink font-medium'
                  : 'border-transparent text-secondary hover:text-ink'
              }`}
            >
              {t(`help.roles.${roleKey}`)}
            </button>
          ))}
        </div>

        <div id={`help-role-panel-${activeRole}`} role="tabpanel" aria-labelledby={`help-role-tab-${activeRole}`}>
          {GUIDES[activeRole].map(([titleKey, paragraphKeys]) => (
            <section key={titleKey} className="bg-card border border-hairline rounded-lg p-6 mb-4">
              <h2 className="font-display text-lg text-ink mb-2">{t(`help.${activeRole}.${titleKey}`)}</h2>
              <div className="text-sm text-secondary space-y-3">
                {paragraphKeys.map((key) => (
                  <p key={key}><RichText text={t(`help.${activeRole}.${key}`)} /></p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}

// **text** -> an object name, [[text]] -> a place in the app.
function RichText({ text }) {
  return text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <span key={i} className="text-ink font-medium">{part.slice(2, -2)}</span>
    }
    if (part.startsWith('[[') && part.endsWith(']]')) {
      return <span key={i} className="text-ink">{part.slice(2, -2)}</span>
    }
    return part
  })
}
