import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePendingActions } from '../context/PendingActionsContext'
import { supabase } from '../lib/supabaseClient'
import { getEvidenceSignedUrl } from '../lib/skillEvidence'
import { decideValidationRequest } from '../lib/skillValidationRequests'
import { LEVEL_LABELS } from '../lib/levels'
import { activityName, verbLabel } from '../lib/xapiStatement'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'

const SOURCE_LABELS = {
  self: 'Self-assessed',
  course: 'Earned by completing a course',
  ai_baseline: 'AI-assessed baseline',
  ai_evaluation: 'AI assessment',
}

export default function ValidateRequest() {
  const { requestId } = useParams()
  const { user } = useAuth()
  const { refreshPendingActionCount } = usePendingActions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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
  }, [requestId])

  async function load() {
    setLoading(true)
    setError(null)
    const { data: req, error: reqError } = await supabase
      .from('skill_validation_requests')
      .select('*')
      .eq('id', requestId)
      .single()
    if (reqError || !req) {
      setError("This request couldn't be found, or you don't have access to it.")
      setLoading(false)
      return
    }
    setRequest(req)

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', req.requester_id)
      .single()
    setRequesterName(profile?.full_name || 'This person')

    const isValidator = req.validator_id === user.id
    if (isValidator) {
      const [{ data: sk }, { data: ass }, { data: ratings }, { data: courses }, { data: st }] = await Promise.all([
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
        supabase.from('xapi_statements').select('*').eq('skill_id', req.skill_id).order('recorded_at', { ascending: false }),
      ])
      setSkill(sk ?? null)
      setAssessments(ass ?? [])
      setPeerRatings(ratings ?? [])
      setCourseLinks(courses ?? [])
      setStatements(st ?? [])

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

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/connections" className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          ← Back to connections
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {request && !loading && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <h1 className="font-display text-2xl text-ink mb-1">Validation request</h1>
            <p className="text-sm text-secondary mb-4">
              {requesterName} asked you to confirm they've reached{' '}
              <strong className="text-ink">{LEVEL_LABELS[request.target_level]}</strong>
              {skill ? ` on "${skill.name}"` : ''}.
            </p>

            <StatusBadge status={request.status} />

            {request.status !== 'pending' && (
              <div className="mt-4 space-y-1">
                <p className="text-sm text-ink">
                  Decided {request.decided_at ? new Date(request.decided_at).toLocaleDateString() : ''}
                </p>
                {request.decision_comments && (
                  <p className="text-sm text-secondary">"{request.decision_comments}"</p>
                )}
              </div>
            )}

            {!isValidator && !isRequester && (
              <p className="text-sm text-secondary mt-4">You don't have access to review this request.</p>
            )}

            {isRequester && !isValidator && (
              <p className="text-sm text-secondary mt-4">
                You'll see the outcome on the skill's timeline once {requesterName === 'This person' ? 'they' : requesterName} responds.
              </p>
            )}

            {isValidator && skill && (
              <div className="mt-6 space-y-6">
                <div className="flex items-center gap-3">
                  <GrowthRing level={skill.level} size={40} />
                  <div>
                    <p className="text-sm text-ink font-medium">{skill.name}</p>
                    <p className="text-xs text-secondary">Currently self-tracked at {LEVEL_LABELS[skill.level] || 'no level'}</p>
                  </div>
                </div>

                <EvidenceSection title="Assessments" empty="No assessments recorded yet.">
                  {assessments.map((a) => (
                    <AssessmentRow key={a.id} assessment={a} />
                  ))}
                </EvidenceSection>

                <EvidenceSection title="Peer ratings" empty="No peer ratings yet.">
                  {peerRatings.map((r) => (
                    <div key={r.id} className="text-sm text-ink">
                      {raterNames[r.rater_id] || 'A connection'} rated {LEVEL_LABELS[r.level]} on{' '}
                      {new Date(r.rated_at).toLocaleDateString()}
                      {r.comments && <span className="text-secondary"> — "{r.comments}"</span>}
                    </div>
                  ))}
                </EvidenceSection>

                <EvidenceSection title="Linked training" empty="No linked courses.">
                  {courseLinks.map((l) => (
                    <div key={l.id} className="text-sm text-ink">
                      {l.courses?.name}
                      {l.courses?.completed_date && (
                        <span className="text-secondary">
                          {' '}
                          — completed {new Date(l.courses.completed_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ))}
                </EvidenceSection>

                <EvidenceSection title="Recorded activity" empty="No recorded activity.">
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
                      Feedback (optional)
                    </label>
                    <textarea
                      id="decisionComments"
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss mb-3"
                      placeholder="Any comments for them, whichever way you decide"
                    />
                    {decideError && <p className="text-sm text-red-700 mb-3">{decideError}</p>}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecide(true)}
                        disabled={deciding}
                        className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                      >
                        {deciding ? 'Saving…' : `Confirm ${LEVEL_LABELS[request.target_level]}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecide(false)}
                        disabled={deciding}
                        className="flex-1 rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
                      >
                        Decline
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
  const styles = {
    pending: 'text-gold border-gold bg-gold/10',
    confirmed: 'text-moss border-moss bg-moss/10',
    declined: 'text-red-700 border-red-700 bg-red-50',
  }
  const labels = { pending: 'Awaiting your decision', confirmed: 'Confirmed', declined: 'Declined' }
  return (
    <span className={`font-mono text-xs uppercase tracking-wide rounded-full px-2.5 py-1 inline-block border ${styles[status]}`}>
      {labels[status]}
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
          — {SOURCE_LABELS[assessment.source] || 'Self-assessed'} ·{' '}
          {new Date(assessment.assessed_at).toLocaleDateString()}
        </span>
      </p>
      {assessment.comments && <p className="text-secondary">"{assessment.comments}"</p>}
      {(assessment.evidence_url || paths.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mt-1">
          {assessment.evidence_url && (
            <a href={assessment.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium">
              Evidence link
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
      {loading ? 'Loading…' : `Evidence ${index + 1}`}
    </button>
  )
}
