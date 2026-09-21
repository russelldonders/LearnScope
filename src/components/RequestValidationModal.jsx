import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { LEVEL_LABELS } from '../lib/levels'
import AccessibleDialog from './AccessibleDialog'
import {
  listValidatorCandidates,
  createValidationRequest,
  getValidationRequestContact,
  sendValidationRequestEmail,
} from '../lib/skillValidationRequests'
import { useLanguage } from '../context/LanguageContext'

export default function RequestValidationModal({ skill, user, targetLevel, onClose, onRequested }) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    listValidatorCandidates(skill.library_skill_id, targetLevel)
      .then(setCandidates)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [skill.library_skill_id, targetLevel])

  const selected = candidates.find((c) => c.validator_id === selectedId)
  const connections = candidates.filter((c) => c.is_connection)
  const others = candidates.filter((c) => !c.is_connection)

  async function handleRequest() {
    if (!selected) return
    setError(null)
    setSending(true)
    try {
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
      const requestId = await createValidationRequest({
        skillId: skill.id,
        requesterId: user.id,
        validatorId: selected.validator_id,
        targetLevel,
      })
      const contact = await getValidationRequestContact(requestId)
      if (contact?.email) {
        await sendValidationRequestEmail({
          toEmail: contact.email,
          requesterName: profile?.full_name || user.email,
          skillName: skill.name,
          reviewUrl: `${window.location.origin}/validate-request/${requestId}`,
        })
      }
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="request-validation-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="request-validation-dialog-title" className="font-display text-2xl text-ink mb-1">{t('modals.requestValidation.title')}</h2>
        <p className="text-sm text-secondary mb-4">
          {t('modals.requestValidation.subtitle', { skillName: skill.name, level: LEVEL_LABELS[targetLevel] })}
        </p>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-ink">
              {t('modals.requestValidation.sentMessage', { name: selected?.full_name })}
            </p>
            <button
              type="button"
              onClick={onRequested}
              className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90"
            >
              {t('modals.requestValidation.done')}
            </button>
          </div>
        ) : (
          <>
            {loading && <p className="text-sm text-secondary">{t('modals.requestValidation.finding')}</p>}

            {!loading && candidates.length === 0 && !error && (
              <p className="text-sm text-secondary mb-4">
                {t('modals.requestValidation.noOneAvailable')}
              </p>
            )}

            {!loading && candidates.length > 0 && (
              <div className="space-y-4 mb-4">
                {connections.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">
                      {t('modals.requestValidation.yourConnections')}
                    </p>
                    <div className="space-y-1">
                      {connections.map((c) => (
                        <CandidateRow
                          key={c.validator_id}
                          candidate={c}
                          selected={selectedId === c.validator_id}
                          onSelect={() => setSelectedId(c.validator_id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {others.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">
                      {t('modals.requestValidation.otherMembers')}
                    </p>
                    <div className="space-y-1">
                      {others.map((c) => (
                        <CandidateRow
                          key={c.validator_id}
                          candidate={c}
                          selected={selectedId === c.validator_id}
                          onSelect={() => setSelectedId(c.validator_id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {selected && (
              <p className="text-xs text-secondary mb-4">
                {t('modals.requestValidation.accessNotice', { name: selected.full_name })}
              </p>
            )}

            {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRequest}
                disabled={!selected || sending}
                className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {sending ? t('modals.requestValidation.sending') : t('modals.requestValidation.sendRequest')}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
              >
                {t('modals.requestValidation.cancel')}
              </button>
            </div>
          </>
        )}
    </AccessibleDialog>
  )
}

function CandidateRow({ candidate, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
        selected ? 'border-moss bg-moss/10' : 'border-hairline hover:bg-paper'
      }`}
    >
      {candidate.avatar_url ? (
        <img src={candidate.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-hairline shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink font-medium truncate">{candidate.full_name}</p>
        <p className="text-xs text-secondary">{LEVEL_LABELS[candidate.level]}</p>
      </div>
    </button>
  )
}
