-- How an organisation presents its own learner workspace
-- (/organisation/learning?org=:slug, EmployerHome.jsx) to its members:
-- which of its sections show and in what order, where members land, what
-- the sections are called, what the Home page says, and two behaviour rules
-- (whether members can enrol from the catalogue themselves, and how assigned
-- training is described).
--
-- Presentation only. Hiding a section changes what the workspace shows, not
-- what anyone can access -- the underlying data keeps its own RLS. Nothing
-- here reaches into a learner's personal workspace (skills, experience,
-- plans, profile), which stays under the learner's control.
--
-- One row per organisation; no row means LearnScope's defaults (all four
-- sections, Home first, members can enrol themselves, training "assigned").
-- No existing data is changed.

create or replace function private.learner_workspace_section_labels_valid(p_labels jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_labels) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_labels) as label(key, value)
      where label.key not in ('home', 'learning', 'catalogue', 'role')
        or jsonb_typeof(label.value) <> 'string'
        or length(btrim(label.value #>> '{}')) not between 1 and 30
    )
$$;

create or replace function private.learner_workspace_pinned_links_valid(p_links jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_links) = 'array'
    and jsonb_array_length(p_links) <= 5
    and not exists (
      select 1
      from jsonb_array_elements(p_links) as link(value)
      where jsonb_typeof(link.value) <> 'object'
        or jsonb_typeof(link.value -> 'label') is distinct from 'string'
        or jsonb_typeof(link.value -> 'url') is distinct from 'string'
        or length(btrim(link.value ->> 'label')) not between 1 and 60
        or length(link.value ->> 'url') > 500
        -- https only, and no userinfo ("https://trusted.example@other.example").
        or (link.value ->> 'url') !~ '^https://[^\s/@?#]+\.[^\s/@?#]+([/?#]\S*)?$'
        or exists (select 1 from jsonb_object_keys(link.value) as k(key) where k.key not in ('label', 'url'))
    )
$$;

-- The check constraints below call these as the writing admin.
grant execute on function private.learner_workspace_section_labels_valid(jsonb) to authenticated;
grant execute on function private.learner_workspace_pinned_links_valid(jsonb) to authenticated;

create table public.organisation_learner_workspace_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  -- Every section exactly once; Home can't be hidden, so a member always
  -- has somewhere to land.
  section_order text[] not null default array['home', 'learning', 'catalogue', 'role'],
  hidden_sections text[] not null default '{}',
  landing_section text not null default 'home',
  section_labels jsonb not null default '{}'::jsonb,
  welcome_message text,
  announcement text,
  contact_name text,
  contact_role text,
  contact_email text,
  pinned_links jsonb not null default '[]'::jsonb,
  catalogue_enrolment text not null default 'self_enrol',
  assigned_training_framing text not null default 'assigned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,

  constraint learner_workspace_section_order_check check (
    cardinality(section_order) = 4
    and section_order @> array['home', 'learning', 'catalogue', 'role']
  ),
  constraint learner_workspace_hidden_sections_check check (
    hidden_sections <@ array['learning', 'catalogue', 'role']
  ),
  constraint learner_workspace_landing_section_check check (
    landing_section in ('home', 'learning', 'catalogue', 'role')
    and not (landing_section = any(hidden_sections))
  ),
  constraint learner_workspace_section_labels_check check (
    private.learner_workspace_section_labels_valid(section_labels)
  ),
  constraint learner_workspace_welcome_message_check check (
    welcome_message is null or length(welcome_message) <= 2000
  ),
  constraint learner_workspace_announcement_check check (
    announcement is null or length(announcement) <= 500
  ),
  constraint learner_workspace_contact_check check (
    (contact_name is null or length(contact_name) <= 100)
    and (contact_role is null or length(contact_role) <= 100)
    and (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'))
  ),
  constraint learner_workspace_pinned_links_check check (
    private.learner_workspace_pinned_links_valid(pinned_links)
  ),
  constraint learner_workspace_catalogue_enrolment_check check (
    catalogue_enrolment in ('self_enrol', 'browse_only')
  ),
  constraint learner_workspace_assigned_training_framing_check check (
    assigned_training_framing in ('assigned', 'required', 'recommended')
  )
);

comment on table public.organisation_learner_workspace_settings is
  'How an organisation presents its learner workspace to its members. Presentation only: does not grant or revoke data access, and never affects a learner''s personal workspace.';

-- Who changed it and when is recorded server-side, not trusted from the client.
create or replace function private.stamp_learner_workspace_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;

create trigger stamp_learner_workspace_settings
  before insert or update on public.organisation_learner_workspace_settings
  for each row execute function private.stamp_learner_workspace_settings();

alter table public.organisation_learner_workspace_settings enable row level security;

-- Members need the settings to render their workspace; is_employer_member
-- also admits platform admins. Admins are whoever already runs the
-- organisation console: employer admins (is_employer_admin, which also
-- admits platform admins) or the organisation's own admins (is_org_admin).
create policy "Members can view their organisation's learner workspace settings"
  on public.organisation_learner_workspace_settings for select
  to authenticated
  using (
    public.is_employer_member(organisation_id, (select auth.uid()))
    or public.is_org_admin(organisation_id, (select auth.uid()))
  );

create policy "Organisation admins can add learner workspace settings"
  on public.organisation_learner_workspace_settings for insert
  to authenticated
  with check (public.is_employer_admin(organisation_id, (select auth.uid())) or public.is_org_admin(organisation_id, (select auth.uid())));

create policy "Organisation admins can update learner workspace settings"
  on public.organisation_learner_workspace_settings for update
  to authenticated
  using (public.is_employer_admin(organisation_id, (select auth.uid())) or public.is_org_admin(organisation_id, (select auth.uid())))
  with check (public.is_employer_admin(organisation_id, (select auth.uid())) or public.is_org_admin(organisation_id, (select auth.uid())));

-- No delete policy: "reset to defaults" writes the defaults back.
-- Replace Supabase's default table-wide grants with exactly what's needed.
revoke all on public.organisation_learner_workspace_settings from anon, authenticated;
-- Column-level read, so members can't see which admin last edited (updated_by).
grant select (organisation_id, section_order, hidden_sections, landing_section, section_labels,
  welcome_message, announcement, contact_name, contact_role, contact_email, pinned_links,
  catalogue_enrolment, assigned_training_framing, created_at, updated_at)
  on public.organisation_learner_workspace_settings to authenticated;
grant insert, update on public.organisation_learner_workspace_settings to authenticated;
