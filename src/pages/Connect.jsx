import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import PersonAvatar from '../components/PersonAvatar'
import {
  acceptConnectInvite,
  clearPendingInviteCode,
  connectPendingInviteCode,
  getConnectInvitePreview,
  setPendingInviteCode,
} from '../lib/connections'

// Where an invitation to connect (emailed, or a shared link) lands. Shows who
// sent it and lets the visitor accept -- signing up or logging in first if
// need be, then coming back here (see pendingInvitePath). Nothing is
// connected until they choose to.
export default function Connect() {
  const { code } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [preview, setPreview] = useState(undefined)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (authLoading) return
    let active = true
    getConnectInvitePreview(code)
      .then((data) => { if (active) setPreview(data) })
      .catch(() => { if (active) setPreview(null) })
    return () => { active = false }
  }, [code, user?.id, authLoading])

  useEffect(() => {
    if (user) clearPendingInviteCode()
  }, [user])

  function goToAuth(path) {
    setPendingInviteCode(connectPendingInviteCode(code))
    navigate(path)
  }

  async function accept() {
    setError(null)
    setAccepting(true)
    try {
      const inviterId = await acceptConnectInvite(code)
      navigate(`/skills-profile/${inviterId}`)
    } catch (err) {
      setError(err.message)
      setAccepting(false)
    }
  }

  const name = preview?.inviter_name || t('connectPage.someone')

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <main id="main-content" tabIndex={-1} className="w-full max-w-md bg-card border border-hairline rounded-lg p-8">
        <Link to="/" className="font-display text-3xl text-ink mb-1 block">LearnScope</Link>

        {preview === undefined || authLoading ? (
          <p className="text-sm text-secondary mt-4">{t('common.loading')}</p>
        ) : preview === null ? (
          <p className="text-sm text-ink mt-4">{t('connectPage.notFound')}</p>
        ) : (
          <>
            <div className="flex items-center gap-3 mt-5">
              <PersonAvatar name={preview.inviter_name} avatarUrl={preview.inviter_avatar_url} size={12} />
              <h1 className="font-display text-2xl text-ink break-words">{t('connectPage.heading', { name })}</h1>
            </div>
            <p className="mt-3 text-sm text-secondary text-pretty">{t('connectPage.intro')}</p>

            {preview.status === 'connected' ? (
              <>
                <p className="mt-6 text-sm text-ink">{t('connectPage.alreadyConnected', { name })}</p>
                <Link to="/connections" className="mt-3 inline-block rounded-md bg-moss text-paper py-2 px-6 font-medium hover:opacity-90">
                  {t('connectPage.goToPeople')}
                </Link>
              </>
            ) : preview.status === 'own_invite' ? (
              <>
                <p className="mt-6 text-sm text-ink">{t('connectPage.ownInvite')}</p>
                <Link to="/connections" className="mt-3 inline-block text-sm text-moss font-medium hover:underline">
                  {t('connectPage.goToPeople')}
                </Link>
              </>
            ) : ['used', 'revoked', 'expired'].includes(preview.status) ? (
              <p className="mt-6 text-sm text-ink">
                {preview.status === 'used'
                  ? t('connectPage.used')
                  : preview.status === 'expired' ? t('connectPage.expired', { name }) : t('connectPage.revoked')}
              </p>
            ) : (
              <>
                <p className="mt-6 rounded-md border border-moss/25 bg-moss/5 px-3 py-2 text-xs leading-relaxed text-secondary">
                  {t('connectPage.privacy')}
                </p>
                {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
                {user ? (
                  <button type="button" onClick={accept} disabled={accepting} className="mt-4 w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60">
                    {accepting ? t('connectPage.accepting') : t('connectPage.accept', { name })}
                  </button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <button type="button" onClick={() => goToAuth('/signup')} className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90">
                      {t('connectPage.signUp')}
                    </button>
                    <button type="button" onClick={() => goToAuth('/login')} className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper">
                      {t('connectPage.logIn')}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
