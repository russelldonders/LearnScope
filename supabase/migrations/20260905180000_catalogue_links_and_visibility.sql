-- Two independent additions to the provider-catalogue model (0111/0112):
--
-- 1. catalogue_links: a provider can "link" another provider's existing
--    catalogue to offer it alongside their own. Deliberately a plain
--    reference/association only, mirroring how employer_provider_links
--    (20260902090000-era) already links an employer to a provider org --
--    linking grants no cross-org write access at all: only the owning
--    catalogue's own admins/approvers (catalogue_approvers) can add courses
--    to it or manage it, and submit_course_for_publication's own
--    organisation_id/is_global check is untouched, so a course still can't
--    be submitted into a catalogue it doesn't already own. Unilateral, no
--    consent step -- catalogues are already fully readable by any
--    authenticated user (0111's "Authenticated users can view catalogues"),
--    so this doesn't expose anything that wasn't already visible.
--
-- 2. catalogues.learner_visible: per-catalogue backend-only vs learner-
--    facing flag. Doesn't introduce a new public route -- a learner-facing
--    catalogue's courses simply become eligible to appear on its owning
--    org's existing public profile page (get_provider_profile, 0090/0107),
--    and on the profile of any org that has linked it ("offer alongside
--    their own"). A catalogue defaults to backend-only (false): today's
--    get_provider_profile shows every approved+current course regardless of
--    catalogue, so this migration also tightens that to only courses
--    actually published to a learner-visible catalogue -- see the
--    function's own comment below for why that's the correct behaviour
--    change to bundle with this rather than a separate migration.

alter table catalogues add column learner_visible boolean not null default false;

create table catalogue_links (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  organisation_id uuid not null references organisations(id) on delete cascade,
  linked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, organisation_id)
);

create index catalogue_links_organisation_idx on catalogue_links (organisation_id);
create index catalogue_links_catalogue_idx on catalogue_links (catalogue_id);

-- Guards what a plain insert policy can't express cleanly: never the Global
-- catalogue (already universally available -- linking it would just be
-- confusing noise) and never an org linking its own catalogue to itself
-- (that's just "own", not "linked").
create or replace function guard_catalogue_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalogue catalogues%rowtype;
begin
  select * into v_catalogue from catalogues where id = new.catalogue_id;
  if v_catalogue.is_global then
    raise exception 'The Global catalogue is already available to everyone and cannot be linked';
  end if;
  if v_catalogue.organisation_id = new.organisation_id then
    raise exception 'An organisation cannot link its own catalogue';
  end if;
  return new;
end;
$$;

create trigger guard_catalogue_link_trigger
  before insert on catalogue_links
  for each row execute procedure guard_catalogue_link();

alter table catalogue_links enable row level security;

create policy "Authenticated users can view catalogue links"
  on catalogue_links for select
  to authenticated
  using (true);

create policy "Org admins can link a catalogue to their own organisation"
  on catalogue_links for insert
  to authenticated
  with check (
    linked_by = (select auth.uid())
    and is_org_admin(organisation_id, (select auth.uid()))
  );

create policy "Org admins can remove their own organisation's catalogue links"
  on catalogue_links for delete
  to authenticated
  using (is_org_admin(organisation_id, (select auth.uid())));

grant select, insert, delete on table catalogue_links to authenticated;

-- Rewritten to gate visibility on learner_visible (see migration comment
-- above) and to fold in courses reached via a linked catalogue -- each
-- course's own `catalogues` array names which of this org's own/linked
-- learner-visible catalogues actually carries it, so the profile page can
-- show that without a dedicated per-catalogue browse page.
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object('id', o.id, 'name', o.name, 'about', o.about, 'logoUrl', o.logo_url, 'url', o.url)
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id, 'name', sl.name, 'category', sl.category, 'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(entry.course_json order by entry.course_name), '[]'::json)
      from (
        -- This org's own approved courses, published to at least one of
        -- its own learner-visible catalogues.
        select cc.name as course_name, json_build_object(
          'id', cc.id, 'name', cc.name, 'synopsis', cc.synopsis,
          'courseType', cc.course_type, 'duration', cc.duration,
          'imageUrl', cc.image_url, 'courseCode', cc.course_code,
          'versionNumber', cc.version_number,
          'skillEntries', (
            select coalesce(json_agg(json_build_object(
              'skillId', ccs.skill_library_id, 'skillName', sl2.name, 'level', ccs.level
            )), '[]'::json)
            from course_catalogue_skills ccs
            join skill_library sl2 on sl2.id = ccs.skill_library_id
            where ccs.course_catalogue_id = cc.id
          ),
          'tags', (
            select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)), '[]'::json)
            from course_catalogue_tags cct
            join tags t on t.id = cct.tag_id
            where cct.course_catalogue_id = cc.id
          ),
          'catalogues', (
            select coalesce(json_agg(json_build_object('id', cat.id, 'name', cat.name) order by cat.name), '[]'::json)
            from course_catalogue_publications ccp
            join catalogues cat on cat.id = ccp.catalogue_id
            where ccp.course_id = cc.id
              and ccp.published_at is not null
              and cat.learner_visible
              and cat.organisation_id = cc.organisation_id
          )
        ) as course_json
        from course_catalogue cc
        join organisations o on o.id = cc.organisation_id
        where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
          and cc.status = 'approved' and cc.is_current_published
          and exists (
            select 1
            from course_catalogue_publications ccp2
            join catalogues cat2 on cat2.id = ccp2.catalogue_id
            where ccp2.course_id = cc.id
              and ccp2.published_at is not null
              and cat2.learner_visible
              and cat2.organisation_id = cc.organisation_id
          )

        -- union all, not union: json has no equality operator to dedupe
        -- with, and a genuine duplicate here would need this org to have
        -- linked two different catalogues that both happen to carry the
        -- exact same course -- rare enough not to be worth casting every
        -- json_build_object result to jsonb just to dedupe against it.
        union all

        -- Another provider's course, reached because this org has linked
        -- one of that provider's own learner-visible catalogues -- "offer
        -- alongside their own".
        select cc3.name, json_build_object(
          'id', cc3.id, 'name', cc3.name, 'synopsis', cc3.synopsis,
          'courseType', cc3.course_type, 'duration', cc3.duration,
          'imageUrl', cc3.image_url, 'courseCode', cc3.course_code,
          'versionNumber', cc3.version_number,
          'skillEntries', (
            select coalesce(json_agg(json_build_object(
              'skillId', ccs3.skill_library_id, 'skillName', sl3.name, 'level', ccs3.level
            )), '[]'::json)
            from course_catalogue_skills ccs3
            join skill_library sl3 on sl3.id = ccs3.skill_library_id
            where ccs3.course_catalogue_id = cc3.id
          ),
          'tags', (
            select coalesce(json_agg(json_build_object('id', t3.id, 'name', t3.name)), '[]'::json)
            from course_catalogue_tags cct3
            join tags t3 on t3.id = cct3.tag_id
            where cct3.course_catalogue_id = cc3.id
          ),
          'catalogues', json_build_array(json_build_object('id', linked_cat.id, 'name', linked_cat.name))
        )
        from organisations o4
        join catalogue_links cl on cl.organisation_id = o4.id
        join catalogues linked_cat on linked_cat.id = cl.catalogue_id and linked_cat.learner_visible
        join course_catalogue_publications ccp3 on ccp3.catalogue_id = linked_cat.id and ccp3.published_at is not null
        join course_catalogue cc3 on cc3.id = ccp3.course_id and cc3.status = 'approved' and cc3.is_current_published
        where o4.slug = p_slug and o4.status = 'active' and o4.public_profile_enabled = true
      ) entry
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;
