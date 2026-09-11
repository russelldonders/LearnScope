import { verifySupabaseUser } from './_lib/auth.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

// Single dispatcher for the app's two Resend-backed transactional emails,
// rather than one function per email type -- Vercel's Hobby plan caps
// deployments at 12 serverless functions (see api/admin/actions.js for the
// same reasoning), and freeing a slot here is what made room for the new
// xAPI LRS endpoint. Both emails shared near-identical shape (auth check,
// escapeHtml, Resend call) before this merge.
//
// Subject/body for each of these three now come from the notification_
// templates table (editable via /admin/notifications) rather than being
// hardcoded here -- DEFAULT_TEMPLATES below is only a fallback for a
// missing/not-yet-migrated row, so sending never breaks on a stale DB.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// {{token}} substitution, HTML-escaped -- safe both as inline text and
// inside a double-quoted href, which is all these templates ever use it for.
function renderTemplate(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (key in vars ? escapeHtml(vars[key]) : match))
}

const DEFAULT_TEMPLATES = {
  peer_rating_invite: {
    subject_template: '{{fromName}} wants your rating on "{{skillName}}"',
    body_template: `
    <p>{{fromName}} would like your take on their skill <strong>{{skillName}}</strong> on LearnScope.</p>
    <p><a href="{{url}}">Rate {{skillName}}</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `,
  },
  skill_recommend: {
    subject_template: '{{fromName}} recommends you track "{{skillName}}"',
    body_template: `
    <p>{{fromName}} thinks you'd be a good fit to develop <strong>{{skillName}}</strong> and recommends you start tracking it on LearnScope.</p>
    <p><a href="{{url}}">Add {{skillName}} to your profile</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `,
  },
  skill_validation_request: {
    subject_template: '{{fromName}} asked you to validate "{{skillName}}"',
    body_template: `
    <p>{{fromName}} has asked you to validate their skill <strong>{{skillName}}</strong> on LearnScope.</p>
    <p>You'll be able to review their evidence for this skill and confirm whether they've reached their target level, or decline with feedback.</p>
    <p><a href="{{url}}">Review the request</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `,
  },
}

async function getTemplate(key) {
  try {
    const { data } = await supabaseAdmin()
      .from('notification_templates')
      .select('subject_template, body_template')
      .eq('key', key)
      .maybeSingle()
    return data || DEFAULT_TEMPLATES[key]
  } catch {
    return DEFAULT_TEMPLATES[key]
  }
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
  const vars = { fromName, skillName, url: shareUrl }
  const template = await getTemplate('peer_rating_invite')
  const subject = renderTemplate(template.subject_template, vars)
  const html = renderTemplate(template.body_template, vars)
  if (await sendResendEmail(res, { to: toEmail, subject, html })) {
    res.status(200).json({ ok: true })
  }
}

async function sendRecommend(res, { toEmail, inviterName, skillName, shareUrl }) {
  if (!toEmail || !skillName || !shareUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or shareUrl' })
    return
  }
  const fromName = inviterName?.trim() || 'A LearnScope user'
  const vars = { fromName, skillName, url: shareUrl }
  const template = await getTemplate('skill_recommend')
  const subject = renderTemplate(template.subject_template, vars)
  const html = renderTemplate(template.body_template, vars)
  if (await sendResendEmail(res, { to: toEmail, subject, html })) {
    res.status(200).json({ ok: true })
  }
}

async function sendValidationRequest(res, { toEmail, requesterName, skillName, reviewUrl }) {
  if (!toEmail || !skillName || !reviewUrl) {
    res.status(400).json({ error: 'Missing toEmail, skillName, or reviewUrl' })
    return
  }
  const fromName = requesterName?.trim() || 'A LearnScope user'
  const vars = { fromName, skillName, url: reviewUrl }
  const template = await getTemplate('skill_validation_request')
  const subject = renderTemplate(template.subject_template, vars)
  const html = renderTemplate(template.body_template, vars)
  if (await sendResendEmail(res, { to: toEmail, subject, html })) {
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
