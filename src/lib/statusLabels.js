// Shared label maps for status/type values shown across the platform-admin
// and provider-admin consoles (/admin, /provider, /employer). One map per
// domain concept -- not a single combined object -- so each stays
// independently importable and easy to extend, mirroring levels.js's export
// style for the equivalent skill-proficiency scales.

// course_catalogue_courses (course version) approval-workflow status.
// Previously defined identically as STATUS_LABELS in ProviderConsole.jsx and
// ProviderCourseEditor.jsx, and as COURSE_STATUS in ProviderCatalogueDetail.jsx
// -- AdminCatalogue.jsx re-derived the same text inline via
// c.status.replace('_', ' ') instead of a label map.
export const COURSE_STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
}

// skill_library.type. Previously defined identically as TYPE_LABELS in
// AdminSkills.jsx and AdminSkillDetail.jsx.
export const SKILL_TYPE_LABELS = {
  global: 'Global',
  personal: 'Personal',
  provider: 'Provider',
}

// Course-content resource type (course_content_links / provider resource
// library). Previously near-duplicated as TYPE_LABELS in
// ProviderCourseEditor.jsx (the content editor, which also supports the
// built-in "page" resource type) and RESOURCE_TYPE_LABELS in
// ProviderCatalogueDetail.jsx (catalogue-level resource listing, which never
// shows a "page" since those aren't catalogue resources). Kept as one map
// with "page" included -- harmless for the call site that never encounters it.
export const RESOURCE_TYPE_LABELS = {
  video: 'Video',
  screen_recording: 'Screen recording',
  file: 'File',
  scorm: 'SCORM package',
  xapi: 'xAPI package',
  external_video: 'External video',
  web_url: 'Web link',
  page: 'Page',
}
