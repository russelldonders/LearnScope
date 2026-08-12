import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SkillsSection from '../components/SkillsSection'
import CoursesSection from '../components/CoursesSection'
import ExperienceSection from '../components/ExperienceSection'
import RecordExperienceSection from '../components/RecordExperienceSection'

export default function Dashboard() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-hairline bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="font-display text-2xl text-ink">LearnScope</h1>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-secondary hidden sm:inline">{user?.email}</span>
            <Link
              to="/connections"
              className="text-sm text-secondary hover:text-ink border border-hairline rounded-md px-3 py-1.5"
            >
              Connections
            </Link>
            <Link
              to="/profile"
              aria-label="Your profile"
              title="Your profile"
              className="flex items-center justify-center w-9 h-9 rounded-full border border-hairline text-ink hover:bg-paper"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              </svg>
            </Link>
            <button
              onClick={signOut}
              className="text-sm text-secondary hover:text-ink border border-hairline rounded-md px-3 py-1.5"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-16">
        <SkillsSection />
        <CoursesSection />
        <ExperienceSection />
        <RecordExperienceSection />
      </main>
    </div>
  )
}
