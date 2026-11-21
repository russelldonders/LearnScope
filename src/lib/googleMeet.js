import { supabase } from './supabaseClient'

const GOOGLE_SCOPE = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/meetings.space.created',
].join(' ')

const OAUTH_STATE_KEY = 'googleMeetOAuthState'
const OAUTH_VERIFIER_KEY = 'googleMeetOAuthVerifier'
const OAUTH_RETURN_KEY = 'googleMeetOAuthReturnTo'

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function redirectUri() {
  return `${window.location.origin}/google-meet/callback`
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to continue.')
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
}

async function api(action, body) {
  const res = await fetch(`/api/google-meet/${action}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body ?? {}),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(payload.error || 'Google Meet request failed.')
    error.connectionRequired = Boolean(payload.connectionRequired)
    error.reauthRequired = Boolean(payload.reauthRequired)
    throw error
  }
  return payload
}

export async function startGoogleMeetConnection(returnTo) {
  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) throw new Error('Google Meet is not configured for this environment.')
  const state = randomToken()
  const verifier = randomToken(64)
  sessionStorage.setItem(OAUTH_STATE_KEY, state)
  sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier)
  sessionStorage.setItem(OAUTH_RETURN_KEY, returnTo || '/')

  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  })
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

export function readGoogleMeetOAuthReturn() {
  return sessionStorage.getItem(OAUTH_RETURN_KEY) || '/'
}

export async function completeGoogleMeetConnection({ code, state }) {
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY)
  const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY)
  if (!state || state !== expectedState || !verifier) throw new Error('Could not verify the Google connection request.')
  try {
    return await api('connect', { code, codeVerifier: verifier, redirectUri: redirectUri() })
  } finally {
    sessionStorage.removeItem(OAUTH_STATE_KEY)
    sessionStorage.removeItem(OAUTH_VERIFIER_KEY)
  }
}

export function clearGoogleMeetOAuthReturn() {
  sessionStorage.removeItem(OAUTH_RETURN_KEY)
}

export async function getGoogleConnection() {
  const { data, error } = await supabase.rpc('get_my_external_connections')
  if (error) throw error
  return (data ?? []).find((row) => row.provider === 'google') ?? null
}

export async function createGoogleMeet(sessionId) {
  return api('create-space', { sessionId })
}

export async function syncGoogleMeetAttendance(sessionId) {
  return api('sync-attendance', { sessionId })
}

export async function launchGoogleMeet(sessionId) {
  const { meetingUri } = await api('launch', { sessionId })
  window.location.assign(meetingUri)
}

export async function listGoogleMeetDetails(sessionIds) {
  if (!sessionIds?.length) return new Map()
  const { data, error } = await supabase
    .from('course_session_google_meet')
    .select('*')
    .in('session_id', sessionIds)
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.session_id, row]))
}

export async function listMySessionAttendance(sessionIds, userId) {
  if (!sessionIds?.length || !userId) return new Map()
  const { data, error } = await supabase
    .from('course_session_attendance')
    .select('*')
    .eq('user_id', userId)
    .in('session_id', sessionIds)
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.session_id, row]))
}

export async function getSessionAttendanceReview(sessionId) {
  const [{ data: attendance, error: attendanceError }, { data: launches, error: launchError }, { data: conferences, error: conferenceError }] = await Promise.all([
    supabase.from('course_session_attendance').select('*').eq('session_id', sessionId).order('attendance_percent', { ascending: false }),
    supabase.from('course_session_launches').select('user_id, launched_at').eq('session_id', sessionId).order('launched_at', { ascending: false }),
    supabase.from('google_meet_conferences').select('id').eq('session_id', sessionId),
  ])
  if (attendanceError) throw attendanceError
  if (launchError) throw launchError
  if (conferenceError) throw conferenceError

  const userIds = [...new Set([...(attendance ?? []).map((row) => row.user_id), ...(launches ?? []).map((row) => row.user_id)])]
  let profiles = []
  if (userIds.length > 0) {
    const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', userIds)
    if (error) throw error
    profiles = data ?? []
  }
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name || 'Learner']))
  const lastLaunch = new Map()
  for (const launch of launches ?? []) {
    if (!lastLaunch.has(launch.user_id)) lastLaunch.set(launch.user_id, launch.launched_at)
  }

  const conferenceIds = (conferences ?? []).map((row) => row.id)
  let segments = []
  if (conferenceIds.length > 0) {
    const { data, error } = await supabase
      .from('google_meet_attendance_segments')
      .select('google_participant_name, google_user_id, matched_user_id, display_name, participant_kind')
      .in('conference_id', conferenceIds)
    if (error) throw error
    segments = data ?? []
  }
  const unresolved = [...new Map(
    segments
      .filter((segment) => !segment.matched_user_id)
      .map((segment) => [segment.google_participant_name, segment])
  ).values()]

  return {
    learners: (attendance ?? []).map((row) => ({
      ...row,
      name: names.get(row.user_id) || 'Learner',
      lastLaunchAt: lastLaunch.get(row.user_id) ?? null,
    })),
    unresolved,
  }
}
