import { useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import AccessibleDialog from '../../components/AccessibleDialog'
import { listCourseCohorts, createCourseCohort, updateCourseCohort, deleteCourseCohort, addCohortSession, updateCohortSession, deleteCohortSession, listCohortTrainers, setCohortTrainers, listOrganisationTrainerCandidates, cohortDisplayName, formatCohortDateRange } from '../../lib/courseCatalogue'
import { createGoogleMeet, getGoogleConnection, getSessionAttendanceReview, listGoogleMeetDetails, startGoogleMeetConnection, syncGoogleMeetAttendance } from '../../lib/googleMeet'

// Shared by the course-level trainer list (CourseTrainers) and each
// cohort's own trainer list (inside CohortForm) -- a trainer is always
// picked from the course's own organisation members (course_trainers/
// course_cohort_trainers, 20260907230000), never free text, so both are
// just this same checkbox-list-of-candidates shape at a different scope.
export function TrainerPicker({ candidates, selectedIds, onToggle, disabled }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-secondary">No organisation members to choose from yet.</p>
  }
  return (
    <div className="max-h-40 overflow-y-auto rounded-md border border-hairline divide-y divide-hairline">
      {candidates.map((candidate) => (
        <label key={candidate.userId} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={selectedIds.has(candidate.userId)}
            disabled={disabled}
            onChange={() => onToggle(candidate.userId)}
            className="rounded border-hairline accent-moss"
          />
          {candidate.name}
        </label>
      ))}
    </div>
  )
}

function formatSessionDateTime(startsAt, endsAt) {
  const start = new Date(startsAt)
  const datePart = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (!endsAt) return `${datePart} · ${startTime}`
  const end = new Date(endsAt)
  const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${datePart} · ${startTime}–${endTime}`
}

// Scheduled runs of this course (cohorts), each with its own live sessions
// -- purely additive on top of the plain catalogue enrolment every other
// tab still governs; a course with no cohorts here is completely unaffected
// elsewhere. Deliberately usable regardless of the course's own
// draft/approved status (unlike the Content tab's canEdit, which is
// draft/rejected-only) -- a cohort is a scheduled run *of* an
// already-published course, so this has to keep working once the course is
// live, not just while it's still being drafted. canManage mirrors this
// page's own org-membership bar (myRole), matching how course editing
// itself is authorized -- not a stricter admin-only gate.
export function CourseCohorts({ courseCatalogueId, organisationId, canManage }) {
  const [cohorts, setCohorts] = useState([])
  const [trainerCandidates, setTrainerCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAddCohort, setShowAddCohort] = useState(false)
  const [editingCohortId, setEditingCohortId] = useState(null)
  const [addingSessionTo, setAddingSessionTo] = useState(null)
  const [editingSessionId, setEditingSessionId] = useState(null)
  const [deletingCohort, setDeletingCohort] = useState(null)
  const [deletingSession, setDeletingSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [googleConnection, setGoogleConnection] = useState(null)
  const [meetings, setMeetings] = useState(new Map())
  const [meetingBusyId, setMeetingBusyId] = useState(null)
  const [attendanceReviews, setAttendanceReviews] = useState(new Map())

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [courseCatalogueId, organisationId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cohortRows, candidateRows, connection] = await Promise.all([
        listCourseCohorts(courseCatalogueId),
        organisationId ? listOrganisationTrainerCandidates(organisationId) : Promise.resolve([]),
        getGoogleConnection(),
      ])
      // Sessions come back nested from listCourseCohorts' own join;
      // trainers can't (see namesByUserId's comment in courseCatalogue.js),
      // so each cohort's list is fetched alongside it here.
      const trainersByCohort = await Promise.all(cohortRows.map((c) => listCohortTrainers(c.id)))
      setCohorts(cohortRows.map((c, i) => ({ ...c, trainers: trainersByCohort[i] })))
      setTrainerCandidates(candidateRows)
      setGoogleConnection(connection)
      setMeetings(await listGoogleMeetDetails(cohortRows.flatMap((cohort) => cohort.sessions.map((session) => session.id))))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleConnectGoogle() {
    setError(null)
    try {
      await startGoogleMeetConnection(`${window.location.pathname}${window.location.search}`)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleCreateGoogleMeet(sessionId) {
    setMeetingBusyId(sessionId)
    setError(null)
    try {
      await createGoogleMeet(sessionId)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setMeetingBusyId(null)
    }
  }

  async function loadAttendanceReview(sessionId) {
    const review = await getSessionAttendanceReview(sessionId)
    setAttendanceReviews((current) => new Map(current).set(sessionId, review))
  }

  async function handleToggleAttendance(sessionId) {
    if (attendanceReviews.has(sessionId)) {
      setAttendanceReviews((current) => {
        const next = new Map(current)
        next.delete(sessionId)
        return next
      })
      return
    }
    setMeetingBusyId(sessionId)
    setError(null)
    try {
      await loadAttendanceReview(sessionId)
    } catch (err) {
      setError(err.message)
    } finally {
      setMeetingBusyId(null)
    }
  }

  async function handleSyncAttendance(sessionId) {
    setMeetingBusyId(sessionId)
    setError(null)
    try {
      await syncGoogleMeetAttendance(sessionId)
      await loadAttendanceReview(sessionId)
      const allSessions = cohorts.flatMap((cohort) => cohort.sessions.map((session) => session.id))
      setMeetings(await listGoogleMeetDetails(allSessions))
    } catch (err) {
      setError(err.message)
    } finally {
      setMeetingBusyId(null)
    }
  }

  async function handleAddCohort(form) {
    setBusy(true)
    setError(null)
    try {
      const created = await createCourseCohort(courseCatalogueId, form)
      // The cohort itself is already saved at this point -- a failure here
      // is reported distinctly (not as "couldn't add cohort") and still
      // closes/reloads, so the provider doesn't retry the whole form and
      // end up with a duplicate cohort.
      if (form.trainerIds?.length > 0) {
        try {
          await setCohortTrainers(created.id, form.trainerIds)
        } catch (err) {
          setError(`Cohort added, but its trainer list couldn't be saved: ${err.message}`)
        }
      }
      setShowAddCohort(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdateCohort(cohortId, form) {
    setBusy(true)
    setError(null)
    try {
      await updateCourseCohort(cohortId, form)
      setEditingCohortId(null)
      try {
        await setCohortTrainers(cohortId, form.trainerIds ?? [])
      } catch (err) {
        setError(`Cohort saved, but its trainer list couldn't be saved: ${err.message}`)
      }
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteCohort() {
    setBusy(true)
    setError(null)
    try {
      await deleteCourseCohort(deletingCohort.id)
      setDeletingCohort(null)
      await load()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleAddSession(cohortId, form) {
    setBusy(true)
    setError(null)
    try {
      await addCohortSession(cohortId, form)
      setAddingSessionTo(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdateSession(sessionId, form) {
    setBusy(true)
    setError(null)
    try {
      await updateCohortSession(sessionId, form)
      setEditingSessionId(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSession() {
    setBusy(true)
    setError(null)
    try {
      await deleteCohortSession(deletingSession.id)
      setDeletingSession(null)
      await load()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (loading) return <p className="text-secondary">Loading cohorts…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-lg text-ink">Cohorts</h3>
          <p className="text-sm text-secondary mt-1">
            Specific scheduled runs of this course (e.g. "Jan 2026 intake") that a learner can enrol into directly,
            each with its own live sessions.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAddCohort(true)}
            className="shrink-0 rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
          >
            + Add cohort
          </button>
        )}
      </div>

      {canManage && (
        <div className="flex flex-col gap-2 border-y border-hairline py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Google Meet</p>
            <p className="text-xs text-secondary">
              {googleConnection?.status === 'active'
                ? 'Connected. You can create meetings and import attendance for scheduled sessions.'
                : googleConnection
                  ? 'Reconnect the Google account that organises these meetings.'
                  : 'Connect the Google account that will organise these meetings.'}
            </p>
          </div>
          {googleConnection?.status !== 'active' && (
            <button type="button" onClick={handleConnectGoogle} className="shrink-0 rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper">
              {googleConnection ? 'Reconnect Google' : 'Connect Google'}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {cohorts.length === 0 ? (
        <div className="text-center py-8 px-3 border border-dashed border-hairline rounded-lg">
          <p className="text-xs text-secondary">
            {canManage
              ? 'No cohorts yet — learners enrol into this course directly. Add a cohort to offer specific scheduled runs instead.'
              : 'No cohorts have been scheduled for this course.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {cohorts.map((cohort) => (
            <div key={cohort.id} className="bg-card border border-hairline rounded-lg p-4">
              {editingCohortId === cohort.id ? (
                <CohortForm
                  initial={cohort}
                  candidates={trainerCandidates}
                  busy={busy}
                  submitLabel="Save"
                  onSubmit={(form) => handleUpdateCohort(cohort.id, form)}
                  onCancel={() => setEditingCohortId(null)}
                  showEnrolmentToggle
                />
              ) : (
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-display text-base text-ink">{cohortDisplayName(cohort)}</h4>
                      {!cohort.enrolment_open && (
                        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
                          Enrolment closed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary mt-1">
                      {formatCohortDateRange(cohort.start_date, cohort.end_date)}
                      {' · '}
                      {cohort.capacity == null
                        ? `${cohort.enrolledCount} enrolled`
                        : `${cohort.seatsRemaining} of ${cohort.capacity} seats remaining`}
                    </p>
                    {cohort.location && <p className="text-xs text-secondary mt-0.5">{cohort.location}</p>}
                    {cohort.trainers?.length > 0 && (
                      <p className="text-xs text-secondary mt-0.5">
                        Trainers: {cohort.trainers.map((t) => t.name).join(', ')}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingCohortId(cohort.id)}
                        className="text-sm text-moss font-medium hover:opacity-80"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingCohort(cohort)}
                        className="text-sm text-red-700 font-medium hover:opacity-80"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-hairline">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Sessions</p>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setAddingSessionTo(cohort.id)}
                      className="font-mono text-[10px] uppercase tracking-wide text-moss hover:opacity-80"
                    >
                      + Add session
                    </button>
                  )}
                </div>

                {cohort.sessions.length === 0 && addingSessionTo !== cohort.id ? (
                  <p className="text-xs text-secondary">No sessions scheduled yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {cohort.sessions.map((session) =>
                      editingSessionId === session.id ? (
                        <li key={session.id}>
                          <SessionForm
                            initial={session}
                            busy={busy}
                            submitLabel="Save"
                            onSubmit={(form) => handleUpdateSession(session.id, form)}
                            onCancel={() => setEditingSessionId(null)}
                          />
                        </li>
                      ) : (
                        <li key={session.id} className="border-b border-hairline pb-3 last:border-b-0 last:pb-0">
                          <div className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="text-ink">
                              {session.title ? `${session.title} · ` : ''}
                              {formatSessionDateTime(session.starts_at, session.ends_at)}
                            </p>
                            {meetings.get(session.id) ? (
                              <a href={meetings.get(session.id).meeting_uri} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-moss underline decoration-hairline underline-offset-4 hover:decoration-current">
                                Open Google Meet <span className="sr-only">(opens in a new tab)</span>
                              </a>
                            ) : session.location_or_link && (
                              <p className="text-xs text-secondary mt-0.5 break-words">{session.location_or_link}</p>
                            )}
                            {canManage && googleConnection?.status === 'active' && !meetings.has(session.id) && !session.ends_at && (
                              <p className="mt-1 text-xs text-secondary">Add an end time to create a tracked Google Meet.</p>
                            )}
                          </div>
                          {canManage && (
                            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 shrink-0">
                              {meetings.get(session.id) ? (
                                <>
                                  <button type="button" disabled={meetingBusyId === session.id} onClick={() => handleSyncAttendance(session.id)} className="text-xs text-moss font-medium hover:opacity-80 disabled:opacity-50">
                                    {meetingBusyId === session.id ? 'Refreshing…' : 'Refresh attendance'}
                                  </button>
                                  <button type="button" disabled={meetingBusyId === session.id} onClick={() => handleToggleAttendance(session.id)} className="text-xs text-moss font-medium hover:opacity-80 disabled:opacity-50">
                                    {attendanceReviews.has(session.id) ? 'Hide attendance' : 'View attendance'}
                                  </button>
                                </>
                              ) : googleConnection?.status === 'active' && session.ends_at ? (
                                <button type="button" disabled={meetingBusyId === session.id} onClick={() => handleCreateGoogleMeet(session.id)} className="text-xs text-moss font-medium hover:opacity-80 disabled:opacity-50">
                                  {meetingBusyId === session.id ? 'Creating…' : 'Create Google Meet'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setEditingSessionId(session.id)}
                                className="text-xs text-moss font-medium hover:opacity-80"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingSession(session)}
                                className="text-xs text-red-700 font-medium hover:opacity-80"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                          </div>
                          {attendanceReviews.has(session.id) && (
                            <AttendanceReview review={attendanceReviews.get(session.id)} />
                          )}
                        </li>
                      )
                    )}
                  </ul>
                )}

                {addingSessionTo === cohort.id && (
                  <div className="mt-2">
                    <SessionForm
                      busy={busy}
                      submitLabel="Add session"
                      onSubmit={(form) => handleAddSession(cohort.id, form)}
                      onCancel={() => setAddingSessionTo(null)}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddCohort && (
        <AccessibleDialog
          labelledBy="add-cohort-dialog-title"
          onClose={() => setShowAddCohort(false)}
          panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
        >
          <h2 id="add-cohort-dialog-title" className="font-display text-xl text-ink mb-4">
            Add cohort
          </h2>
          <CohortForm candidates={trainerCandidates} busy={busy} submitLabel="Add cohort" onSubmit={handleAddCohort} onCancel={() => setShowAddCohort(false)} />
        </AccessibleDialog>
      )}

      {deletingCohort && (
        <ConfirmDialog
          message={`Delete the "${cohortDisplayName(deletingCohort)}" cohort and its sessions? Learners already enrolled keep their course record, just no longer linked to this specific cohort.`}
          confirmLabel="Delete cohort"
          confirming={busy}
          onConfirm={handleDeleteCohort}
          onCancel={() => setDeletingCohort(null)}
        />
      )}

      {deletingSession && (
        <ConfirmDialog
          message="Delete this session?"
          confirmLabel="Delete session"
          confirming={busy}
          onConfirm={handleDeleteSession}
          onCancel={() => setDeletingSession(null)}
        />
      )}
    </div>
  )
}

function formatAttendanceDuration(seconds) {
  const minutes = Math.round(Number(seconds ?? 0) / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`
}

function AttendanceReview({ review }) {
  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <h5 className="text-sm font-medium text-ink">Learner attendance</h5>
      {review.learners.length === 0 ? (
        <p className="mt-1 text-xs text-secondary">No attendance has been imported yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-secondary">
                <th scope="col" className="py-2 pr-4 font-medium">Learner</th>
                <th scope="col" className="py-2 pr-4 font-medium">Attendance</th>
                <th scope="col" className="py-2 pr-4 font-medium">Time present</th>
                <th scope="col" className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {review.learners.map((learner) => (
                <tr key={learner.user_id} className="border-b border-hairline last:border-b-0">
                  <td className="py-2 pr-4 text-ink">{learner.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums text-ink">{Number(learner.attendance_percent).toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-secondary">{formatAttendanceDuration(learner.attended_seconds)}</td>
                  <td className="py-2 text-secondary">{learner.calculation_status === 'final' ? 'Final' : 'Provisional'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {review.unresolved.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-xs font-medium text-ink">Needs matching</p>
          <p className="mt-0.5 text-xs text-secondary">These attendees joined anonymously or by telephone and could not be matched automatically.</p>
          <ul className="mt-1 text-xs text-secondary">
            {review.unresolved.map((participant) => <li key={participant.google_participant_name}>{participant.display_name}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function CohortForm({ initial, candidates = [], busy, submitLabel, onSubmit, onCancel, showEnrolmentToggle }) {
  const [name, setName] = useState(initial?.name ?? '')
  const initialStart = splitLocalValue(toLocalInputValue(initial?.start_date))
  const initialEnd = splitLocalValue(toLocalInputValue(initial?.end_date))
  const [startDate, setStartDate] = useState(initialStart.date)
  const [startTime, setStartTime] = useState(initialStart.time)
  const [endDate, setEndDate] = useState(initialEnd.date)
  const [endTime, setEndTime] = useState(initialEnd.time)
  const [capacity, setCapacity] = useState(initial?.capacity ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [enrolmentOpen, setEnrolmentOpen] = useState(initial?.enrolment_open ?? true)
  const [trainerIds, setTrainerIds] = useState(new Set((initial?.trainers ?? []).map((t) => t.userId)))

  function toggleTrainer(userId) {
    setTrainerIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({
      name,
      startDate: toIsoOrNull(combineDateAndTime(startDate, startTime)),
      endDate: toIsoOrNull(combineDateAndTime(endDate, endTime)),
      capacity, location, enrolmentOpen, trainerIds: [...trainerIds],
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs text-secondary mb-1" htmlFor="cohortName">
          Cohort name (optional)
        </label>
        <input
          id="cohortName"
          data-dialog-initial-focus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jan 2026 intake"
          className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="cohortStartDate">
            Starts
          </label>
          <div className="flex gap-2">
            <input
              id="cohortStartDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <input
              type="time"
              aria-label="Start time (optional)"
              value={startTime}
              disabled={!startDate}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60"
            />
          </div>
          <p className="text-xs text-secondary mt-1">Time is optional.</p>
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="cohortEndDate">
            Ends
          </label>
          <div className="flex gap-2">
            <input
              id="cohortEndDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <input
              type="time"
              aria-label="End time (optional)"
              value={endTime}
              disabled={!endDate}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60"
            />
          </div>
          <p className="text-xs text-secondary mt-1">Time is optional.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="cohortCapacity">
            Capacity
          </label>
          <input
            id="cohortCapacity"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={capacity ?? ''}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Unlimited"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor="cohortLocation">
            Location
          </label>
          <input
            id="cohortLocation"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. a city, room, or meeting URL"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
      </div>
      <div>
        <span className="block text-xs text-secondary mb-1">Trainers</span>
        <TrainerPicker candidates={candidates} selectedIds={trainerIds} onToggle={toggleTrainer} disabled={busy} />
      </div>
      {showEnrolmentToggle && (
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={enrolmentOpen}
            onChange={(e) => setEnrolmentOpen(e.target.checked)}
            className="h-4 w-4 accent-moss"
          />
          Open for enrolment
        </label>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-md bg-moss text-paper py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// Datetime-local inputs work in the browser's own local timezone and
// produce a value with no offset (e.g. "2026-01-12T09:00") -- `new
// Date(...)` parses that as local time, and toISOString() below then
// converts it to the UTC instant Postgres' timestamptz column expects, same
// as any other local-time-entry-to-UTC-storage flow in this app.
function toIsoOrNull(localValue) {
  if (!localValue) return null
  return new Date(localValue).toISOString()
}

function toLocalInputValue(isoValue) {
  if (!isoValue) return ''
  const d = new Date(isoValue)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Splits a toLocalInputValue()-shaped string into its date and time parts
// for CohortForm's separate date/time inputs -- a cohort's own start/end can
// be entered as just a date (see that form's own comment), unlike a
// session's, which always needs a specific time. A midnight time is treated
// as "none entered" here too, so re-opening a date-only cohort to edit it
// doesn't show a misleading 00:00 in the time field.
function splitLocalValue(localValue) {
  if (!localValue) return { date: '', time: '' }
  const [date, time] = localValue.split('T')
  return { date, time: time === '00:00' ? '' : time }
}

// The inverse: combines CohortForm's separate date/time inputs back into
// the local-datetime shape toIsoOrNull expects, defaulting a blank time to
// midnight -- the same "date-only" stand-in formatCohortDateRange already
// knows to display without a time (src/lib/courseCatalogue.js).
function combineDateAndTime(date, time) {
  return date ? `${date}T${time || '00:00'}` : ''
}

function SessionForm({ initial, busy, submitLabel, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInputValue(initial?.starts_at))
  const [endsAt, setEndsAt] = useState(toLocalInputValue(initial?.ends_at))
  const [locationOrLink, setLocationOrLink] = useState(initial?.location_or_link ?? '')

  function handleSubmit(e) {
    e.preventDefault()
    if (!startsAt) return
    onSubmit({
      title,
      startsAt: toIsoOrNull(startsAt),
      endsAt: toIsoOrNull(endsAt),
      locationOrLink,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-hairline bg-paper p-3 space-y-2">
      <div>
        <label className="block text-xs text-secondary mb-1" htmlFor={`session-title-${initial?.id ?? 'new'}`}>
          Session title (optional)
        </label>
        <input
          id={`session-title-${initial?.id ?? 'new'}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Week 1: Introduction"
          className="w-full rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor={`session-starts-${initial?.id ?? 'new'}`}>
            Starts
          </label>
          <input
            id={`session-starts-${initial?.id ?? 'new'}`}
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1" htmlFor={`session-ends-${initial?.id ?? 'new'}`}>
            Ends (optional)
          </label>
          <input
            id={`session-ends-${initial?.id ?? 'new'}`}
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="w-full rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-secondary mb-1" htmlFor={`session-location-${initial?.id ?? 'new'}`}>
          Location or meeting link (optional)
        </label>
        <input
          id={`session-location-${initial?.id ?? 'new'}`}
          value={locationOrLink}
          onChange={(e) => setLocationOrLink(e.target.value)}
          placeholder="e.g. https://... or Room 204"
          className="w-full rounded-md border border-hairline bg-card px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !startsAt}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
