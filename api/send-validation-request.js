import { verifySupabaseUser } from './_lib/auth.js'

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

  const { toEmail, requesterName, skillName, reviewUrl } = req.body ?? {}
  if (!toEmail || !skillName || !reviewUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or reviewUrl' })
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Email sending is not configured.' })
    return
  }

  const fromName = requesterName?.trim() || 'A LearnScope user'
  const html = `
    <p>${escapeHtml(fromName)} has asked you to validate their skill <strong>${escapeHtml(skillName)}</strong> on LearnScope.</p>
    <p>You'll be able to review their evidence for this skill and confirm whether they've reached their target level, or decline with feedback.</p>
    <p><a href="${escapeHtml(reviewUrl)}">Review the request</a></p>
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
        subject: `${fromName} asked you to validate "${skillName}"`,
        html,
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('send-validation-request: Resend error', resendRes.status, detail)
      res.status(502).json({ error: 'Failed to send email.' })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('send-validation-request error:', err)
    res.status(500).json({ error: 'Failed to send email.' })
  }
}
