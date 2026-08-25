-- xAPI (Tin Can) content packages as a fourth content_resources type,
-- alongside video/file/scorm (0071) -- uploaded/attached the same way as a
-- SCORM package, but launched via a URL + query-string launch payload
-- (endpoint/auth/actor/registration) rather than a window.API runtime,
-- since that's how the xAPI spec's own launch method works.
-- Constraint keeps its original name from before the course_content_items
-- -> content_resources rename (0073) -- table renames don't rename
-- constraints, same reasoning as that migration's own
-- course_content_items_storage_path_scoped drop.
alter table content_resources drop constraint course_content_items_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'file', 'scorm', 'xapi'));

-- Links a recorded statement back to the content package that produced it.
-- Nullable and "on delete set null" -- same "don't delete the underlying
-- record on unlink" rule as every other association in this schema; a
-- statement is evidence of what a learner did and must survive even if the
-- resource is later removed. Statements from the existing self-report flow
-- (RecordActivityModal etc.) keep resource_id null, exactly as before.
alter table xapi_statements add column resource_id uuid
  references content_resources(id) on delete set null;

create index xapi_statements_resource_id_idx on xapi_statements (resource_id);

-- One row per "launch" of an xAPI package -- the registration (this row's
-- id) and a random bearer token are embedded in the package's launch URL,
-- and the api/xapi/[...path].js LRS endpoint looks up incoming Basic-auth
-- requests against this table (via the service role, since the request has
-- no Supabase session -- it authenticates with this token instead) to learn
-- which user/resource/course a statement submission belongs to. Short-lived
-- by design: a launch is one learning session, not a standing credential.
create table xapi_launch_sessions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references content_resources(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  -- The learner's own `courses` row (not course_catalogue) -- mirrors
  -- xapi_statements.course_id (0020) so statements recorded via a package
  -- link to the same "course" a self-reported statement would. Nullable:
  -- previewing a resource from the org's library (not yet attached to any
  -- enrolled course) has no course context.
  course_id uuid references courses(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours')
);

create index xapi_launch_sessions_token_idx on xapi_launch_sessions (token);

alter table xapi_launch_sessions enable row level security;

-- A learner creates their own launch session when opening an xAPI package
-- (self-service, like connection_invites); the LRS endpoint itself reads
-- this table via the service role, bypassing RLS entirely, since incoming
-- statement requests carry the session token, not a Supabase JWT.
create policy "Users create and view their own xapi launch sessions"
  on xapi_launch_sessions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
