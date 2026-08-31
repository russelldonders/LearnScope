import { supabase } from './supabaseClient'

// Strava activity `type` -> a starting skill name suggestion. Deterministic
// and local rather than an LLM call (see api/suggest-tags.js for that
// pattern, which is the natural upgrade path later if this proves too
// coarse) -- Strava's own activity types are a small fixed set, so a static
// table already covers the common cases, and the learner can always
// override the suggestion before importing.
export const STRAVA_TYPE_SKILL_SUGGESTIONS = {
  Run: 'Running',
  TrailRun: 'Trail Running',
  Ride: 'Cycling',
  MountainBikeRide: 'Mountain Biking',
  GravelRide: 'Cycling',
  VirtualRide: 'Cycling',
  Swim: 'Swimming',
  Walk: 'Walking',
  Hike: 'Hiking',
  WeightTraining: 'Strength Training',
  Workout: 'Strength Training',
  Yoga: 'Yoga',
  Rowing: 'Rowing',
  VirtualRow: 'Rowing',
  AlpineSki: 'Skiing',
  NordicSki: 'Skiing',
  Snowboard: 'Snowboarding',
  Crossfit: 'Strength Training',
  Golf: 'Golf',
  Tennis: 'Tennis',
  Soccer: 'Football',
}

export function suggestedSkillNameForActivity(activity) {
  return STRAVA_TYPE_SKILL_SUGGESTIONS[activity.type] ?? null
}

const STRAVA_SCOPE = 'read,activity:read'

// Strava's client id isn't a secret -- it's embedded in the authorize URL
// the browser is sent to, the same way it appears in any OAuth app's public
// redirect. Only the client SECRET (server-side, api/strava/[...path].js)
// needs to stay hidden.
export function buildStravaAuthorizeUrl({ redirectUri, state }) {
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID
  const params = new URLSearchParams({
    client_id: clientId ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  })
  return `https://www.strava.com/oauth/authorize?${params}`
}

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
}

export async function connectStrava({ code, scope }) {
  const res = await fetch('/api/strava/connect', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ code, scope }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to connect to Strava.')
  }
  return res.json()
}

export async function syncStrava() {
  const res = await fetch('/api/strava/sync', {
    method: 'POST',
    headers: await authHeaders(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || 'Failed to sync Strava activities.')
    err.reauthRequired = Boolean(body.reauthRequired)
    throw err
  }
  return body.activities ?? []
}

export async function disconnectStrava() {
  const res = await fetch('/api/strava/disconnect', {
    method: 'POST',
    headers: await authHeaders(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to disconnect Strava.')
  }
  return res.json()
}

export async function getMyExternalConnections() {
  const { data, error } = await supabase.rpc('get_my_external_connections')
  if (error) throw error
  return data ?? []
}
