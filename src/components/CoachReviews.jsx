import { useEffect, useId, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import PersonAvatar from './PersonAvatar'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { deleteCoachReview, listCoachReviews, reportCoachReview, saveCoachReview } from '../lib/coaching'
import { REPORT_REASONS } from '../lib/skillResources'

// Reviews of a coach (0337): stars, the learner's own review of their coach,
// and the reviews others can read.

export function Stars({ rating }) {
  const { t } = useLanguage()
  const whole = Math.round(rating)
  return (
    <span role="img" aria-label={t('skillDetail.coaching.reviews.starsLabel', { rating })} className="whitespace-nowrap text-gold">
      {'★'.repeat(whole)}
      <span className="text-hairline">{'★'.repeat(5 - whole)}</span>
    </span>
  )
}

// "★★★★☆ 4.2 · 3 reviews"
export function RatingSummary({ average, count }) {
  const { t } = useLanguage()
  return (
    <span className="inline-flex items-center gap-1 text-xs text-secondary">
      <Stars rating={Number(average)} />
      <span>{Number(average).toFixed(1)} · {count === 1 ? t('skillDetail.coaching.reviews.oneReview') : t('skillDetail.coaching.reviews.reviewCount', { count })}</span>
    </span>
  )
}

// The learner's review of their coach: write it once a session has been
// marked done, then change or delete it. It's named, which they're told
// before saving. review: their saved review, if any; canReview: at least
// one session is done.
export function MyCoachReview({ relationship, review, canReview, onChange }) {
  const { t } = useLanguage()
  const k = (key, params) => t(`skillDetail.coaching.reviews.${key}`, params)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!review && !canReview) return null

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChange()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 ml-8 border-l border-hairline/60 pl-3">
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {editing ? (
        <ReviewForm
          name={relationship.other_name}
          review={review}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (rating, comment) => {
            if (await run(() => saveCoachReview(relationship.id, rating, comment))) setEditing(false)
          }}
        />
      ) : review ? (
        <div className="text-xs">
          <p className="text-secondary">{k('yourReview')}</p>
          <p className="mt-0.5"><Stars rating={review.rating} /></p>
          {review.comment && <p className="mt-0.5 whitespace-pre-wrap text-ink">{review.comment}</p>}
          {/* Removed by moderators (0338): only its author sees it, and it
              can be deleted but not changed back into view. */}
          {review.moderation_removed_at && <p className="mt-1 text-red-700">{k('removedByModerators')}</p>}
          <div className="mt-1 flex gap-3">
            {!review.moderation_removed_at && (
              <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-moss hover:underline">{k('change')}</button>
            )}
            <button type="button" onClick={() => setDeleting(true)} disabled={busy} className="text-xs font-medium text-moss hover:underline disabled:opacity-60">{k('delete')}</button>
          </div>
        </div>
      ) : relationship.review_removed ? (
        // Moderators removed their review of this coaching, which they've
        // since deleted: it can't be reviewed again (0338).
        <p className="text-xs text-secondary">{k('cantReviewAgain')}</p>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-moss hover:underline">
          {k('write', { name: relationship.other_name })}
        </button>
      )}
      {deleting && (
        <ConfirmDialog
          message={k('confirmDelete')}
          confirming={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await run(() => deleteCoachReview(relationship.id))
            setDeleting(false)
          }}
        />
      )}
    </div>
  )
}

function ReviewForm({ name, review, busy, onSave, onCancel }) {
  const { t } = useLanguage()
  const k = (key, params) => t(`skillDetail.coaching.reviews.${key}`, params)
  const [rating, setRating] = useState(review?.rating ?? 0)
  const [comment, setComment] = useState(review?.comment ?? '')
  const id = useId()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (rating) onSave(rating, comment)
      }}
      className="space-y-2 rounded-md border border-hairline bg-card p-3"
    >
      <fieldset>
        <legend className="text-xs text-secondary">{k('ratingLegend', { name })}</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-rating`}
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                aria-label={value === 1 ? k('oneStar') : k('nStars', { count: value })}
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className={`text-2xl leading-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-moss ${value <= rating ? 'text-gold' : 'text-hairline'}`}
              >
                ★
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs text-secondary" htmlFor={`${id}-comment`}>
        {k('comment')}
        <textarea
          id={`${id}-comment`}
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <p className="text-xs text-secondary">{k('namedNotice')}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !rating} className="rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60">
          {k('save')}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink">
          {k('cancel')}
        </button>
      </div>
    </form>
  )
}

// A coach's reviews on a skill, newest first, each under the reviewer's name.
export function CoachReviewList({ coachId, librarySkillId, emptyText = null }) {
  const { t } = useLanguage()
  const [reviews, setReviews] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    listCoachReviews(coachId, librarySkillId)
      .then((rows) => !cancelled && setReviews(rows))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [coachId, librarySkillId])

  if (error) return <p role="alert" className="text-xs text-red-700">{error}</p>
  if (reviews === null) return <p className="text-xs text-secondary">{t('common.loading')}</p>
  if (reviews.length === 0) return emptyText ? <p className="text-xs text-secondary">{emptyText}</p> : null
  return (
    <ul className="space-y-2">
      {reviews.map((review) => (
        <li key={review.id} className="flex gap-2 text-xs">
          <PersonAvatar name={review.reviewer_name} avatarUrl={review.reviewer_avatar_url} size={6} />
          <div className="min-w-0">
            <p className="text-ink">
              <span className="font-medium">{review.reviewer_name}</span>{' '}
              <Stars rating={review.rating} />{' '}
              <span className="text-secondary">{formatFullDate(review.updated_at)}</span>
            </p>
            {review.comment && <p className="mt-0.5 whitespace-pre-wrap text-ink">{review.comment}</p>}
            {!review.is_mine && (
              <ReportReview
                review={review}
                onReported={() => setReviews((rows) => rows.map((row) => (row.id === review.id ? { ...row, reported_by_me: true } : row)))}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

// Report a review to LearnScope's moderators (0338): a reason and, if they
// like, more detail. Once sent, it says so.
function ReportReview({ review, onReported }) {
  const { t } = useLanguage()
  const k = (key, params) => t(`skillDetail.coaching.reviews.${key}`, params)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const id = useId()

  if (review.reported_by_me) return <p className="mt-1 text-secondary">{k('reported')}</p>
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs text-secondary hover:text-ink hover:underline">
        {k('report')}
      </button>
    )
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!reason) {
      setError(t('skillDetail.resources.reportErrorReason'))
      return
    }
    setSending(true)
    setError(null)
    try {
      await reportCoachReview(review.id, reason, details)
      onReported()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSend} className="mt-2 space-y-2 rounded-md border border-hairline bg-card p-3">
      <fieldset>
        <legend className="text-xs font-medium text-ink">{k('reportTitle')}</legend>
        <p className="text-xs text-secondary">{k('reportHint')}</p>
        <div className="mt-1 space-y-1">
          {REPORT_REASONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-xs text-ink">
              <input type="radio" name={`${id}-reason`} value={option} checked={reason === option} onChange={() => setReason(option)} />
              {t(`skillDetail.resources.reportReasons.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs text-secondary" htmlFor={`${id}-details`}>
        {t('skillDetail.resources.reportDetailsLabel')}
        <textarea
          id={`${id}-details`}
          rows={2}
          maxLength={1000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={sending} className="rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-60">
          {t('skillDetail.resources.reportSend')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink">
          {k('cancel')}
        </button>
      </div>
    </form>
  )
}
