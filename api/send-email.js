import { verifySupabaseUser } from './_lib/auth.js'

// Single dispatcher for the app's two Resend-backed transactional emails,
// rather than one function per email type -- Vercel's Hobby plan caps
// deployments at 12 serverless functions (see api/admin/actions.js for the
// same reasoning), and freeing a slot here is what made room for the new
// xAPI LRS endpoint. Both emails shared near-identical shape (auth check,
// escapeHtml, Resend call) before this merge.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

async function sendResendEmail(res, { to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Email sending is not configured.' })
    return false
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: 'LearnScope <onboarding@resend.dev>', to, subject, html }),
  })

  if (!resendRes.ok) {
    const detail = await resendRes.text()
    console.error('send-email: Resend error', resendRes.status, detail)
    res.status(502).json({ error: 'Failed to send email.' })
    return false
  }
  return true
}

async function sendInvite(res, { toEmail, inviterName, skillName, shareUrl }) {
  if (!toEmail || !skillName || !shareUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or shareUrl' })
    return
  }
  const fromName = inviterName?.trim() || 'A LearnScope user'
  const html = `
    <p>${escapeHtml(fromName)} would like your take on their skill <strong>${escapeHtml(skillName)}</strong> on LearnScope.</p>
    <p><a href="${escapeHtml(shareUrl)}">Rate ${escapeHtml(skillName)}</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `
  if (await sendResendEmail(res, { to: toEmail, subject: `${fromName} wants your rating on "${skillName}"`, html })) {
    res.status(200).json({ ok: true })
  }
}

async function sendRecommend(res, { toEmail, inviterName, skillName, shareUrl }) {
  if (!toEmail || !skillName || !shareUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or shareUrl' })
    return
  }
  const fromName = inviterName?.trim() || 'A LearnScope user'
  const html = `
    <p>${escapeHtml(fromName)} thinks you'd be a good fit to develop <strong>${escapeHtml(skillName)}</strong> and recommends you start tracking it on LearnScope.</p>
    <p><a href="${escapeHtml(shareUrl)}">Add ${escapeHtml(skillName)} to your profile</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `
  if (
    await sendResendEmail(res, { to: toEmail, subject: `${fromName} recommends you track "${skillName}"`, html })
  ) {
    res.status(200).json({ ok: true })
  }
}

async function sendValidationRequest(res, { toEmail, requesterName, skillName, reviewUrl }) {
  if (!toEmail || !skillName || !reviewUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or reviewUrl' })
    return
  }
  const fromName = requesterName?.trim() || 'A LearnScope user'
  const html = `
    <p>${escapeHtml(fromName)} has asked you to validate their skill <strong>${escapeHtml(skillName)}</strong> on LearnScope.</p>
    <p>You'll be able to review their evidence for this skill and confirm whether they've reached their target level, or decline with feedback.</p>
    <p><a href="${escapeHtml(reviewUrl)}">Review the request</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `
  if (await sendResendEmail(res, { to: toEmail, subject: `${fromName} asked you to validate "${skillName}"`, html })) {
    res.status(200).json({ ok: true })
  }
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

  const { type, ...payload } = req.body ?? {}

  try {
    switch (type) {
      case 'invite':
        await sendInvite(res, payload)
        return
      case 'recommend':
        await sendRecommend(res, payload)
        return
      case 'validation_request':
        await sendValidationRequest(res, payload)
        return
      default:
        res.status(400).json({ error: 'Unknown email type' })
    }
  } catch (err) {
    console.error(`send-email (${type}) error:`, err)
    res.status(500).json({ error: 'Failed to send email.' })
  }
}
