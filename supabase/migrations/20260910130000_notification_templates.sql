-- Platform-admin notification template manager: lets a platform admin see
-- and edit the subject/body of every custom transactional email the app
-- sends (api/send-email.js), instead of those being hardcoded strings only
-- a code change could touch. Seeded with the three email types that
-- function already sends, using the exact text it used before this
-- migration -- editing a template changes future sends only, api/send-
-- email.js falls back to its own hardcoded copy if a row is ever missing.
--
-- Deliberately no insert/delete policy: api/send-email.js only ever looks
-- up one of these three fixed keys by name, so a platform admin can adapt
-- the wording of an existing template but can't create an orphaned template
-- with no code path that would ever send it, or delete one out from under
-- a still-live email type.
--
-- Out of scope here: Supabase Auth's own built-in emails (signup
-- confirmation, invite, password reset, magic link) are configured through
-- Supabase's own auth email template settings, not this table -- they're
-- listed for visibility in the admin UI, but editing them needs the
-- Supabase dashboard/Management API, a separate integration this migration
-- doesn't add.
create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  subject_template text not null,
  body_template text not null,
  placeholders text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table notification_templates enable row level security;

create policy "Platform admins can view notification templates"
  on notification_templates for select
  to authenticated
  using (is_platform_admin(auth.uid()));

create policy "Platform admins can update notification templates"
  on notification_templates for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

insert into notification_templates (key, label, description, subject_template, body_template, placeholders) values
(
  'peer_rating_invite',
  'Peer rating invite',
  'Sent when a learner invites someone -- who may not have a LearnScope account -- to rate one of their skills.',
  '{{fromName}} wants your rating on "{{skillName}}"',
  E'<p>{{fromName}} would like your take on their skill <strong>{{skillName}}</strong> on LearnScope.</p>\n<p><a href="{{url}}">Rate {{skillName}}</a></p>\n<p style="color:#666;font-size:13px">If you don''t recognize this, you can safely ignore this email.</p>',
  array['fromName', 'skillName', 'url']
),
(
  'skill_recommend',
  'Skill recommendation',
  'Sent when a learner recommends that a connection start tracking a skill.',
  '{{fromName}} recommends you track "{{skillName}}"',
  E'<p>{{fromName}} thinks you''d be a good fit to develop <strong>{{skillName}}</strong> and recommends you start tracking it on LearnScope.</p>\n<p><a href="{{url}}">Add {{skillName}} to your profile</a></p>\n<p style="color:#666;font-size:13px">If you don''t recognize this, you can safely ignore this email.</p>',
  array['fromName', 'skillName', 'url']
),
(
  'skill_validation_request',
  'Skill validation request',
  'Sent when a learner asks someone to validate one of their skills against their evidence.',
  '{{fromName}} asked you to validate "{{skillName}}"',
  E'<p>{{fromName}} has asked you to validate their skill <strong>{{skillName}}</strong> on LearnScope.</p>\n<p>You''ll be able to review their evidence for this skill and confirm whether they''ve reached their target level, or decline with feedback.</p>\n<p><a href="{{url}}">Review the request</a></p>\n<p style="color:#666;font-size:13px">If you don''t recognize this, you can safely ignore this email.</p>',
  array['fromName', 'skillName', 'url']
);
