import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import GrowthRing from '../components/GrowthRing'
import { LEVELS } from '../lib/levels'
import { useLanguage } from '../context/LanguageContext'

export default function Landing() {
  const { user, loading } = useAuth()
  const { t } = useLanguage()

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
                {t('landing.goToDashboard')}
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm text-secondary hover:text-ink">
                  {t('landing.logIn')}
                </Link>
                <Link
                  to="/signup"
                  className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
                >
                  {t('landing.signUp')}
                </Link>
              </>
            )}
          </nav>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-4">
        <section className="py-16 sm:py-24 text-center">
          <h1 className="font-display text-4xl sm:text-5xl text-ink max-w-2xl mx-auto leading-tight">
            {t('landing.heroTitle')}
          </h1>
          <p className="text-secondary text-lg max-w-xl mx-auto mt-4">
            {t('landing.heroDescription')}
          </p>
          <div className="flex items-center justify-center gap-3 mt-8">
            <Link
              to="/signup"
              className="rounded-md bg-moss text-paper py-3 px-6 font-medium hover:opacity-90"
            >
              {t('landing.startButton')}
            </Link>
            <Link
              to="/login"
              className="rounded-md border border-hairline text-ink py-3 px-6 font-medium hover:bg-card"
            >
              {t('landing.logIn')}
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
            {t('landing.ringsCaption')}
          </p>
        </section>

        <section className="py-12 border-t border-hairline">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">{t('landing.historyTitle')}</h3>
              <p className="text-sm text-secondary">
                {t('landing.historyText')}
              </p>
            </div>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">{t('landing.evidenceTitle')}</h3>
              <p className="text-sm text-secondary">
                {t('landing.evidenceText')}
              </p>
            </div>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">{t('landing.storyTitle')}</h3>
              <p className="text-sm text-secondary">
                {t('landing.storyText')}
              </p>
            </div>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">{t('landing.controlTitle')}</h3>
              <p className="text-sm text-secondary">
                {t('landing.controlText')}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
