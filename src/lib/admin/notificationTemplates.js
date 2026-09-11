import { supabase } from '../supabaseClient'

// Sample values for the preview panel in AdminNotifications.jsx -- purely
// illustrative, never sent anywhere. Falls back to the placeholder's own
// name (title-cased) for one this list doesn't know about, so a future
// template with a new placeholder still previews something reasonable
// instead of showing a literal unresolved {{token}}.
const SAMPLE_PLACEHOLDER_VALUES = {
  fromName: 'Jamie Rivera',
  skillName: 'Stakeholder Communication',
  url: 'https://learnscope.app/example-link',
}

function sampleValueFor(placeholder) {
  return SAMPLE_PLACEHOLDER_VALUES[placeholder] || placeholder.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// Mirrors api/send-email.js's own renderTemplate exactly (HTML-escaped
// {{token}} substitution) -- kept as a separate small copy rather than a
// shared import since api/ (Node serverless) and src/ (Vite client bundle)
// are different build targets that don't import across that boundary.
export function renderNotificationPreview(template, placeholders) {
  const vars = Object.fromEntries((placeholders ?? []).map((key) => [key, sampleValueFor(key)]))
  function render(value) {
    return String(value).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (key in vars ? escapeHtml(vars[key]) : match))
  }
  return { subject: render(template.subjectTemplate), html: render(template.bodyTemplate) }
}

export async function listNotificationTemplates() {
  const { data, error } = await supabase.from('notification_templates').select('*').order('label')
  if (error) throw error
  return data ?? []
}

export async function updateNotificationTemplate(id, { subjectTemplate, bodyTemplate }, userId) {
  const { data, error } = await supabase
    .from('notification_templates')
    .update({
      subject_template: subjectTemplate.trim(),
      body_template: bodyTemplate.trim(),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
