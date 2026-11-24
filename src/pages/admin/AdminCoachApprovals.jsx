import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatFullDate } from '../../lib/dates'
import { adminApproveCoach, adminListCoachApprovals, adminRevokeCoachApproval } from '../../lib/coaching'

// Approving someone as a coach for a skill they have (0339), on their admin
// page -- for example a professional coach vetted outside LearnScope. It
// lets them offer coaching on that skill without it being validated; others
// see them as "Approved by LearnScope". It doesn't validate the skill or
// change its level. Approving and withdrawing are logged; withdrawn
// approvals stay listed. skills: the person's skills ({ id, name,
// library_skill_id }); only library skills can be coached in.
export default function AdminCoachApprovals({ userId, skills }) {
  const [approvals, setApprovals] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [approving, setApproving] = useState(null)
  const [note, setNote] = useState('')
  const [revoking, setRevoking] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setApprovals(await adminListCoachApprovals(userId))
  }, [userId])

  useEffect(() => {
    load().catch((err) => setError(err.message))
  }, [load])

  const librarySkills = skills.filter((skill) => skill.library_skill_id)
  const activeFor = (librarySkillId) => approvals?.find((a) => a.library_skill_id === librarySkillId && !a.revoked_at) ?? null
  const withdrawn = (approvals ?? []).filter((a) => a.revoked_at)

  async function run(action, message) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setNotice(message)
      await load()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 py-3 text-sm">
      <p className="text-xs text-secondary mb-3">
        Approve this person as a coach for a skill they have, for example a professional coach you&apos;ve checked
        outside LearnScope. They can then offer coaching on it without the skill being validated, and are shown as
        &ldquo;Approved by LearnScope&rdquo;. It doesn&apos;t validate the skill or change its level.
      </p>
      {error && <p role="alert" className="text-sm text-red-700 mb-2">{error}</p>}
      {notice && <p role="status" className="text-sm text-moss mb-2">{notice}</p>}
      {approvals === null ? (
        <p className="text-secondary">Loading…</p>
      ) : librarySkills.length === 0 ? (
        <p className="text-secondary">None of their skills are in the skill library, so they can&apos;t be approved as a coach.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {librarySkills.map((skill) => {
            const active = activeFor(skill.library_skill_id)
            return (
              <li key={skill.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">{skill.name}</span>
                  {active ? (
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-moss">
                        Approved coach since {formatFullDate(active.approved_at)}{active.approved_by_label ? ` by ${active.approved_by_label}` : ''}
                      </span>
                      <button type="button" disabled={busy} onClick={() => setRevoking({ approval: active, skill })} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60">
                        Withdraw
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setApproving(approving?.id === skill.id ? null : skill)
                        setNote('')
                      }}
                      className="rounded-md border border-hairline px-3 py-1 text-xs font-medium text-ink hover:border-moss disabled:opacity-60"
                    >
                      Approve as coach
                    </button>
                  )}
                </div>
                {active?.note && <p className="mt-1 text-xs text-secondary italic">“{active.note}”</p>}
                {approving?.id === skill.id && (
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (await run(() => adminApproveCoach(userId, skill.library_skill_id, note), `Approved as a coach in ${skill.name}.`)) {
                        setApproving(null)
                      }
                    }}
                  >
                    <label className="block text-xs text-secondary" htmlFor={`approve-note-${skill.id}`}>
                      Why are they approved? (optional, seen only by admins)
                      <input
                        id={`approve-note-${skill.id}`}
                        type="text"
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy} className="rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60">
                        Approve as coach in {skill.name}
                      </button>
                      <button type="button" onClick={() => setApproving(null)} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {withdrawn.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-secondary">Withdrawn approvals</p>
          <ul className="mt-1 space-y-1">
            {withdrawn.map((a) => (
              <li key={a.id} className="text-xs text-secondary">
                {a.skill_name}: {formatFullDate(a.approved_at)} – {formatFullDate(a.revoked_at)}
                {a.revoked_by_label ? `, withdrawn by ${a.revoked_by_label}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {revoking && (
        <ConfirmDialog
          message={`Withdraw their approval as a coach in ${revoking.skill.name}? They'll stop offering coaching on it, unless the skill has been validated by someone with it. Coaching already under way carries on.`}
          confirmLabel="Withdraw approval"
          confirming={busy}
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            await run(() => adminRevokeCoachApproval(revoking.approval.id), `Approval as a coach in ${revoking.skill.name} withdrawn.`)
            setRevoking(null)
          }}
        />
      )}
    </div>
  )
}
