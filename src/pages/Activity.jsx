import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import ActivityRow from '../components/ActivityRow'
import FilterRow from '../components/FilterRow'
import { relatedSkillsFromStatement, relatedExperienceFromStatement } from '../lib/xapiStatement'
import { XAPI_VERBS, XAPI_VERB_BY_IRI } from '../lib/xapiVerbs'

const SORT_OPTIONS = [
  { value: 'happened_desc', labelKey: 'activity.sort.newest' },
  { value: 'happened_asc', labelKey: 'activity.sort.oldest' },
  { value: 'logged_desc', labelKey: 'activity.sort.recentlyLogged' },
]

export default function Activity() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [statements, setStatements] = useState([])
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [skillFilter, setSkillFilter] = useState(null)
  const [typeFilter, setTypeFilter] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState('happened_desc')

  useEffect(() => {
    loadStatements()
    loadSkills()
  }, [])

  async function loadStatements() {
    setLoading(true)
    const { data, error } = await supabase
      .from('xapi_statements')
      .select('*')
      .eq('user_id', user.id)
    if (error) setError(error.message)
    else setStatements(data)
    setLoading(false)
  }

  async function loadSkills() {
    const { data } = await supabase
      .from('skills')
      .select('id, name')
      .eq('user_id', user.id)
      .order('name')
    setSkills(data ?? [])
  }

  function goToActivity(row, relatedSkills, relatedExperience) {
    if (relatedExperience) {
      navigate(`/experience/${relatedExperience.id}`, { state: { highlightActivityId: row.id } })
    } else if (relatedSkills[0]) {
      navigate(`/skills/${relatedSkills[0].id}`, { state: { highlightActivityId: row.id } })
    }
  }

  const filteredStatements = useMemo(() => {
    return statements
      .filter((row) => {
        const relatedSkills = relatedSkillsFromStatement(row.statement)
        const verb = XAPI_VERB_BY_IRI[row.statement.verb?.id]?.value
        const happenedDate = row.recorded_at.slice(0, 10)
        return (
          (!skillFilter || relatedSkills.some((s) => s.id === skillFilter)) &&
          (!typeFilter || verb === typeFilter) &&
          (!dateFrom || happenedDate >= dateFrom) &&
          (!dateTo || happenedDate <= dateTo)
        )
      })
      .sort((a, b) => {
        if (sortBy === 'happened_asc') return new Date(a.recorded_at) - new Date(b.recorded_at)
        if (sortBy === 'logged_desc') return new Date(b.created_at) - new Date(a.created_at)
        return new Date(b.recorded_at) - new Date(a.recorded_at)
      })
  }, [statements, skillFilter, typeFilter, dateFrom, dateTo, sortBy])

  const activeFilterCount = [skillFilter, typeFilter, dateFrom || null, dateTo || null].filter(
    (v) => v !== null
  ).length

  function clearFilters() {
    setSkillFilter(null)
    setTypeFilter(null)
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/dashboard" className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          {t('activity.backToDashboard')}
        </Link>

        <div className="max-w-2xl mb-7">
          <h1 className="font-display text-3xl sm:text-4xl text-ink text-balance">{t('activity.heading')}</h1>
          <p className="text-secondary mt-2 text-pretty">
            {t('activity.subheading')}
          </p>
        </div>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-red-700 text-sm">{error}</p>}

        {!loading && !error && (
          <>
            <div className="border-y border-hairline py-4 mb-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-secondary shrink-0">{t('activity.from')}</span>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-secondary shrink-0">{t('activity.to')}</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <label>
                    <span className="sr-only">{t('activity.filterBySkill')}</span>
                    <select
                      value={skillFilter ?? ''}
                      onChange={(e) => setSkillFilter(e.target.value || null)}
                      className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink"
                    >
                      <option value="">{t('activity.allSkills')}</option>
                      {skills.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-xs text-secondary hover:text-ink underline"
                    >
                      {t('activity.clearFilters')} ({activeFilterCount})
                    </button>
                  )}
                </div>
                <label className="shrink-0">
                  <span className="sr-only">{t('activity.sortActivity')}</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <FilterRow
                label="Type"
                value={typeFilter}
                onChange={setTypeFilter}
                options={XAPI_VERBS.map((v) => ({ value: v.value, label: v.label }))}
              />
            </div>

            {statements.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
                <p className="text-secondary">{t('activity.emptyState')}</p>
              </div>
            ) : filteredStatements.length === 0 ? (
              <p className="text-sm text-secondary">{t('activity.noMatch')}</p>
            ) : (
              <div className="space-y-2">
                {filteredStatements.map((row) => {
                  const relatedSkills = relatedSkillsFromStatement(row.statement)
                  const relatedExperience = relatedExperienceFromStatement(row.statement)
                  const canNavigate = Boolean(relatedExperience || relatedSkills[0])
                  return (
                    <ActivityRow
                      key={row.id}
                      row={row}
                      onClick={canNavigate ? () => goToActivity(row, relatedSkills, relatedExperience) : undefined}
                    />
                  )
                })}
              </div>
            )}

            {filteredStatements.length > 0 && statements.length !== filteredStatements.length && (
              <p className="text-xs text-secondary mt-2">
                Showing {filteredStatements.length} of {statements.length}.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  )
}
