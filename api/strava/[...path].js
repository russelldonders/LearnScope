import { verifySupabaseUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// One catch-all file for the whole Strava connector (connect/sync/
// disconnect) -- same "one file, many routes" shape as api/xapi/[...path].js,
// needed to stay within Vercel's Hobby 12-function cap (see api/interview.js,
// which was merged from two files to free this slot).
//
// Tokens live only in the external_connections table, which has zero RLS
// policies granted to authenticated/anon (see the migration) -- every read
// or write of a token column here goes through supabaseAdmin() (the
// service-role client, which bypasses RLS by design), gated by verifying
// the caller's own Supabase session first. The client never sees a Strava
// access/refresh token.

const STRAVA_API = 'https://www.strava.com/api/v3'
const FIRST_SYNC_ACTIVITY_LIMIT = 30
const SYNC_ACTIVITY_LIMIT = 50

async function requireUser(req, res) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return null
  }
  const user = await verifySupabaseUser(authHeader.slice(7))
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }
  return user
}

async function handleConnect(req, res, user) {
  const { code, scope } = req.body ?? {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' })
    return
  }

  const clientId = process.env.VITE_STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'Strava is not configured.' })
    return
  }

  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    console.error('strava (connect) token exchange failed:', tokenRes.status, await tokenRes.text())
    res.status(502).json({ error: 'Failed to connect to Strava.' })
    return
  }
  const tokenData = await tokenRes.json()

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('external_connections')
    .upsert(
      {
        user_id: user.id,
        provider: 'strava',
        provider_account_id: String(tokenData.athlete?.id ?? ''),
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
        scope: typeof scope === 'string' ? scope.slice(0, 200) : null,
        status: 'active',
        connected_at: new Date().toISOString(),
        last_synced_at: null,
      },
      { onConflict: 'user_id,provider' }
    )
  if (error) throw error

  res.status(200).json({ ok: true })
}

// Strava access tokens last 6 hours; refresh ahead of expiry rather than
// waiting for a 401, so a sync never fails on an easily-avoidable stale
// token. Returns the (possibly refreshed) access token, updating the stored
// row in place when a refresh happened.
async function ensureFreshToken(admin, connection) {
  if (new Date(connection.token_expires_at) > new Date(Date.now() + 60_000)) {
    return connection.access_token
  }

  const clientId = process.env.VITE_STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  const refreshRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!refreshRes.ok) {
    await admin.from('external_connections').update({ status: 'error' }).eq('id', connection.id)
    throw new Error('reauth_required')
  }
  const refreshed = await refreshRes.json()

  const { error } = await admin
    .from('external_connections')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      status: 'active',
    })
    .eq('id', connection.id)
  if (error) throw error

  return refreshed.access_token
}

function summarizeActivity(activity) {
  return {
    id: String(activity.id),
    name: activity.name,
    type: activity.type,
    startDate: activity.start_date,
    movingTimeSeconds: activity.moving_time,
    distanceMeters: activity.distance,
  }
}

async function handleSync(req, res, user) {
  const admin = supabaseAdmin()
  const { data: connection, error: lookupError } = await admin
    .from('external_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'strava')
    .maybeSingle()
  if (lookupError) throw lookupError
  if (!connection) {
    res.status(404).json({ error: 'Strava is not connected.' })
    return
  }

  let accessToken
  try {
    accessToken = await ensureFreshToken(admin, connection)
  } catch (err) {
    if (err.message === 'reauth_required') {
      res.status(409).json({ error: 'Your Strava connection needs to be reconnected.', reauthRequired: true })
      return
    }
    throw err
  }

  const params = new URLSearchParams()
  if (connection.last_synced_at) {
    params.set('after', String(Math.floor(new Date(connection.last_synced_at).getTime() / 1000)))
    params.set('per_page', String(SYNC_ACTIVITY_LIMIT))
  } else {
    // First sync: the most recent activities only, not the athlete's whole
    // history -- keeps the review batch a manageable size for a first look.
    params.set('per_page', String(FIRST_SYNC_ACTIVITY_LIMIT))
  }

  const activitiesRes = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (activitiesRes.status === 401) {
    await admin.from('external_connections').update({ status: 'error' }).eq('id', connection.id)
    res.status(409).json({ error: 'Your Strava connection needs to be reconnected.', reauthRequired: true })
    return
  }
  if (!activitiesRes.ok) {
    console.error('strava (sync) activities fetch failed:', activitiesRes.status, await activitiesRes.text())
    res.status(502).json({ error: 'Failed to fetch activities from Strava.' })
    return
  }
  const activities = await activitiesRes.json()

  const { error: updateError } = await admin
    .from('external_connections')
    .update({ last_synced_at: new Date().toISOString(), status: 'active' })
    .eq('id', connection.id)
  if (updateError) throw updateError

  res.status(200).json({ activities: (activities ?? []).map(summarizeActivity) })
}

async function handleDisconnect(req, res, user) {
  const admin = supabaseAdmin()
  const { data: connection, error: lookupError } = await admin
    .from('external_connections')
    .select('id, access_token')
    .eq('user_id', user.id)
    .eq('provider', 'strava')
    .maybeSingle()
  if (lookupError) throw lookupError
  if (!connection) {
    res.status(200).json({ ok: true })
    return
  }

  // Best-effort: revoke on Strava's side, but a learner must still be able
  // to disconnect locally even if Strava's own revoke call fails (e.g. the
  // token was already invalidated from Strava's side).
  try {
    await fetch(`https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(connection.access_token)}`, {
      method: 'POST',
    })
  } catch (err) {
    console.error('strava (disconnect) deauthorize call failed:', err)
  }

  // Deleting the connection never touches xapi_statements already imported
  // from it -- those are the learner's own evidence now, independent of
  // whether the source is still connected (same "unlinking doesn't delete
  // the underlying record" principle as everywhere else in this app).
  const { error: deleteError } = await admin.from('external_connections').delete().eq('id', connection.id)
  if (deleteError) throw deleteError

  res.status(200).json({ ok: true })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await requireUser(req, res)
  if (!user) return

  // See api/xapi/[...path].js for why both shapes are handled -- the
  // explicit vercel.json route this project needs (course-content proxy)
  // passes req.query.path as a single slash-joined string, not an array.
  const path = Array.isArray(req.query.path)
    ? req.query.path
    : typeof req.query.path === 'string'
      ? req.query.path.split('/')
      : []
  const action = path[0]

  try {
    if (action === 'connect') {
      await handleConnect(req, res, user)
      return
    }
    if (action === 'sync') {
      await handleSync(req, res, user)
      return
    }
    if (action === 'disconnect') {
      await handleDisconnect(req, res, user)
      return
    }
    res.status(404).json({ error: 'Not found' })
  } catch (err) {
    console.error(`strava (${action}) error:`, err)
    res.status(500).json({ error: 'Strava request failed.' })
  }
}
