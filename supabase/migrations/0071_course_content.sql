-- Course content: what a provider actually attaches inside a course they're
-- building (video, downloadable files, SCORM packages) -- distinct from
-- course_catalogue, which stays pure metadata (name/type/duration/synopsis)
-- per its own 0035 comment. One course has many ordered content items.
--
-- Storage: a single PUBLIC bucket, not the skill-evidence private+signed-URL
-- pattern. SCORM packages are many interlinked files (html/js/css/images)
-- referencing each other by relative path -- a signed-URL-per-file scheme
-- would break every relative reference inside uploaded SCORM content, and
-- rewriting them isn't attempted here. Paths are namespaced by random
-- course/content-item uuids, so this is "unlisted" (unguessable) rather
-- than genuinely access-controlled: a draft course's content is reachable
-- by anyone with the exact URL, not just the owning org or platform admins,
-- even though the *course_catalogue row itself* stays properly RLS-gated.
-- Acceptable given approved courses are meant to be broadly browsable
-- anyway; revisit with a signed proxy if draft-stage confidentiality of
-- attached files specifically becomes a real requirement.
insert into storage.buckets (id, name, public)
values ('course-content', 'course-content', true)
on conflict (id) do nothing;

create table course_content_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references course_catalogue(id) on delete cascade not null,
  type text not null check (type in ('video', 'file', 'scorm')),
  title text not null,
  position int not null default 0,
  -- video/file: the object path of the single uploaded file.
  -- scorm: the folder prefix the package was extracted under.
  storage_path text not null,
  file_name text,
  -- scorm only: path (relative to storage_path) to the launch html, read
  -- from the package's imsmanifest.xml at upload time.
  launch_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table course_content_items enable row level security;

create index course_content_items_course_id_idx on course_content_items (course_id);

-- Same visibility as the owning course itself (course_catalogue's own
-- select policy, 0066): approved, or the owning org's own members, or a
-- platform admin.
create policy "View content for viewable courses"
  on course_content_items for select
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_items.course_id
        and (
          cc.status = 'approved'
          or is_platform_admin(auth.uid())
          or (cc.organisation_id is not null and is_org_member(cc.organisation_id, auth.uid()))
        )
    )
  );

-- Content can only be added/edited/removed while the course itself is still
-- editable (draft/rejected) -- same edit window course_catalogue's own
-- org-member update policy (0066) already enforces on the course row.
-- Platform admins are unconditional, matching every other admin override in
-- this schema.
create policy "Manage content for editable courses"
  on course_content_items for all
  to authenticated
  using (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_items.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from course_catalogue cc
      where cc.id = course_content_items.course_id
        and (
          is_platform_admin(auth.uid())
          or (
            cc.organisation_id is not null
            and is_org_member(cc.organisation_id, auth.uid())
            and cc.status in ('draft', 'rejected')
          )
        )
    )
  );

-- Per-learner progress through a content item -- mainly SCORM's cmi data
-- model (lesson_status, score, session_time, ...), but the same shape
-- covers a simple "watched"/"downloaded" marker for video/file too.
create table course_content_progress (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid references course_content_items(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'not_attempted'
    check (status in ('not_attempted', 'incomplete', 'completed', 'passed', 'failed')),
  score numeric,
  cmi_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (content_item_id, user_id)
);

alter table course_content_progress enable row level security;

create index course_content_progress_user_id_idx on course_content_progress (user_id);

create policy "Users manage their own content progress"
  on course_content_progress for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
