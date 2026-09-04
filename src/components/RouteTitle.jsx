import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const TITLES = [
  [/^\/$/, 'Home'],
  [/^\/login$/, 'Log in'],
  [/^\/signup$/, 'Sign up'],
  [/^\/forgot-password$/, 'Forgot password'],
  [/^\/reset-password$/, 'Reset password'],
  [/^\/welcome$/, 'Welcome'],
  [/^\/onboarding$/, 'Set up your profile'],
  [/^\/dashboard$/, 'Dashboard'],
  [/^\/skills$/, 'Skills'],
  [/^\/skills\/[^/]+$/, 'Skill details'],
  [/^\/experience$/, 'Experience'],
  [/^\/experience\/[^/]+$/, 'Experience details'],
  [/^\/profile$/, 'Profile'],
  [/^\/profile\/privacy$/, 'Privacy settings'],
  [/^\/profile\/import$/, 'Import profile'],
  [/^\/profile\/export$/, 'Export profile'],
  [/^\/connections$/, 'Connections'],
  [/^\/training$/, 'Find training'],
  [/^\/learning$/, 'Learning'],
  [/^\/courses\/[^/]+\/learn$/, 'Course player'],
  [/^\/courses\/[^/]+$/, 'Course details'],
  [/^\/skills-profile\/[^/]+$/, 'Skills profile'],
  [/^\/validate-request\/[^/]+$/, 'Validation request'],
  [/^\/rate\/[^/]+$/, 'Rate a skill'],
  [/^\/provider\/training\/[^/]+$/, 'Edit provider course'],
  [/^\/provider$/, 'Provider console'],
  [/^\/admin\/users\/[^/]+$/, 'Admin user details'],
  [/^\/admin\/providers$/, 'Admin providers'],
  [/^\/admin\/catalogue$/, 'Admin courses'],
  [/^\/admin\/skills\/[^/]+$/, 'Admin skill details'],
  [/^\/admin\/skills$/, 'Admin skills'],
  [/^\/admin\/tags$/, 'Admin tags'],
  [/^\/admin$/, 'Admin users'],
]

export default function RouteTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    const match = TITLES.find(([pattern]) => pattern.test(pathname))
    document.title = match ? `${match[1]} | LearnScope` : 'LearnScope'
  }, [pathname])

  return null
}
