-- Organisations can add their own sections to their learner workspace: each
-- is a simple page (a title and plain-text content) that sits in the
-- section order alongside Home, My learning, Catalogue and Role & skills,
-- and can be hidden or chosen as the landing section like them.
--
-- Pages live on the organisation's existing settings row (0325) as
-- custom_pages -- they're part of how the workspace is presented, saved
-- with the rest of it, not a separate kind of record. Each is keyed
-- 'page-<uuid>', which is what section_order, hidden_sections and
-- landing_section refer to.
--
-- Additive: existing rows get custom_pages = '[]', and every row valid under
-- 0325's section checks is valid under the combined check below.

alter table public.organisation_learner_workspace_settings
  add column custom_pages jsonb not null default '[]'::jsonb;

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
        or jsonb_typeof(page.value -> 'body') is distinct from 'string'
        or (page.value ->> 'id') !~ '^page-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or length(btrim(page.value ->> 'title')) not between 1 and 30
        or length(page.value ->> 'body') > 10000
        or exists (select 1 from jsonb_object_keys(page.value) as k(key) where k.key not in ('id', 'title', 'body'))
    )
    and (select count(distinct page.value ->> 'id') from jsonb_array_elements(p_pages) as page(value))
      = jsonb_array_length(p_pages)
$$;

-- Every built-in section and every custom page exactly once in the order;
-- only My learning, Catalogue, Role & skills and custom pages can be hidden;
-- members land on a section that's in the order and shown.
create or replace function private.learner_workspace_sections_valid(
  p_order text[],
  p_hidden text[],
  p_landing text,
  p_pages jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with page_ids as (
    select coalesce(array_agg(page.value ->> 'id'), '{}') as ids
    from jsonb_array_elements(case when jsonb_typeof(p_pages) = 'array' then p_pages else '[]'::jsonb end) as page(value)
  )
  select array_position(p_order, null) is null
    and cardinality(p_order) = (select count(distinct s) from unnest(p_order) as s)
    and p_order @> array['home', 'learning', 'catalogue', 'role']
    and p_order <@ (array['home', 'learning', 'catalogue', 'role'] || page_ids.ids)
    and cardinality(p_order) = 4 + cardinality(page_ids.ids)
    and array_position(p_hidden, null) is null
    and p_hidden <@ (array['learning', 'catalogue', 'role'] || page_ids.ids)
    and p_landing = any(p_order)
    and not (p_landing = any(p_hidden))
  from page_ids
$$;

grant execute on function private.learner_workspace_custom_pages_valid(jsonb) to authenticated;
grant execute on function private.learner_workspace_sections_valid(text[], text[], text, jsonb) to authenticated;

alter table public.organisation_learner_workspace_settings
  drop constraint learner_workspace_section_order_check,
  drop constraint learner_workspace_hidden_sections_check,
  drop constraint learner_workspace_landing_section_check,
  add constraint learner_workspace_custom_pages_check check (
    private.learner_workspace_custom_pages_valid(custom_pages)
  ),
  add constraint learner_workspace_sections_check check (
    private.learner_workspace_sections_valid(section_order, hidden_sections, landing_section, custom_pages)
  );

-- Members read the new column like the rest (updated_by stays unreadable).
grant select (custom_pages) on public.organisation_learner_workspace_settings to authenticated;
