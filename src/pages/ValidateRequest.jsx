import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { supabase } from '../lib/supabaseClient'
import { getEvidenceSignedUrl } from '../lib/skillEvidence'
import { decideValidationRequest } from '../lib/skillValidationRequests'
import { LEVEL_LABELS } from '../lib/levels'
import { activityName, verbLabel } from '../lib/xapiStatement'
import { fetchStatementsForSkill } from '../lib/activitySkillLinks'
import AppHeader from '../components/AppHeader'
import { useLanguage } from '../context/LanguageContext'
import GrowthRing from '../components/GrowthRing'
import { formatFullDate } from '../lib/dates'

// Assessment sources with their own label under validateRequest.sources;
// anything else falls back to the self-assessed label, as before.
const SOURCES = ['self', 'course', 'ai_baseline', 'ai_evaluation']

export default function ValidateRequest() {
  const { requestId } = useParams()
  const { user } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [request, setRequest] = useState(null)
  const [requesterName, setRequesterName] = useState('')
  const [skill, setSkill] = useState(null)
  const [assessments, setAssessments] = useState([])
  const [peerRatings, setPeerRatings] = useState([])
  const [raterNames, setRaterNames] = useState({})
  const [courseLinks, setCourseLinks] = useState([])
  const [statements, setStatements] = useState([])
  const [comments, setComments] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [decideError, setDecideError] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [requestId])

  async function load() {
    setLoading(true)
    setNotFound(false)
    const { data: req, error: reqError } = await supabase
      .from('skill_validation_requests')
      .select('*')
      .eq('id', requestId)
      .single()
    if (reqError || !req) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setRequest(req)

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', req.requester_id)
      .single()
    setRequesterName(profile?.full_name || '')

    const isValidator = req.validator_id === user.id
    if (isValidator) {
      const [{ data: sk }, { data: ass }, { data: ratings }, { data: courses }, st] = await Promise.all([
        supabase.from('skills').select('*').eq('id', req.skill_id).single(),
        supabase
          .from('skill_assessments')
          .select('*')
          .eq('skill_id', req.skill_id)
          .order('assessed_at', { ascending: false }),
        supabase.from('skill_peer_ratings').select('*').eq('skill_id', req.skill_id).order('rated_at', { ascending: false }),
        supabase
          .from('skill_course_links')
          .select('id, courses(name, completed_date)')
          .eq('skill_id', req.skill_id),
        fetchStatementsForSkill(req.skill_id),
      ])
      setSkill(sk ?? null)
      setAssessments(ass ?? [])
      setPeerRatings(ratings ?? [])
      setCourseLinks(courses ?? [])
      setStatements(st)

      const raterIds = [...new Set((ratings ?? []).map((r) => r.rater_id).filter(Boolean))]
      if (raterIds.length > 0) {
        const { data: raterProfiles } = await supabase.from('profiles').select('id, full_name').in('id', raterIds)
        setRaterNames(Object.fromEntries((raterProfiles ?? []).map((p) => [p.id, p.full_name])))
      }
    }
    setLoading(false)
  }

  async function handleDecide(confirmed) {
    setDecideError(null)
    setDeciding(true)
    try {
      await decideValidationRequest(requestId, confirmed, comments)
      refreshPendingActionCount()
      await load()
    } catch (err) {
      setDecideError(err.message)
    } finally {
      setDeciding(false)
    }
  }

  const isValidator = request && request.validator_id === user.id
  const isRequester = request && request.requester_id === user.id
  const displayRequesterName = requesterName || t('validateRequest.defaultRequesterName')

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/actions" className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          {t('validateRequest.backToActions')}
        </Link>

        {loading && <p className="text-secondary">{t('common.loading')}</p>}
        {notFound && <p role="alert" className="text-sm text-red-700">{t('validateRequest.notFound')}</p>}

        {request && !loading && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <h1 className="font-display text-2xl text-ink mb-1">{t('validateRequest.title')}</h1>
            <p className="text-sm text-secondary mb-4">
              {t('validateRequest.askedPrefix', { name: displayRequesterName })}{' '}
              <strong className="text-ink">{LEVEL_LABELS[request.target_level]}</strong>
              {skill ? t('validateRequest.onSkill', { skill: skill.name }) : ''}.
            </p>

            <StatusBadge status={request.status} />

            {request.status !== 'pending' && (
              <div className="mt-4 space-y-1">
                <p className="text-sm text-ink">
                  {t('validateRequest.decided', {
                    date: request.decided_at ? new Date(request.decided_at).toLocaleDateString() : '',
                  })}
                </p>
                {request.decision_comments && (
                  <p className="text-sm text-secondary">"{request.decision_comments}"</p>
                )}
              </div>
            )}

            {!isValidator && !isRequester && (
              <p className="text-sm text-secondary mt-4">{t('validateRequest.noAccess')}</p>
            )}

            {isRequester && !isValidator && (
              <p className="text-sm text-secondary mt-4">
                {requesterName
                  ? t('validateRequest.outcomeNoticeNamed', { name: requesterName })
                  : t('validateRequest.outcomeNotice')}
              </p>
            )}

            {isValidator && skill && (
              <div className="mt-6 space-y-6">
                <div className="flex items-center gap-3">
                  <GrowthRing level={skill.level} size={40} />
                  <div>
                    <p className="text-sm text-ink font-medium">{skill.name}</p>
                    <p className="text-xs text-secondary">
                      {t('validateRequest.currentlyTracked', {
                        level: LEVEL_LABELS[skill.level] || t('validateRequest.noLevel'),
                      })}
                    </p>
                  </div>
                </div>

                <EvidenceSection title={t('validateRequest.assessments')} empty={t('validateRequest.noAssessments')}>
                  {assessments.map((a) => (
                    <AssessmentRow key={a.id} assessment={a} />
                  ))}
                </EvidenceSection>

                <EvidenceSection title={t('validateRequest.peerRatings')} empty={t('validateRequest.noPeerRatings')}>
                  {peerRatings.map((r) => (
                    <div key={r.id} className="text-sm text-ink">
                      {t('validateRequest.peerRatingLine', {
                        name: raterNames[r.rater_id] || t('validateRequest.aConnection'),
                        level: LEVEL_LABELS[r.level],
                        date: new Date(r.rated_at).toLocaleDateString(),
                      })}
                      {r.comments && <span className="text-secondary"> — "{r.comments}"</span>}
                    </div>
                  ))}
                </EvidenceSection>

                <EvidenceSection title={t('validateRequest.linkedTraining')} empty={t('validateRequest.noLinkedTraining')}>
                  {courseLinks.map((l) => (
                    <div key={l.id} className="text-sm text-ink">
                      {l.courses?.name}
                      {l.courses?.completed_date && (
                        <span className="text-secondary">
                          {' '}
                          — {t('validateRequest.completedOn', { date: formatFullDate(l.courses.completed_date) })}
                        </span>
                      )}
                    </div>
                  ))}
                </EvidenceSection>

                <EvidenceSection title={t('validateRequest.recordedActivity')} empty={t('validateRequest.noRecordedActivity')}>
                  {statements.map((s) => (
                    <div key={s.id} className="text-sm text-ink">
                      {verbLabel(s.statement)} {activityName(s.statement)}
                      <span className="text-secondary"> — {new Date(s.recorded_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </EvidenceSection>

                {request.status === 'pending' && (
                  <div className="pt-2 border-t border-hairline">
                    <label className="block text-sm text-secondary mb-1" htmlFor="decisionComments">
                      {t('validateRequest.feedbackLabel')}
                    </label>
                    <textarea
                      id="decisionComments"
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss mb-3"
                      placeholder={t('validateRequest.feedbackPlaceholder')}
                    />
                    {decideError && <p className="text-sm text-red-700 mb-3">{decideError}</p>}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecide(true)}
                        disabled={deciding}
                        className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                      >
                        {deciding
                          ? t('validateRequest.saving')
                          : t('validateRequest.confirmLevel', { level: LEVEL_LABELS[request.target_level] })}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecide(false)}
                        disabled={deciding}
                        className="flex-1 rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
                      >
                        {t('validateRequest.decline')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function StatusBadge({ status }) {
  const { t } = useLanguage()
  const styles = {
    pending: 'text-gold border-gold bg-gold/10',
    confirmed: 'text-moss border-moss bg-moss/10',
    declined: 'text-red-700 border-red-700 bg-red-50',
  }
  return (
    <span className={`font-mono text-xs uppercase tracking-wide rounded-full px-2.5 py-1 inline-block border ${styles[status]}`}>
      {styles[status] ? t(`validateRequest.status.${status}`) : null}
    </span>
  )
}

function EvidenceSection({ title, empty, children }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">{title}</h3>
      {hasChildren ? <div className="space-y-2">{children}</div> : <p className="text-sm text-secondary">{empty}</p>}
    </div>
  )
}

function AssessmentRow({ assessment }) {
  const { t } = useLanguage()
  const source = SOURCES.includes(assessment.source) ? assessment.source : 'self'
  const paths = assessment.evidence_paths?.length
    ? assessment.evidence_paths
    : assessment.evidence_path
      ? [assessment.evidence_path]
      : []
  return (
    <div className="text-sm text-ink">
      <p>
        {LEVEL_LABELS[assessment.level]}
        <span className="text-secondary">
          {' '}
          — {t(`validateRequest.sources.${source}`)} ·{' '}
          {new Date(assessment.assessed_at).toLocaleDateString()}
        </span>
      </p>
      {assessment.comments && <p className="text-secondary">"{assessment.comments}"</p>}
      {(assessment.evidence_url || paths.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mt-1">
          {assessment.evidence_url && (
            <a href={assessment.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium">
              {t('validateRequest.evidenceLink')}
            </a>
          )}
          {paths.map((path, i) => (
            <EvidenceLink key={path} path={path} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function EvidenceLink({ path, index }) {
  const { t } = useLanguage()
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (url) {
      window.open(url, '_blank', 'noopener')
      return
    }
    setLoading(true)
    try {
      const signed = await getEvidenceSignedUrl(path)
      setUrl(signed)
      window.open(signed, '_blank', 'noopener')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={loading} className="text-xs text-moss font-medium">
      {loading ? t('common.loading') : t('validateRequest.evidenceN', { n: index + 1 })}
    </button>
  )
}
