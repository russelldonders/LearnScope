async function verifySupabaseUser(accessToken) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) return null
  return res.json()
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return
  }

  const user = await verifySupabaseUser(authHeader.slice(7))
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  const { toEmail, inviterName, skillName, shareUrl } = req.body ?? {}
  if (!toEmail || !skillName || !shareUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or shareUrl' })
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Email sending is not configured.' })
    return
  }

  const fromName = inviterName?.trim() || 'A LearnScope user'
  const html = `
    <p>${escapeHtml(fromName)} would like your take on their skill <strong>${escapeHtml(skillName)}</strong> on LearnScope.</p>
    <p><a href="${escapeHtml(shareUrl)}">Rate ${escapeHtml(skillName)}</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LearnScope <onboarding@resend.dev>',
        to: toEmail,
        subject: `${fromName} wants your rating on "${skillName}"`,
        html,
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('send-invite: Resend error', resendRes.status, detail)
      res.status(502).json({ error: 'Failed to send email.' })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('send-invite error:', err)
    res.status(500).json({ error: 'Failed to send email.' })
  }
}
