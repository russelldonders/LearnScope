import { supabaseAdmin } from './supabaseAdmin.js'

const DAY = 24 * 60 * 60

// Generous per-user caps -- well above what normal use of each feature
// needs, low enough that one account can't loop an endpoint for cost or
// spam. 'ai' is shared by every Anthropic-backed feature except CV parsing,
// which is far heavier per call and gets its own smaller bucket.
export const QUOTAS = {
  ai: { limit: 300, windowSeconds: DAY },
  cv: { limit: 20, windowSeconds: DAY },
  email: { limit: 100, windowSeconds: DAY },
  invite: { limit: 100, windowSeconds: DAY },
}

// Records one use and returns whether the caller is still within their cap.
// Fails open (logged) if the quota check itself errors, so a database hiccup
// never blocks a learner from a feature -- the cap is abuse protection, not
// a billing boundary.
export async function consumeQuota(userId, bucket) {
  const quota = QUOTAS[bucket]
  try {
    const { data, error } = await supabaseAdmin().rpc('consume_api_quota', {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: quota.limit,
      p_window_seconds: quota.windowSeconds,
    })
    if (error) throw error
    return data !== false
  } catch (err) {
    console.error(`quota check (${bucket}) failed:`, err)
    return true
  }
}

export function sendQuotaExceeded(res) {
  res.status(429).json({ error: "You've reached today's limit for this feature. Please try again tomorrow." })
}
