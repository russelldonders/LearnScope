import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNavVisibility } from '../context/NavVisibilityContext'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'
import { listConnections } from '../lib/connections'
import AppHeader from '../components/AppHeader'
import RecordActivitySection from '../components/RecordActivitySection'
import FindSkillModal from '../components/FindSkillModal'
import SkillGoalsDashboardPanel from '../components/SkillGoalsDashboardPanel'
import SkillGoalModal from '../components/SkillGoalModal'
import QuickActivityLog from '../components/QuickActivityLog'
import { listActiveGoalsForAttention } from '../lib/skillGoals'
import { todayDateString } from '../lib/checkin'

// Drives the "add your current role" banner, dismissible on its own. (The
// CV import banner lives on the Experience page; see ImportCvBanner.)
async function loadCurrentRoleBannerState() {
  const { data } = await supabase.rpc('get_my_profile').select('current_role_banner_dismissed_at').single()
  return data ?? { current_role_banner_dismissed_at: null }
}

async function countRows(table, userId) {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

export function dashboardResultValue(results, index, fallback) {
  return results[index].status === 'fulfilled' ? results[index].value : fallback
}

// Home: logging what you did and your goals. Where to take each skill next
// (the focus card, reminders, more ways to progress) is on the Skills page;
// the CV import prompt is on Experience; courses in progress are on Learning.
// With no goal due, how many of the rest show before "Show all".
const NEXT_GOALS_COUNT = 3

export default function Dashboard() {
  const { user } = useAuth()
  const { refreshNavVisibility } = useNavVisibility()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [addSkillOpen, setAddSkillOpen] = useState(false)
  const [addGoalOpen, setAddGoalOpen] = useState(false)
  // Goals added here while the page is open, shown first so the learner sees
  // what they just set up.
  const [addedGoalIds, setAddedGoalIds] = useState([])
  const [counts, setCounts] = useState(null)
  const [bannerState, setBannerState] = useState(null)
  const [goals, setGoals] = useState([])
  const [openGoalId, setOpenGoalId] = useState(null)
  // Goals that have been due a log while the page is open. They sit at the top
  // of the dashboard, and stay there once logged so the learner sees what they
  // just saved; they rejoin the other goals on the next visit.
  const [dueGoalIds, setDueGoalIds] = useState(() => new Set())
  const [fullFormOpen, setFullFormOpen] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [repeatRequest, setRepeatRequest] = useState(null)
  const location = useLocation()

  // "Log again" from the full activity page arrives here, since this is where
  // the "What did you do?" box is. Cleared from history once taken, so going
  // back or refreshing doesn't add the card a second time.
  useEffect(() => {
    const row = location.state?.logAgainRow
    if (!row) return
    setRepeatRequest({ row, nonce: Date.now() })
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reacts to a new hand-off
  }, [location.state])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [])

  async function loadSummary() {
    setLoading(true)
    const results = await Promise.allSettled([
      countRows('skills', user.id),
      countRows('courses', user.id),
      countRows('experience', user.id),
      listConnections(user.id).then((c) => c.length),
      loadCurrentRoleBannerState(),
      listActiveGoalsForAttention(user.id),
    ])
    const valueOr = (index, fallback) => dashboardResultValue(results, index, fallback)
    setCounts({ skills: valueOr(0, 0), courses: valueOr(1, 0), experience: valueOr(2, 0), connections: valueOr(3, 0) })
    setBannerState(valueOr(4, null))
    showGoals(valueOr(5, []))
    setLoading(false)
  }

  function showGoals(items) {
    const today = todayDateString()
    setGoals(items)
    setDueGoalIds((prev) => {
      const next = new Set(prev)
      for (const item of items) {
        if (item.nextLog && item.nextLog <= today) next.add(item.goal.id)
      }
      return next.size === prev.size ? prev : next
    })
  }

  // After a goal entry: reloads only the goals, and returns them so the card
  // can tell whether the entry was a new best.
  async function refreshGoals() {
    const items = await listActiveGoalsForAttention(user.id).catch(() => null)
    if (items) showGoals(items)
    return items
  }

  // After the quick log saved activities: goals and the recent activity list
  // both change.
  async function handleQuickLogged() {
    const items = await refreshGoals()
    setActivityRefresh((value) => value + 1)
    return items
  }

  async function dismissCurrentRoleBanner() {
    setBannerState((prev) => ({ ...prev, current_role_banner_dismissed_at: new Date().toISOString() }))
    await supabase
      .from('profiles')
      .update({ current_role_banner_dismissed_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  // One goals section: those due first and shown by default; with none due,
  // the next few. "Show all" opens the rest either way.
  const addedGoals = addedGoalIds.map((id) => goals.find((item) => item.goal.id === id)).filter(Boolean)
  const isAdded = (item) => addedGoalIds.includes(item.goal.id)
  const dueGoals = goals.filter((item) => dueGoalIds.has(item.goal.id) && !isAdded(item))
  const otherGoals = goals.filter((item) => !dueGoalIds.has(item.goal.id) && !isAdded(item))
  const orderedGoals = [...addedGoals, ...dueGoals, ...otherGoals]
  const pinnedCount = addedGoals.length + dueGoals.length

  // A goal added from Home: its skill may be new, so the nav and goals reload.
  async function handleGoalAdded(created) {
    setAddGoalOpen(false)
    if (created) setAddedGoalIds((ids) => [created.id, ...ids.filter((id) => id !== created.id)])
    refreshNavVisibility()
    await refreshGoals()
  }
  const isEmpty = !loading && counts.skills + counts.experience + counts.courses + counts.connections === 0

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        <h1 className="sr-only">{t('nav.home')}</h1>

        {!loading && (
          <SkillGoalsDashboardPanel
            items={orderedGoals}
            collapsedCount={pinnedCount > 0 ? pinnedCount : NEXT_GOALS_COUNT}
            onAddGoal={() => setAddGoalOpen(true)}
            user={user}
            openGoalId={openGoalId}
            onOpenGoal={setOpenGoalId}
            onChanged={handleQuickLogged}
            subtitle={
              orderedGoals.length === 0
                ? t('skillGoals.dashboard.emptySubtitle')
                : dueGoals.length > 0 ? t('skillGoals.dashboard.dueSubtitle') : undefined
            }
          />
        )}

        {loading ? (
          <DashboardSkeleton />
        ) : isEmpty ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary mb-4">
              {t('dashboard.emptyState')}
            </p>
            <button
              type="button"
              onClick={() => setAddSkillOpen(true)}
              className="inline-block rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
            >
              {t('dashboard.addFirstSkill')}
            </button>
          </div>
        ) : (
          <OverviewStrip counts={counts} />
        )}

        {!loading &&
          counts.experience === 0 &&
          counts.skills + counts.courses + counts.connections > 0 &&
          !bannerState?.current_role_banner_dismissed_at && (
            <div className="rounded-lg border border-dashed border-hairline bg-card p-6 text-center">
              <h2 className="font-display text-xl text-ink mb-1">{t('dashboard.addCurrentRole.title')}</h2>
              <p className="text-sm text-secondary mb-4 max-w-md mx-auto text-pretty">
                Your Experience timeline is empty. Record the job you're in now so LearnScope can
                start linking your skills, courses and achievements to it.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/experience', { state: { autoOpenType: 'employment' } })}
                  className="inline-block rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90"
                >
                  {t('dashboard.addCurrentRole.recordButton')}
                </button>
                <button
                  type="button"
                  onClick={dismissCurrentRoleBanner}
                  className="text-sm text-secondary hover:text-ink whitespace-nowrap"
                >
                  {t('dashboard.addCurrentRole.dismiss')}
                </button>
              </div>
            </div>
          )}

        {!loading && counts.skills > 0 && (
          <RecordActivitySection
            formOpen={fullFormOpen}
            onFormOpenChange={setFullFormOpen}
            refreshKey={activityRefresh}
            onSaved={refreshGoals}
            onLogAgain={(row) => setRepeatRequest({ row, nonce: Date.now() })}
          >
            <QuickActivityLog
              embedded
              user={user}
              goalItems={goals}
              onLogged={handleQuickLogged}
              onOpenFullForm={() => setFullFormOpen(true)}
              repeatRequest={repeatRequest}
            />
          </RecordActivitySection>
        )}
      </main>

      {addGoalOpen && (
        <SkillGoalModal userId={user.id} onSaved={handleGoalAdded} onClose={() => setAddGoalOpen(false)} />
      )}

      {addSkillOpen && (
        <FindSkillModal
          onClose={() => setAddSkillOpen(false)}
          onCreated={() => {
            refreshNavVisibility()
            navigate('/skills')
          }}
        />
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading your dashboard…</span>
      <div aria-hidden="true" className="grid gap-4 lg:grid-cols-3 animate-pulse motion-reduce:animate-none">
        <div className="h-20 rounded-lg bg-card border border-hairline lg:col-span-3" />
        <div className="h-48 rounded-lg bg-card border border-hairline lg:col-span-3" />
      </div>
    </div>
  )
}

export function OverviewStrip({ counts }) {
  const items = [
    { to: '/skills', label: 'Skills', value: counts.skills, unit: 'tracked' },
    { to: '/experience', label: 'Experience', value: counts.experience, unit: 'entries' },
    { to: '/learning', label: 'Courses', value: counts.courses, unit: 'completed' },
    { to: '/connections', label: 'Connections', value: counts.connections, unit: 'people' },
  ]

  return (
    <div className="grid grid-cols-2 border-y border-hairline lg:grid-cols-4">
      {items.map((item, index) => (
        <Link
          key={item.to}
          to={item.to}
          className={`group flex items-baseline gap-2 py-4 hover:text-moss ${
            index % 2 === 0 ? 'pr-4' : 'pl-4'
          } ${index % 2 === 1 ? 'border-l border-hairline' : ''} ${
            index > 1 ? 'border-t border-hairline lg:border-t-0' : ''
          } ${index > 0 ? 'lg:border-l lg:pl-5' : ''}`}
        >
          <span className="font-display text-2xl text-ink group-hover:text-moss">{item.value}</span>
          <span className="min-w-0 text-sm text-secondary">
            <span className="block text-ink group-hover:text-moss">{item.label}</span>
            <span className="text-xs">{item.unit}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
