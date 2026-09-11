-- LTI 1.1 consumer support: LearnScope acts as the "tool consumer"
-- (platform) that launches an externally-hosted LTI tool, the reverse
-- direction of SCORM/xAPI/cmi5 (self-hosted packages this app plays back
-- itself). LTI 1.3/Advantage (OIDC + JWT, dynamic registration) is out of
-- scope for this pass -- 1.1's signed-form-POST launch needs no new
-- dependency and no new persistent session concept, just an HMAC-SHA1
-- signature computed with Node's built-in crypto (see api/xapi/[...path]
-- .js's new 'lti-launch' branch).
--
-- Split into two tables so an ordinary org member (who needs to pick a
-- tool when attaching a resource to a course) can read a tool's name and
-- launch URL, while the shared secret stays admin-only and is never
-- exposed to the client at all -- signing always happens server-side
-- (service role), in the same function that already hosts xAPI's LRS for
-- the same "stay under Vercel's 12-function cap" reason.
create table lti_tools (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  launch_url text not null check (launch_url ~ '^https://'),
  consumer_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lti_tools_organisation_id_idx on lti_tools (organisation_id);

alter table lti_tools enable row level security;

create policy "Org members can view their organisation's LTI tools"
  on lti_tools for select
  to authenticated
  using (is_org_member(organisation_id, auth.uid()));

create policy "Org admins can manage their organisation's LTI tools"
  on lti_tools for all
  to authenticated
  using (is_org_admin(organisation_id, auth.uid()))
  with check (is_org_admin(organisation_id, auth.uid()));

-- No select policy for anyone but an org admin -- not even the org's own
-- ordinary members, and RLS defaults to deny with none matching. The
-- signing endpoint reads this with the service role, which bypasses RLS
-- entirely, so this table's only real audience is the admin config UI.
create table lti_tool_secrets (
  tool_id uuid primary key references lti_tools(id) on delete cascade,
  consumer_secret text not null,
  updated_at timestamptz not null default now()
);

alter table lti_tool_secrets enable row level security;

create policy "Org admins can manage their organisation's LTI tool secrets"
  on lti_tool_secrets for all
  to authenticated
  using (exists (select 1 from lti_tools t where t.id = tool_id and is_org_admin(t.organisation_id, auth.uid())))
  with check (exists (select 1 from lti_tools t where t.id = tool_id and is_org_admin(t.organisation_id, auth.uid())));

-- A course-attached "launch this external tool" resource, alongside
-- SCORM/xAPI/cmi5's self-hosted packages. lti_tool_id has no ON DELETE
-- action (the default, same as every other FK left unspecified on this
-- table) -- deleting a still-referenced tool is blocked outright rather
-- than silently orphaning or cascading away the resources built on it.
alter table content_resources add column lti_tool_id uuid references lti_tools(id);

alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'cmi5', 'external_video', 'web_url', 'page', 'lti'));

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type in ('external_video', 'web_url') and storage_path is null and external_url is not null and external_url ~ '^https?://' and page_content is null and lti_tool_id is null)
    or (type = 'page' and storage_path is null and external_url is null and page_content is not null and lti_tool_id is null)
    or (type = 'lti' and storage_path is null and external_url is null and page_content is null and lti_tool_id is not null)
    or (type not in ('external_video', 'web_url', 'page', 'lti') and storage_path is not null and external_url is null and page_content is null and lti_tool_id is null)
  );
