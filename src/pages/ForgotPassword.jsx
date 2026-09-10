import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function ForgotPassword() {
  const { resetPasswordForEmail } = useAuth()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await resetPasswordForEmail(email)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm bg-card border border-hairline rounded-lg p-8">
        <Link to="/" className="flex items-center gap-2 font-display text-3xl text-ink mb-1">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          LearnScope
        </Link>
        <p className="text-secondary text-sm mb-6">{t('auth.forgotPassword.tagline')}</p>

        {sent ? (
          <p role="status" className="text-sm text-ink">
            {t('auth.forgotPassword.sent')}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="email">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>

            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
            </button>
          </form>
        )}

        <p className="text-sm text-secondary mt-6 text-center">
          <Link to="/login" className="text-moss font-medium">
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        </p>
      </div>
    </div>
  )
}
