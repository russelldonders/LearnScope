import { participantIdentity, summarizeAttendance } from './googleMeetAttendance.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_MEET_API = 'https://meet.googleapis.com/v2'

function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = body?.error?.message || body?.error_description || 'Google Meet request failed.'
    const error = new Error(message)
    error.status = res.status
    throw error
  }
  return body
}

async function getSessionContext(admin, sessionId) {
  const { data: session, error: sessionError } = await admin
    .from('course_cohort_sessions')
    .select('id, cohort_id, title, starts_at, ends_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (sessionError) throw sessionError
  if (!session) return null

  const { data: cohort, error: cohortError } = await admin
    .from('course_cohorts')
    .select('id, course_catalogue_id')
    .eq('id', session.cohort_id)
    .single()
  if (cohortError) throw cohortError

  const { data: course, error: courseError } = await admin
    .from('course_catalogue')
    .select('id, organisation_id, name')
    .eq('id', cohort.course_catalogue_id)
    .single()
  if (courseError) throw courseError
  return { session, cohort, course }
}

async function canManageSession(admin, context, userId) {
  const [{ data: platformAdmin }, { data: membership }, { data: organisation }] = await Promise.all([
    admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    context.course.organisation_id
      ? admin
          .from('organisation_members')
          .select('id')
          .eq('organisation_id', context.course.organisation_id)
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle()
      : Promise.resolve({ data: null }),
    context.course.organisation_id
      ? admin.from('organisations').select('status').eq('id', context.course.organisation_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return Boolean(platformAdmin || (organisation?.status === 'active' && membership))
}

async function isEnrolledInSession(admin, context, userId) {
  const { data, error } = await admin
    .from('courses')
    .select('id')
    .eq('cohort_id', context.cohort.id)
    .eq('user_id', userId)
    .is('status', null)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

async function refreshGoogleToken(admin, connection) {
  if (new Date(connection.token_expires_at).getTime() > Date.now() + 60_000) return connection.access_token

  const clientId = googleClientId()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google Meet is not configured.')

  let refreshed
  try {
    refreshed = await readJson(await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refresh_token,
        grant_type: 'refresh_token',
      }),
    }))
  } catch (error) {
    await admin.from('external_connections').update({ status: 'error' }).eq('id', connection.id)
    error.reauthRequired = true
    throw error
  }

  const { error: updateError } = await admin
    .from('external_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || connection.refresh_token,
      token_expires_at: new Date(Date.now() + Number(refreshed.expires_in ?? 3600) * 1000).toISOString(),
      scope: refreshed.scope || connection.scope,
      status: 'active',
    })
    .eq('id', connection.id)
  if (updateError) throw updateError
  return refreshed.access_token
}

async function googleMeetFetch(path, accessToken, options = {}) {
  return readJson(await fetch(`${GOOGLE_MEET_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  }))
}

async function connectGoogle(req, res, user, admin) {
  const { code, codeVerifier, redirectUri } = req.body ?? {}
  if (![code, codeVerifier, redirectUri].every((value) => typeof value === 'string' && value.length > 0)) {
    res.status(400).json({ error: 'Missing Google authorization details.' })
    return
  }

  const clientId = googleClientId()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Google Meet is not configured.' })
    return
  }

  const token = await readJson(await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
    }),
  }))

  const profile = await readJson(await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }))
  if (!profile.sub) throw new Error('Google did not return an account identifier.')

  const { data: claimedAccount, error: claimedAccountError } = await admin
    .from('external_connections')
    .select('user_id')
    .eq('provider', 'google')
    .eq('provider_account_id', profile.sub)
    .neq('user_id', user.id)
    .maybeSingle()
  if (claimedAccountError) throw claimedAccountError
  if (claimedAccount) {
    res.status(409).json({ error: 'This Google account is already connected to another LearnScope account.' })
    return
  }

  const { data: existing, error: existingError } = await admin
    .from('external_connections')
    .select('refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle()
  if (existingError) throw existingError
  const refreshToken = token.refresh_token || existing?.refresh_token
  if (!refreshToken) {
    res.status(409).json({ error: 'Google did not grant offline access. Reconnect and approve access again.' })
    return
  }

  const { error } = await admin.from('external_connections').upsert({
    user_id: user.id,
    provider: 'google',
    provider_account_id: profile.sub,
    access_token: token.access_token,
    refresh_token: refreshToken,
    token_expires_at: new Date(Date.now() + Number(token.expires_in ?? 3600) * 1000).toISOString(),
    scope: token.scope || 'openid email profile https://www.googleapis.com/auth/meetings.space.created',
    status: 'active',
    connected_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })
  if (error) throw error
  res.status(200).json({ ok: true, email: profile.email ?? null })
}

async function createSpace(req, res, user, admin) {
  const { sessionId } = req.body ?? {}
  const context = await getSessionContext(admin, sessionId)
  if (!context) {
    res.status(404).json({ error: 'Course session not found.' })
    return
  }
  if (!(await canManageSession(admin, context, user.id))) {
    res.status(403).json({ error: 'You cannot manage this course session.' })
    return
  }
  if (!context.session.ends_at || new Date(context.session.ends_at) <= new Date(context.session.starts_at)) {
    res.status(400).json({ error: 'Add a valid session end time before creating a Google Meet.' })
    return
  }

  const { data: existing, error: existingError } = await admin
    .from('course_session_google_meet')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    res.status(200).json({ meeting: existing })
    return
  }

  const { data: connection, error: connectionError } = await admin
    .from('external_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle()
  if (connectionError) throw connectionError
  if (!connection) {
    res.status(409).json({ error: 'Connect your Google account before creating a meeting.', connectionRequired: true })
    return
  }

  const accessToken = await refreshGoogleToken(admin, connection)
  const space = await googleMeetFetch('/spaces', accessToken, { method: 'POST', body: '{}' })
  const row = {
    session_id: sessionId,
    google_space_name: space.name,
    meeting_uri: space.meetingUri,
    organizer_user_id: user.id,
    sync_status: 'ready',
    updated_at: new Date().toISOString(),
  }
  const { data: meeting, error: insertError } = await admin
    .from('course_session_google_meet')
    .insert(row)
    .select()
    .single()
  if (insertError) throw insertError
  await admin.from('course_cohort_sessions').update({ location_or_link: space.meetingUri }).eq('id', sessionId)
  res.status(200).json({ meeting })
}

async function listAll(path, field, accessToken) {
  const values = []
  let pageToken = null
  do {
    const separator = path.includes('?') ? '&' : '?'
    const pagePath = pageToken ? `${path}${separator}pageToken=${encodeURIComponent(pageToken)}` : path
    const page = await googleMeetFetch(pagePath, accessToken)
    values.push(...(page[field] ?? []))
    pageToken = page.nextPageToken ?? null
  } while (pageToken)
  return values
}

function closestConference(conferences, startsAt) {
  const scheduled = new Date(startsAt).getTime()
  return [...conferences].sort((a, b) => (
    Math.abs(new Date(a.startTime).getTime() - scheduled) - Math.abs(new Date(b.startTime).getTime() - scheduled)
  ))[0] ?? null
}

async function syncAttendance(req, res, user, admin) {
  const { sessionId } = req.body ?? {}
  const context = await getSessionContext(admin, sessionId)
  if (!context) {
    res.status(404).json({ error: 'Course session not found.' })
    return
  }
  const manager = await canManageSession(admin, context, user.id)
  const enrolled = manager ? false : await isEnrolledInSession(admin, context, user.id)
  if (!manager && (!enrolled || !context.session.ends_at || new Date(context.session.ends_at) > new Date())) {
    res.status(403).json({ error: 'Attendance can only be refreshed after your scheduled session ends.' })
    return
  }

  const { data: meeting, error: meetingError } = await admin
    .from('course_session_google_meet')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (meetingError) throw meetingError
  if (!meeting) {
    res.status(404).json({ error: 'This session does not have a Google Meet.' })
    return
  }
  if (meeting.last_synced_at && Date.now() - new Date(meeting.last_synced_at).getTime() < 60_000) {
    res.status(200).json({ ok: true, throttled: true })
    return
  }

  await admin.from('course_session_google_meet').update({ sync_status: 'syncing' }).eq('session_id', sessionId)
  try {
    const { data: connection, error: connectionError } = await admin
      .from('external_connections')
      .select('*')
      .eq('user_id', meeting.organizer_user_id)
      .eq('provider', 'google')
      .maybeSingle()
    if (connectionError) throw connectionError
    if (!connection) throw new Error('The meeting organizer needs to reconnect Google.')
    const accessToken = await refreshGoogleToken(admin, connection)

    const filter = encodeURIComponent(`space.name = "${meeting.google_space_name}"`)
    const conferences = await listAll(`/conferenceRecords?filter=${filter}&pageSize=100`, 'conferenceRecords', accessToken)
    const conference = closestConference(conferences, context.session.starts_at)
    if (!conference) {
      await admin.from('course_session_google_meet').update({ sync_status: 'ready' }).eq('session_id', sessionId)
      res.status(200).json({ ok: true, conferenceFound: false })
      return
    }

    const { data: conferenceRow, error: conferenceError } = await admin
      .from('google_meet_conferences')
      .upsert({
        session_id: sessionId,
        google_conference_name: conference.name,
        started_at: conference.startTime,
        ended_at: conference.endTime ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'google_conference_name' })
      .select()
      .single()
    if (conferenceError) throw conferenceError

    const participants = await listAll(`/${conference.name}/participants?pageSize=250`, 'participants', accessToken)
    const segments = []
    for (const participant of participants) {
      const identity = participantIdentity(participant)
      const participantSessions = await listAll(`/${participant.name}/participantSessions?pageSize=250`, 'participantSessions', accessToken)
      for (const participantSession of participantSessions) {
        segments.push({
          conference_id: conferenceRow.id,
          google_participant_name: participant.name,
          google_participant_session_name: participantSession.name,
          google_user_id: identity.googleUserId,
          display_name: identity.displayName,
          joined_at: participantSession.startTime,
          left_at: participantSession.endTime ?? null,
          participant_kind: identity.kind,
        })
      }
    }

    const googleIds = [...new Set(segments.map((segment) => segment.google_user_id).filter(Boolean))]
    let connections = []
    if (googleIds.length > 0) {
      const { data, error } = await admin
        .from('external_connections')
        .select('user_id, provider_account_id')
        .eq('provider', 'google')
        .in('provider_account_id', googleIds)
      if (error) throw error
      connections = data ?? []
    }
    const googleIdByUserId = new Map(connections.map((row) => [row.user_id, row.provider_account_id]))
    const userIdByGoogleId = new Map(connections.map((row) => [row.provider_account_id, row.user_id]))
    segments.forEach((segment) => {
      segment.matched_user_id = segment.google_user_id ? (userIdByGoogleId.get(segment.google_user_id) ?? null) : null
    })

    const { error: deleteError } = await admin
      .from('google_meet_attendance_segments')
      .delete()
      .eq('conference_id', conferenceRow.id)
    if (deleteError) throw deleteError
    if (segments.length > 0) {
      const { error: segmentError } = await admin.from('google_meet_attendance_segments').insert(segments)
      if (segmentError) throw segmentError
    }

    const { data: enrolments, error: enrolmentError } = await admin
      .from('courses')
      .select('user_id')
      .eq('cohort_id', context.cohort.id)
      .is('status', null)
    if (enrolmentError) throw enrolmentError
    const attendanceRows = [...new Set((enrolments ?? []).map((row) => row.user_id))].map((userId) => {
      const googleId = googleIdByUserId.get(userId)
      const matchedSegments = googleId ? segments.filter((segment) => segment.google_user_id === googleId) : []
      const summary = summarizeAttendance(matchedSegments, context.session.starts_at, context.session.ends_at)
      return {
        session_id: sessionId,
        user_id: userId,
        attended_seconds: summary.attendedSeconds,
        attendance_percent: summary.attendancePercent,
        first_joined_at: summary.firstJoinedAt,
        last_left_at: summary.lastLeftAt,
        calculation_status: conference.endTime ? 'final' : 'provisional',
        calculated_at: new Date().toISOString(),
      }
    })
    if (attendanceRows.length > 0) {
      const { error: attendanceError } = await admin
        .from('course_session_attendance')
        .upsert(attendanceRows, { onConflict: 'session_id,user_id' })
      if (attendanceError) throw attendanceError
    }

    const matchedGoogleIds = new Set(connections.map((row) => row.provider_account_id))
    const unresolvedParticipants = new Set(
      segments
        .filter((segment) => !segment.google_user_id || !matchedGoogleIds.has(segment.google_user_id))
        .map((segment) => segment.google_participant_name)
    ).size
    await admin.from('course_session_google_meet').update({
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('session_id', sessionId)
    res.status(200).json({
      ok: true,
      conferenceFound: true,
      final: Boolean(conference.endTime),
      learnerCount: attendanceRows.length,
      unresolvedParticipants,
    })
  } catch (error) {
    await admin.from('course_session_google_meet').update({ sync_status: 'error' }).eq('session_id', sessionId)
    throw error
  }
}

async function launchMeeting(req, res, user, admin) {
  const { sessionId } = req.body ?? {}
  const context = await getSessionContext(admin, sessionId)
  if (!context || !(await isEnrolledInSession(admin, context, user.id))) {
    res.status(403).json({ error: 'You are not enrolled in this course session.' })
    return
  }
  const { data: meeting, error } = await admin
    .from('course_session_google_meet')
    .select('meeting_uri')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw error
  if (!meeting) {
    res.status(404).json({ error: 'This session does not have a Google Meet.' })
    return
  }
  const { error: launchError } = await admin.from('course_session_launches').insert({
    session_id: sessionId,
    user_id: user.id,
  })
  if (launchError) throw launchError
  res.status(200).json({ meetingUri: meeting.meeting_uri })
}

export async function handleGoogleMeetAction(req, res, user, admin, action) {
  if (action === 'connect') return connectGoogle(req, res, user, admin)
  if (action === 'create-space') return createSpace(req, res, user, admin)
  if (action === 'sync-attendance') return syncAttendance(req, res, user, admin)
  if (action === 'launch') return launchMeeting(req, res, user, admin)
  res.status(404).json({ error: 'Not found' })
}
