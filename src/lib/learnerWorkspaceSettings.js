import { supabase } from './supabaseClient'

// How an organisation presents its learner workspace (EmployerHome.jsx) to
// its members -- organisation_learner_workspace_settings, 0325. Presentation
// only: hiding a section never changes what anyone can access, and nothing
// here touches a learner's personal workspace. No row means the defaults.

export const WORKSPACE_SECTIONS = ['home', 'learning', 'catalogue', 'role']
export const HIDEABLE_SECTIONS = ['learning', 'catalogue', 'role']
export const CATALOGUE_ENROLMENT_MODES = ['self_enrol', 'browse_only']
export const ASSIGNED_TRAINING_FRAMINGS = ['assigned', 'required', 'recommended']

export const LIMITS = {
  sectionLabel: 30,
  welcomeMessage: 2000,
  announcement: 500,
  contactName: 100,
  contactRole: 100,
  contactEmail: 254,
  linkLabel: 60,
  linkUrl: 500,
  links: 5,
}

export const DEFAULT_WORKSPACE_SETTINGS = Object.freeze({
  sectionOrder: WORKSPACE_SECTIONS,
  hiddenSections: [],
  landingSection: 'home',
  sectionLabels: {},
  welcomeMessage: '',
  announcement: '',
  contactName: '',
  contactRole: '',
  contactEmail: '',
  pinnedLinks: [],
  catalogueEnrolment: 'self_enrol',
  assignedTrainingFraming: 'assigned',
})

const COLUMNS = 'section_order, hidden_sections, landing_section, section_labels, welcome_message, announcement, contact_name, contact_role, contact_email, pinned_links, catalogue_enrolment, assigned_training_framing'

// Tolerant of a missing row or a partial/stale one, so the workspace always
// renders something coherent: every section exactly once, Home never
// hidden, and a landing section that's actually shown.
export function normaliseWorkspaceSettings(row) {
  if (!row) return { ...DEFAULT_WORKSPACE_SETTINGS }
  const order = (row.section_order ?? []).filter((s, i, all) => WORKSPACE_SECTIONS.includes(s) && all.indexOf(s) === i)
  const sectionOrder = [...order, ...WORKSPACE_SECTIONS.filter((s) => !order.includes(s))]
  const hiddenSections = (row.hidden_sections ?? []).filter((s) => HIDEABLE_SECTIONS.includes(s))
  const landingSection = WORKSPACE_SECTIONS.includes(row.landing_section) && !hiddenSections.includes(row.landing_section)
    ? row.landing_section
    : 'home'
  const sectionLabels = Object.fromEntries(
    Object.entries(row.section_labels ?? {}).filter(([key, value]) => WORKSPACE_SECTIONS.includes(key) && typeof value === 'string' && value.trim())
  )
  return {
    sectionOrder,
    hiddenSections,
    landingSection,
    sectionLabels,
    welcomeMessage: row.welcome_message ?? '',
    announcement: row.announcement ?? '',
    contactName: row.contact_name ?? '',
    contactRole: row.contact_role ?? '',
    contactEmail: row.contact_email ?? '',
    pinnedLinks: Array.isArray(row.pinned_links) ? row.pinned_links.filter((l) => l?.label && isValidHttpsUrl(l?.url)) : [],
    catalogueEnrolment: CATALOGUE_ENROLMENT_MODES.includes(row.catalogue_enrolment) ? row.catalogue_enrolment : 'self_enrol',
    assignedTrainingFraming: ASSIGNED_TRAINING_FRAMINGS.includes(row.assigned_training_framing) ? row.assigned_training_framing : 'assigned',
  }
}

// The sections a member sees, in order.
export function visibleSections(settings) {
  return settings.sectionOrder.filter((section) => !settings.hiddenSections.includes(section))
}

export function isSectionVisible(settings, section) {
  return section === 'home' || (WORKSPACE_SECTIONS.includes(section) && !settings.hiddenSections.includes(section))
}

// A section's name for members: the organisation's own, else the
// translated default (the i18n keys live under employerHome).
export function sectionLabel(t, settings, section) {
  return settings.sectionLabels[section] || t(`employerHome.nav.${section}`)
}

export function sectionHeading(t, settings, section) {
  return settings.sectionLabels[section] || t(`employerHome.headings.${section}`)
}

export function isValidHttpsUrl(value) {
  // Mirrors the table's check (0325): https, and no userinfo before the host.
  return /^https:\/\/[^\s/@?#]+\.[^\s/@?#]+([/?#]\S*)?$/.test(value ?? '')
}

// Plain addresses only, so a mailto: link can't carry ?bcc= or &body=.
export function isValidEmail(value) {
  return /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value ?? '')
}

// Problems the database would refuse, phrased for the admin -- checked
// before saving so they see which field to fix rather than a constraint name.
export function validateWorkspaceSettings(settings) {
  const errors = []
  for (const [section, label] of Object.entries(settings.sectionLabels)) {
    if (label.trim().length > LIMITS.sectionLabel) errors.push(`The name for “${section}” must be ${LIMITS.sectionLabel} characters or fewer.`)
  }
  if (settings.welcomeMessage.length > LIMITS.welcomeMessage) errors.push(`The welcome message must be ${LIMITS.welcomeMessage} characters or fewer.`)
  if (settings.announcement.length > LIMITS.announcement) errors.push(`The announcement must be ${LIMITS.announcement} characters or fewer.`)
  if (settings.contactName.length > LIMITS.contactName) errors.push(`The contact name must be ${LIMITS.contactName} characters or fewer.`)
  if (settings.contactRole.length > LIMITS.contactRole) errors.push(`The contact role must be ${LIMITS.contactRole} characters or fewer.`)
  if (settings.contactEmail.trim() && !isValidEmail(settings.contactEmail.trim())) errors.push('Enter a valid contact email address.')
  if (settings.pinnedLinks.length > LIMITS.links) errors.push(`You can pin up to ${LIMITS.links} links.`)
  settings.pinnedLinks.forEach((link, index) => {
    const n = index + 1
    if (!link.label.trim()) errors.push(`Link ${n} needs a name.`)
    else if (link.label.trim().length > LIMITS.linkLabel) errors.push(`Link ${n}’s name must be ${LIMITS.linkLabel} characters or fewer.`)
    if (!isValidHttpsUrl(link.url.trim()) || link.url.trim().length > LIMITS.linkUrl) errors.push(`Link ${n} needs a full web address starting with https://`)
  })
  return errors
}

function toRow(settings) {
  const blankToNull = (value) => (value.trim() ? value.trim() : null)
  return {
    section_order: settings.sectionOrder,
    hidden_sections: settings.hiddenSections,
    landing_section: settings.hiddenSections.includes(settings.landingSection) ? 'home' : settings.landingSection,
    section_labels: Object.fromEntries(
      Object.entries(settings.sectionLabels).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)
    ),
    welcome_message: blankToNull(settings.welcomeMessage),
    announcement: blankToNull(settings.announcement),
    contact_name: blankToNull(settings.contactName),
    contact_role: blankToNull(settings.contactRole),
    contact_email: blankToNull(settings.contactEmail),
    pinned_links: settings.pinnedLinks.map((link) => ({ label: link.label.trim(), url: link.url.trim() })),
    catalogue_enrolment: settings.catalogueEnrolment,
    assigned_training_framing: settings.assignedTrainingFraming,
  }
}

export async function getLearnerWorkspaceSettings(organisationId) {
  const { data, error } = await supabase
    .from('organisation_learner_workspace_settings')
    .select(COLUMNS)
    .eq('organisation_id', organisationId)
    .maybeSingle()
  if (error) throw error
  return normaliseWorkspaceSettings(data)
}

export async function saveLearnerWorkspaceSettings(organisationId, settings) {
  const { data, error } = await supabase
    .from('organisation_learner_workspace_settings')
    .upsert({ organisation_id: organisationId, ...toRow(settings) }, { onConflict: 'organisation_id' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return normaliseWorkspaceSettings(data)
}

export const __testing = { toRow }
