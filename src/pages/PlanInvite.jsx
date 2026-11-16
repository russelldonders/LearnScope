import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { clearPendingInviteCode, planPendingInviteCode, setPendingInviteCode } from '../lib/connections'
import { acceptPlanInvite, getPlanInvitePreview } from '../lib/learnerPlans'

// Where a plan's share link (or an emailed plan invitation) lands. Shows what
// the plan is and who shared it, and lets the visitor join -- signing up or
// logging in first if need be, then coming back here (see pendingInvitePath).
// Joining makes them a follower of the plan, with their own records for its
// items; they needn't be a connection.
export default function PlanInvite() {
  const { code } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [preview, setPreview] = useState(undefined)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (authLoading) return
    let active = true
    getPlanInvitePreview(code)
      .then((data) => { if (active) setPreview(data) })
      .catch(() => { if (active) setPreview(null) })
    return () => { active = false }
  }, [code, user?.id, authLoading])

  useEffect(() => {
    if (user) clearPendingInviteCode()
  }, [user])

  function goToAuth(path) {
    setPendingInviteCode(planPendingInviteCode(code))
    navigate(path)
  }

  async function join() {
    setError(null)
    setJoining(true)
    try {
      const planId = await acceptPlanInvite(code)
      navigate(`/plans/${planId}`)
    } catch (err) {
      setError(err.message)
      setJoining(false)
    }
  }

  const unavailable = preview && (preview.status === 'used' || preview.status === 'revoked')

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <main id="main-content" tabIndex={-1} className="w-full max-w-md bg-card border border-hairline rounded-lg p-8">
        <Link to="/" className="font-display text-3xl text-ink mb-1 block">LearnScope</Link>

        {preview === undefined || authLoading ? (
          <p className="text-sm text-secondary mt-4">{t('common.loading')}</p>
        ) : preview === null ? (
          <p className="text-sm text-ink mt-4">{t('plans.invitePage.notFound')}</p>
        ) : (
          <>
            <p className="text-sm text-secondary mt-4">{t('plans.invitePage.sharedBy', { name: preview.inviter_name })}</p>
            <h1 className="font-display text-2xl text-ink mt-1 break-words">{preview.plan_title}</h1>
            {preview.plan_description && <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words">{preview.plan_description}</p>}
            <p className="mt-2 text-xs text-secondary">{t('plans.invitePage.itemCount', { count: preview.item_count })}</p>

            {preview.status === 'joined' ? (
              <>
                <p className="mt-6 text-sm text-ink">{t('plans.invitePage.alreadyJoined')}</p>
                <Link to={`/plans/${preview.joined_plan_id}`} className="mt-3 inline-block rounded-md bg-moss text-paper py-2 px-6 font-medium hover:opacity-90">
                  {t('plans.invitePage.openYourCopy')}
                </Link>
              </>
            ) : preview.status === 'own_plan' ? (
              <>
                <p className="mt-6 text-sm text-ink">{t('plans.invitePage.ownPlan')}</p>
                <Link to="/plans" className="mt-3 inline-block text-sm text-moss font-medium hover:underline">{t('plans.backToPlans')}</Link>
              </>
            ) : unavailable ? (
              <p className="mt-6 text-sm text-ink">
                {preview.status === 'used' ? t('plans.invitePage.used') : t('plans.invitePage.revoked')}
              </p>
            ) : (
              <>
                <p className="mt-6 rounded-md border border-moss/25 bg-moss/5 px-3 py-2 text-xs leading-relaxed text-secondary">
                  {t('plans.invitePage.privacy', { name: preview.inviter_name })}
                </p>
                {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
                {user ? (
                  <button type="button" onClick={join} disabled={joining} className="mt-4 w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60">
                    {joining ? t('plans.invitePage.joining') : t('plans.invitePage.join')}
                  </button>
                ) : (
                  <div className="mt-4 space-y-3">
                    <button type="button" onClick={() => goToAuth('/signup')} className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90">
                      {t('plans.invitePage.signUpToJoin')}
                    </button>
                    <button type="button" onClick={() => goToAuth('/login')} className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper">
                      {t('plans.invitePage.logInToJoin')}
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
