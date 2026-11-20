-- An organisation's own workspace sections (custom_pages, 0326) are now
-- edited with the course page editor (PageBuilderModal) and shown with the
-- course page renderer (PageContent), instead of being plain text.
--
-- 1. Each page's plain-text `body` becomes a page document `content`
--    ({ version: 1, blocks: [...] }, the same shape as
--    content_resources.page_content). Existing text is kept: it becomes one
--    text block, HTML-escaped, with its line breaks. An empty body becomes
--    an empty page. Who/when last edited is left as it was.
-- 2. Scored test questions aren't allowed on these pages -- nothing records
--    a member's score there, so they'd look like an assessment that isn't
--    one. Knowledge checks (feedback only) are fine.
-- 3. The organisation's admins may upload images/videos for these pages to
--    its page-media folder in course-content, as its training team already
--    can, and may remove only files they uploaded themselves.
--
-- Rich text is sanitised where it's shown (PageContent runs every block
-- through normalisePageDocument/sanitiseRichText), as for course pages.

alter table public.organisation_learner_workspace_settings
  drop constraint learner_workspace_custom_pages_check;

alter table public.organisation_learner_workspace_settings disable trigger stamp_learner_workspace_settings;

update public.organisation_learner_workspace_settings s
set custom_pages = (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', page.value ->> 'id',
      'title', page.value ->> 'title',
      'content', jsonb_build_object(
        'version', 1,
        'blocks', case
          when btrim(coalesce(page.value ->> 'body', '')) = '' then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid()::text,
            'type', 'text',
            'align', 'left',
            'content', replace(replace(replace(replace(replace(
              page.value ->> 'body', '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\r\n', E'\n'), E'\n', '<br>')
          ))
        end
      )
    ) order by page.ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(s.custom_pages) with ordinality as page(value, ordinality)
)
where jsonb_array_length(s.custom_pages) > 0;

alter table public.organisation_learner_workspace_settings enable trigger stamp_learner_workspace_settings;

create or replace function private.learner_workspace_custom_pages_valid(p_pages jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_pages) = 'array'
    and jsonb_array_length(p_pages) <= 10
    and not exists (
      select 1
      from jsonb_array_elements(p_pages) as page(value)
      where jsonb_typeof(page.value) <> 'object'
        or jsonb_typeof(page.value -> 'id') is distinct from 'string'
        or jsonb_typeof(page.value -> 'title') is distinct from 'string'
        or jsonb_typeof(page.value -> 'content') is distinct from 'object'
        or jsonb_typeof(page.value -> 'content' -> 'blocks') is distinct from 'array'
        or (page.value ->> 'id') !~ '^page-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or length(btrim(page.value ->> 'title')) not between 1 and 30
        or jsonb_array_length(page.value -> 'content' -> 'blocks') > 100
        or length((page.value -> 'content')::text) > 200000
        or exists (select 1 from jsonb_object_keys(page.value) as k(key) where k.key not in ('id', 'title', 'content'))
        or exists (
          -- Every block an object (anything else would stop the page
          -- rendering for members), and no scored questions.
          select 1 from jsonb_array_elements(page.value -> 'content' -> 'blocks') as block(value)
          where jsonb_typeof(block.value) <> 'object'
            or block.value ->> 'type' = 'test_question'
        )
    )
    and (select count(distinct page.value ->> 'id') from jsonb_array_elements(p_pages) as page(value))
      = jsonb_array_length(p_pages)
$$;

alter table public.organisation_learner_workspace_settings
  add constraint learner_workspace_custom_pages_check check (
    private.learner_workspace_custom_pages_valid(custom_pages)
  );

-- Page media for these sections: <organisation id>/page-media/<file>, the
-- same folder the course page editor uploads to. Organisation members
-- (training team) already have broader policies over the organisation's
-- folder; these add its employer admins, scoped to page-media, to image and
-- video files only (the bucket itself takes any type, and .js files there
-- are served from the app's own origin), and to seeing and removing only
-- their own uploads.
create policy "Organisation admins can upload learner workspace page media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[2] = 'page-media'
    and lower(storage.extension(storage.objects.name)) in (
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif',
      'mp4', 'm4v', 'webm', 'mov', 'ogv'
    )
    and exists (
      select 1 from public.organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and public.is_employer_admin(o.id, (select auth.uid()))
    )
  );

-- Removing goes through the Storage API, which needs the object to be
-- visible to the remover -- only their own uploads, so the training team's
-- page-media filenames can't be listed this way.
create policy "Organisation admins can view their own learner workspace page media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[2] = 'page-media'
    and storage.objects.owner_id = (select auth.uid())::text
    and exists (
      select 1 from public.organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and public.is_employer_admin(o.id, (select auth.uid()))
    )
  );

create policy "Organisation admins can remove their own learner workspace page media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-content'
    and (storage.foldername(storage.objects.name))[2] = 'page-media'
    and storage.objects.owner_id = (select auth.uid())::text
    and exists (
      select 1 from public.organisations o
      where o.id::text = (storage.foldername(storage.objects.name))[1]
        and public.is_employer_admin(o.id, (select auth.uid()))
    )
  );
