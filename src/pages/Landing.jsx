import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import GrowthRing from '../components/GrowthRing'
import { LEVELS } from '../lib/levels'

export default function Landing() {
  const { user, loading } = useAuth()

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
        <span className="flex items-center gap-2 font-display text-2xl text-ink">
          <img src="/favicon.svg" alt="" className="w-7 h-7" />
          LearnScope
        </span>
        {!loading && (
          <nav className="flex items-center gap-3">
            {user ? (
              <Link
                to="/dashboard"
                className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
              >
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm text-secondary hover:text-ink">
                  Log in
                </Link>
                <Link
                  to="/signup"
                  className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-4">
        <section className="py-16 sm:py-24 text-center">
          <h1 className="font-display text-4xl sm:text-5xl text-ink max-w-2xl mx-auto leading-tight">
            Track the skills you're growing, for life.
          </h1>
          <p className="text-secondary text-lg max-w-xl mx-auto mt-4">
            Skills, experience, learning and the evidence behind them — recorded with real dates
            and shown as growth rings, not progress bars. It's your record, not your employer's.
          </p>
          <div className="flex items-center justify-center gap-3 mt-8">
            <Link
              to="/signup"
              className="rounded-md bg-moss text-paper py-3 px-6 font-medium hover:opacity-90"
            >
              Start your skills log
            </Link>
            <Link
              to="/login"
              className="rounded-md border border-hairline text-ink py-3 px-6 font-medium hover:bg-card"
            >
              Log in
            </Link>
          </div>
        </section>

        <section className="py-12 border-t border-hairline">
          <div className="flex items-center justify-center gap-6 sm:gap-10">
            {LEVELS.map((l) => (
              <GrowthRing key={l} level={l} size={64} showLabel />
            ))}
          </div>
          <p className="text-center text-secondary text-sm mt-6 max-w-md mx-auto">
            Every skill grows one ring at a time — from your first attempts to raising the
            standard for others.
          </p>
        </section>

        <section className="py-12 border-t border-hairline">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">A real history, not a snapshot</h3>
              <p className="text-sm text-secondary">
                Proficiency, courses and achievements keep the date they actually happened, so you
                can see how you got here — not just where you are now.
              </p>
            </div>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Evidence, not just claims</h3>
              <p className="text-sm text-secondary">
                Self-assessments, courses, peer ratings and formal validations each carry their own
                weight — a skill you've proven looks different from one you've only logged.
              </p>
            </div>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Your whole development story</h3>
              <p className="text-sm text-secondary">
                Employment and education, courses and training, and the skills tied to each one —
                connected in one record instead of scattered across CVs and certificates.
              </p>
            </div>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">You control who sees it</h3>
              <p className="text-sm text-secondary">
                Nothing is shared with an employer, recruiter or connection unless you explicitly
                allow it.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
