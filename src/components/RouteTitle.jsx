import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'

// [pattern, routeTitles key] for learner-facing routes, translated; staff
// routes (organisation/admin consoles) keep a plain English title, same
// scope line as the rest of the interface translation.
const TITLES = [
  [/^\/$/, { key: 'home' }],
  [/^\/login$/, { key: 'login' }],
  [/^\/signup$/, { key: 'signup' }],
  [/^\/forgot-password$/, { key: 'forgotPassword' }],
  [/^\/reset-password$/, { key: 'resetPassword' }],
  [/^\/welcome$/, { key: 'welcome' }],
  [/^\/onboarding$/, { key: 'onboarding' }],
  [/^\/dashboard$/, { key: 'dashboard' }],
  [/^\/skills$/, { key: 'skills' }],
  [/^\/skills\/[^/]+$/, { key: 'skillDetails' }],
  [/^\/experience$/, { key: 'experience' }],
  [/^\/experience\/[^/]+$/, { key: 'experienceDetails' }],
  [/^\/profile$/, { key: 'profile' }],
  [/^\/profile\/privacy$/, { key: 'privacy' }],
  [/^\/profile\/import$/, { key: 'importProfile' }],
  [/^\/profile\/export$/, { key: 'exportProfile' }],
  [/^\/connections$/, { key: 'connections' }],
  [/^\/training$/, { key: 'findTraining' }],
  [/^\/learning$/, { key: 'learning' }],
  [/^\/plans$/, { key: 'plans' }],
  [/^\/plans\/[^/]+$/, { key: 'planDetails' }],
  [/^\/plan-invite\/[^/]+$/, { key: 'planInvite' }],
  [/^\/connect\/[^/]+$/, { key: 'connectInvite' }],
  [/^\/team$/, { key: 'myTeam' }],
  [/^\/team\/[^/]+$/, { key: 'teamMember' }],
  [/^\/courses\/[^/]+\/learn$/, { key: 'coursePlayer' }],
  [/^\/courses\/[^/]+$/, { key: 'courseDetails' }],
  [/^\/skills-profile\/[^/]+$/, { key: 'skillsProfile' }],
  [/^\/validate-request\/[^/]+$/, { key: 'validationRequest' }],
  [/^\/rate\/[^/]+$/, { key: 'rateSkill' }],
  [/^\/organisation\/training\/[^/]+$/, { text: 'Edit organisation course' }],
  [/^\/organisation\/catalogues\/[^/]+$/, { text: 'Organisation catalogue' }],
  [/^\/organisation\/learning$/, { key: 'organisationLearning' }],
  [/^\/organisation\/organisations\/[^/]+\/lms-connections$/, { text: 'LMS connections' }],
  [/^\/organisation\/organisations\/[^/]+\/lti-tools$/, { text: 'LTI tools' }],
  [/^\/organisation\/organisations\/[^/]+\/skills\/[^/]+$/, { text: 'Organisation skill' }],
  [/^\/organisation$/, { text: 'Organisation workspace' }],
  [/^\/organisation\/roles\/[^/]+$/, { text: 'Role profile details' }],
  [/^\/admin\/users\/[^/]+$/, { text: 'Admin user details' }],
  [/^\/admin\/users$/, { text: 'Admin users' }],
  [/^\/admin\/organisations\/[^/]+$/, { text: 'Admin organisation details' }],
  [/^\/admin\/organisations$/, { text: 'Admin organisations' }],
  [/^\/admin\/courses\/[^/]+\/edit$/, { text: 'Admin course builder' }],
  [/^\/admin\/courses\/[^/]+$/, { text: 'Admin course details' }],
  [/^\/admin\/courses$/, { text: 'Admin courses' }],
  [/^\/admin\/skills\/[^/]+$/, { text: 'Admin skill details' }],
  [/^\/admin\/skills$/, { text: 'Admin skills' }],
  [/^\/admin\/tags$/, { text: 'Admin skill tags' }],
  [/^\/admin\/ai-usage$/, { text: 'Admin AI usage' }],
  [/^\/admin\/reported-resources$/, { text: 'Admin reported resources' }],
  [/^\/admin\/reported-reviews$/, { text: 'Admin reported reviews' }],
  [/^\/admin\/audit-log$/, { text: 'Admin audit log' }],
  [/^\/admin\/whats-new$/, { text: "Admin what's new" }],
  [/^\/admin\/settings$/, { text: 'Admin settings' }],
  [/^\/admin$/, { text: 'Admin overview' }],
]

export default function RouteTitle() {
  const { pathname } = useLocation()
  const { t } = useLanguage()

  useEffect(() => {
    const match = TITLES.find(([pattern]) => pattern.test(pathname))?.[1]
    const title = match ? (match.key ? t(`routeTitles.${match.key}`) : match.text) : null
    document.title = title ? `${title} | LearnScope` : 'LearnScope'
  }, [pathname, t])

  return null
}
