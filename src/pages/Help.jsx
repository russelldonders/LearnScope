import { useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'

const ROLES = [
  { key: 'learner', label: 'As a learner' },
  { key: 'manager', label: 'As a manager' },
  { key: 'employer', label: 'As an employer admin' },
]

// A learner-owned reference guide to how LearnScope's object types connect
// across roles -- not a feature announcement or a database reference.
// Written from each role's own point of view: what that role can see, what
// it can never see, and where the boundary between "your own record" and
// "explicitly shared" actually sits. Every claim here should trace back to
// an actual RLS policy or RPC in supabase/migrations/, not an assumption --
// see each section's own note where the underlying mechanism is named.
export default function Help() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeRole = ROLES.some((r) => r.key === searchParams.get('role')) ? searchParams.get('role') : 'learner'
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
        <h1 className="font-display text-xl text-ink mb-1">How LearnScope fits together</h1>
        <p className="text-sm text-secondary mb-6">
          A plain-language guide to the records LearnScope keeps, who owns them, and exactly what gets shared
          with a manager or employer -- and what never does. Pick the perspective closest to how you're using
          LearnScope right now; the underlying objects are the same from every angle, just what you can see of
          them changes.
        </p>

        <div
          role="tablist"
          aria-label="Perspective"
          className="flex items-center flex-wrap gap-1 mb-6 border-b border-hairline"
        >
          {ROLES.map((role) => (
            <button
              key={role.key}
              type="button"
              ref={(el) => { roleTabRefs.current[role.key] = el }}
              id={`help-role-tab-${role.key}`}
              role="tab"
              aria-selected={activeRole === role.key}
              aria-controls={`help-role-panel-${role.key}`}
              tabIndex={activeRole === role.key ? 0 : -1}
              onClick={() => setSearchParams(buildParams({ role: role.key }))}
              onKeyDown={(event) =>
                handleTabListKeyDown(event, {
                  keys: ROLES.map((r) => r.key),
                  activeKey: activeRole,
                  refs: roleTabRefs,
                  onChange: (roleKey) => setSearchParams(buildParams({ role: roleKey })),
                })
              }
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
                activeRole === role.key
                  ? 'border-moss text-ink font-medium'
                  : 'border-transparent text-secondary hover:text-ink'
              }`}
            >
              {role.label}
            </button>
          ))}
        </div>

        {activeRole === 'learner' && <LearnerGuide />}
        {activeRole === 'manager' && <ManagerGuide />}
        {activeRole === 'employer' && <EmployerGuide />}
      </main>
    </div>
  )
}

function GuideSection({ title, children }) {
  return (
    <section className="bg-card border border-hairline rounded-lg p-6 mb-4">
      <h2 className="font-display text-lg text-ink mb-2">{title}</h2>
      <div className="text-sm text-secondary space-y-3">{children}</div>
    </section>
  )
}

function LearnerGuide() {
  return (
    <div id="help-role-panel-learner" role="tabpanel" aria-labelledby="help-role-tab-learner">
      <GuideSection title="Your profile is yours, not any employer's or provider's">
        <p>
          Everything you record in LearnScope -- skills, experience, courses, evidence -- belongs to your own
          personal profile. It isn't created by, or owned by, any employer, manager, or training provider you
          connect with. If you leave a job or a manager's team, your record goes with you unchanged; only the
          access you granted that employer or manager ends.
        </p>
        <p>
          Nothing you add is shared automatically. Every connection below -- a manager, an employer, another
          learner -- only ever sees what you've explicitly chosen to share with them, and you can see exactly
          who that is and change it at any time from <span className="text-ink">Profile → Privacy Settings</span>.
        </p>
      </GuideSection>

      <GuideSection title="The core objects in your record">
        <p>
          <span className="text-ink font-medium">Skills</span> are the center of your profile. Each one carries
          a level that changes over time -- LearnScope keeps that history rather than overwriting it, so your
          past proficiency stays visible even after you've improved. A skill can be backed by evidence:
          self-assessments, peer ratings from other learners, or activity recorded automatically (for example
          from a training package). Evidence doesn't have to exist for a skill to count, but a skill with
          evidence behind it is a stronger claim than one without.
        </p>
        <p>
          <span className="text-ink font-medium">Experience</span> entries are the employment and education
          chapters of your history. A chapter can link to the skills you developed or applied during it, and to
          courses you completed during it -- so your profile can show not just what you know, but roughly when
          and where you built it.
        </p>
        <p>
          <span className="text-ink font-medium">Courses</span> are training you've completed, whether you
          logged it yourself or enrolled through a training provider's catalogue. A course can link to the
          skills it developed and the experience chapter it happened during.
        </p>
      </GuideSection>

      <GuideSection title="Connections and validation">
        <p>
          A connection forms between you and another learner when you rate each other's skills, or when either
          of you sends and the other accepts a direct connection request. Connections are the basis for peer
          skill validation: you can ask a connection who already holds a matching, validated skill to review and
          confirm yours, giving it more weight than a self-assessment alone.
        </p>
        <p>
          <span className="text-ink">Actions</span> in the header is where everything currently waiting on you
          shows up in one place -- rating invites, connection requests, validation requests, and every request
          below from a manager or employer.
        </p>
      </GuideSection>

      <GuideSection title="Sharing with a manager">
        <p>
          A manager's team is not an employer relationship -- anyone can open a manager workspace and invite
          people from their own existing connections. When you join a team, the manager sees only the specific
          skills (and any evidence behind them) you actively choose to share, plus any learning activity your
          team does together. Your experience history, personal courses, and everything else stay invisible to
          them. You can change what's shared, or leave the team, at any time.
        </p>
      </GuideSection>

      <GuideSection title="Sharing with an employer">
        <p>
          Being a member of an employer's roster (through an invitation you accepted) never by itself exposes
          your personal profile -- membership and profile ownership are deliberately kept separate. An employer
          admin only gains visibility into your data after you've explicitly approved a data access request,
          and only into the skills you've shared under it; you can revoke that access at any time from Privacy
          Settings.
        </p>
        <p>
          Two things an employer can send you show up under Actions: a course assignment (you can start it or
          dismiss it) and a suggested skill (accepting adds it to your own profile as your own skill; declining
          discards the suggestion). Neither happens without your action.
        </p>
        <p>
          An employer can also propose linking one of their role profiles -- a named role with its own skill and
          training requirements -- to you. Accepting means choosing which of your own current employment
          entries that role connects to, so your profile shows how you measure up against its requirements. You
          can disconnect that link yourself at any point, and the employer can withdraw the proposal; either way
          your underlying experience record is untouched.
        </p>
      </GuideSection>

      <GuideSection title="Using more than one login as the same person">
        <p>
          If you use a personal account and a separate work-issued login (for example a company SSO account),
          <span className="text-ink"> Profile → Connected Apps</span> lets you verify that both belong to you
          without merging them. Verifying alone grants nothing -- the receiving login only gains view access to
          the other's personal profile after it explicitly accepts an offer to share, and either side can revoke
          that access independently at any time. Moving your actual records permanently from one login to the
          other (a full account transfer) is a separate, further step with its own review and two-party
          approval before anything moves.
        </p>
      </GuideSection>

      <GuideSection title="Where to control all of this">
        <p>
          <span className="text-ink">Profile → Privacy Settings</span> is the single place to see and change
          who can see what: your skills profile's visibility, whether you appear in the activity feed, whether
          your skills are discoverable in search, which employers currently have data access, what a manager
          team can see, and any public share links you've created.
        </p>
      </GuideSection>
    </div>
  )
}

function ManagerGuide() {
  return (
    <div id="help-role-panel-manager" role="tabpanel" aria-labelledby="help-role-tab-manager">
      <GuideSection title="A manager workspace is not an employer role">
        <p>
          Opening a manager workspace (from the account menu → Manager console) doesn't require any employer
          membership or admin approval -- it's a self-serve space anyone can use to organise a team and see
          shared learning, independent of any company relationship. The people on your team choose to be there
          and choose what you can see; you never get their full learner profile.
        </p>
      </GuideSection>

      <GuideSection title="Building a team">
        <p>
          You can only invite people you're already connected with as a learner -- there's no way to add someone
          you haven't connected with first. An invited person sees the invite as one of their own pending
          Actions and has to accept it before they appear on your team.
        </p>
      </GuideSection>

      <GuideSection title="What you can and can't see">
        <p>
          For each team member, you see exactly the skills (and any evidence behind them) they've chosen to
          share with you, plus learning that's inherently team-scoped -- collaborative activities and training
          the team does together. You never see a member's experience history, personal courses, or anything
          they haven't explicitly shared, and a member can change their shared skills or leave your team at any
          time without needing your approval.
        </p>
      </GuideSection>

      <GuideSection title="Collaboration records">
        <p>
          Notes you create about the team under Collaboration are your own working notes, authored by you for
          your own reference -- they aren't shown back to the learners on your team.
        </p>
      </GuideSection>
    </div>
  )
}

function EmployerGuide() {
  return (
    <div id="help-role-panel-employer" role="tabpanel" aria-labelledby="help-role-tab-employer">
      <GuideSection title="Membership and personal ownership are kept separate">
        <p>
          Someone appearing on your employer's member roster proves they accepted an invitation to that
          employer -- it never by itself proves, or grants, access to their personal LearnScope profile. Those
          are two different, independently controlled things by design, so leaving your employer never puts a
          learner's own record at risk, and joining never silently exposes it either.
        </p>
      </GuideSection>

      <GuideSection title="Seeing a learner's data requires their explicit consent">
        <p>
          To see anything beyond the fact that someone is a member, you send a data access request from the
          Learners section. The learner has to explicitly approve it, and even then you only see skills they've
          chosen to share under that approval -- not their full profile. They can revoke access at any time, and
          you'll immediately lose visibility.
        </p>
      </GuideSection>

      <GuideSection title="Assigning training and suggesting skills">
        <p>
          Both of these are proposals, not changes to the learner's record. Assigning training from your
          catalogue puts it on the learner's own Actions list -- they choose to start it or dismiss it. Same for
          suggesting a skill: if they accept, it's added as their own personal skill (not something you added to
          their profile); if they decline, nothing happens to their record at all.
        </p>
      </GuideSection>

      <GuideSection title="Role profiles and role assignments">
        <p>
          A role profile is a template you define at the employer level -- a name plus the skills and training
          it requires -- independent of any specific person. Proposing it to a member creates a pending
          assignment on their Actions list; only once they accept, choosing one of their own current employment
          entries to connect it to, does their profile start showing alignment against that role's requirements.
          They can disconnect that link on their own at any time, and you can withdraw a proposal that hasn't
          been accepted yet -- neither action touches their underlying experience record.
        </p>
      </GuideSection>

      <GuideSection title="Providers">
        <p>
          Linked training providers make their published course catalogues available for you to assign --
          providers manage their own catalogue content and course delivery independently of your employer
          account.
        </p>
      </GuideSection>
    </div>
  )
}
