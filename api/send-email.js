import { verifySupabaseUser } from './_lib/auth.js'
import { consumeQuota, sendQuotaExceeded } from './_lib/quota.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'
import { escapeHtml } from './_lib/html.js'

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
  plan_invite: {
    subject_template: '{{fromName}} invited you to follow the plan "{{planTitle}}"',
    body_template: `
    <p>{{fromName}} has invited you to follow their plan <strong>{{planTitle}}</strong> on LearnScope.</p>
    <p>Accepting gives you your own copy of the plan to work through. {{fromName}} will see how many of its items you've done, but not your notes or evidence.</p>
    <p><a href="{{url}}">View the plan</a></p>
    <p style="color:#666;font-size:13px">If you don't recognize this, you can safely ignore this email.</p>
  `,
  },
  connection_invite: {
    subject_template: '{{fromName}} invited you to connect on LearnScope',
    body_template: `
    <p>{{fromName}} would like to connect with you on LearnScope, where people record and develop their skills and learning over time.</p>
    <p>Once you're connected you can follow each other's progress, as far as each of you chooses to share, and ask each other for ratings and recommendations.</p>
    <p><a href="{{url}}">Accept the invitation</a></p>
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

const MAX_SKILL_NAME_LENGTH = 200

// Each email type's link must be this app's own page for it -- otherwise
// any signed-in user could send LearnScope-branded mail carrying an
// arbitrary (phishing) link.
const LINK_PATHS = {
  invite: /^\/rate\/[A-Za-z0-9_-]+$/,
  recommend: /^\/recommend\/[A-Za-z0-9_-]+$/,
  validation_request: /^\/validate-request\/[0-9a-f-]{36}$/i,
  plan_invite: /^\/plan-invite\/[A-Za-z0-9_-]+$/,
  connect: /^\/connect\/[A-Za-z0-9_-]+$/,
}

// The client builds links from window.location.origin, and the API is only
// ever called same-origin, so the request's own Host (the deployment or
// custom domain the learner is on) is the origin to accept, plus APP_URL.
function allowedOrigins(host) {
  const origins = new Set()
  if (process.env.APP_URL) {
    try {
      origins.add(new URL(process.env.APP_URL).origin)
    } catch {
      // A malformed APP_URL just isn't an accepted origin.
    }
  }
  if (host) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
    origins.add(`${isLocal ? 'http' : 'https'}://${host}`)
  }
  return origins
}

export function isAppLink(value, type, host) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password || url.search || url.hash) return false
  if (!Object.hasOwn(LINK_PATHS, type) || !LINK_PATHS[type].test(url.pathname)) return false
  return allowedOrigins(host).has(url.origin)
}

// The sender's name comes from their own profile, never the request body,
// so an email can't claim to be from someone (or something) else.
async function senderName(user) {
  try {
    const { data } = await supabaseAdmin().from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    return data?.full_name?.trim() || user.email || 'A LearnScope user'
  } catch {
    return user.email || 'A LearnScope user'
  }
}

async function sendTemplatedEmail(res, { templateKey, toEmail, fromName, skillName, url }) {
  // A plan invitation's title arrives as skillName too (see handler); its
  // template calls it planTitle.
  const vars = { fromName, skillName, planTitle: skillName, url }
  const template = await getTemplate(templateKey)
  const subject = renderTemplate(template.subject_template, vars)
  const html = renderTemplate(template.body_template, vars)
  if (await sendResendEmail(res, { to: toEmail, subject, html })) {
    res.status(200).json({ ok: true })
  }
}

// A plan invitation email goes only to the address the sender invited, for
// a waiting invitation they sent, with the plan's real title -- never the
// address or title the request names -- so the endpoint can't be used to
// mail arbitrary text to arbitrary people. Returns null if it doesn't check out.
export async function planInviteEmail(admin, userId, url) {
  const code = new URL(url).pathname.split('/').pop()
  const { data: invitation } = await admin
    .from('learner_plan_invitations')
    .select('invitee_email, inviter_id, via, status, source_plan_id')
    .eq('share_code', code)
    .maybeSingle()
  if (!invitation || invitation.inviter_id !== userId || invitation.via !== 'email' || invitation.status !== 'pending') {
    return null
  }
  const { data: plan } = await admin.from('learner_plans').select('title').eq('id', invitation.source_plan_id).maybeSingle()
  if (!plan) return null
  return { toEmail: invitation.invitee_email, title: plan.title }
}

// The same rule for the other emails: a rating or recommendation invite goes
// only to the address on a waiting invite the sender made, for their own
// skill, with that skill's real name (a connect invite has no skill, so no
// name); a validation request only to the
// validator the sender asked, for a request still waiting. Null if it
// doesn't check out.
async function ownSkillName(admin, userId, skillId) {
  const { data: skill } = await admin.from('skills').select('name, user_id').eq('id', skillId).maybeSingle()
  return skill && skill.user_id === userId ? skill.name : null
}

export async function connectionInviteEmail(admin, userId, url, inviteType) {
  const code = new URL(url).pathname.split('/').pop()
  const { data: invite } = await admin
    .from('connection_invites')
    .select('invitee_email, inviter_id, status, invite_type, skill_id')
    .eq('share_code', code)
    .maybeSingle()
  if (
    !invite || invite.inviter_id !== userId || invite.status !== 'pending'
    || invite.invite_type !== inviteType || !invite.invitee_email
  ) {
    return null
  }
  if (inviteType === 'connect') return { toEmail: invite.invitee_email, title: '' }
  const title = await ownSkillName(admin, userId, invite.skill_id)
  return title ? { toEmail: invite.invitee_email, title } : null
}

export async function validationRequestEmail(admin, userId, url) {
  const requestId = new URL(url).pathname.split('/').pop()
  const { data: request } = await admin
    .from('skill_validation_requests')
    .select('requester_id, validator_id, status, skill_id')
    .eq('id', requestId)
    .maybeSingle()
  if (!request || request.requester_id !== userId || request.status !== 'pending') return null
  const title = await ownSkillName(admin, userId, request.skill_id)
  if (!title) return null
  const { data } = await admin.auth.admin.getUserById(request.validator_id)
  const toEmail = data?.user?.email
  return toEmail ? { toEmail, title } : null
}

// Where each email may go and what it's about, from the database rather
// than the request.
function verifiedEmail(admin, userId, type, url) {
  if (type === 'plan_invite') return planInviteEmail(admin, userId, url)
  if (type === 'validation_request') return validationRequestEmail(admin, userId, url)
  if (type === 'connect') return connectionInviteEmail(admin, userId, url, 'connect')
  return connectionInviteEmail(admin, userId, url, type === 'recommend' ? 'recommend' : 'rate')
}

const EMAIL_TYPES = {
  invite: { templateKey: 'peer_rating_invite', urlField: 'shareUrl' },
  recommend: { templateKey: 'skill_recommend', urlField: 'shareUrl' },
  validation_request: { templateKey: 'skill_validation_request', urlField: 'reviewUrl' },
  plan_invite: { templateKey: 'plan_invite', urlField: 'shareUrl' },
  connect: { templateKey: 'connection_invite', urlField: 'shareUrl' },
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
  const emailType = Object.hasOwn(EMAIL_TYPES, type) ? EMAIL_TYPES[type] : null
  if (!emailType) {
    res.status(400).json({ error: 'Unknown email type' })
    return
  }

  // The recipient and the skill or plan named in the email come from the
  // sender's own waiting invite or request (verifiedEmail), never from the
  // request body, so the endpoint can't mail arbitrary text to arbitrary
  // people. Any toEmail/skillName the client still sends is ignored.
  const url = payload[emailType.urlField]
  if (typeof url !== 'string' || !url) {
    res.status(400).json({ error: `Missing ${emailType.urlField}` })
    return
  }
  if (!isAppLink(url, type, req.headers.host)) {
    res.status(400).json({ error: `Invalid ${emailType.urlField}` })
    return
  }
  const verified = await verifiedEmail(supabaseAdmin(), user.id, type, url).catch((err) => {
    console.error(`send-email (${type}) lookup error:`, err)
    return null
  })
  if (!verified) {
    res.status(400).json({ error: 'That invitation isn’t waiting to be sent.' })
    return
  }
  const recipient = verified.toEmail
  const subjectName = verified.title
  if (!(await consumeQuota(user.id, 'email'))) {
    sendQuotaExceeded(res)
    return
  }

  try {
    await sendTemplatedEmail(res, {
      templateKey: emailType.templateKey,
      toEmail: recipient,
      fromName: await senderName(user),
      skillName: subjectName.slice(0, MAX_SKILL_NAME_LENGTH),
      url,
    })
  } catch (err) {
    console.error(`send-email (${type}) error:`, err)
    res.status(500).json({ error: 'Failed to send email.' })
  }
}
