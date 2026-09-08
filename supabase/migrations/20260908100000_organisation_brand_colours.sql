-- Employer/provider self-service brand colours: three optional hex colours
-- (primary, secondary, hover) an org admin can set alongside the existing
-- logo/url/about (0081) -- surfaced from the employer console via the same
-- OrganisationSettingsModal already used by ProviderConsole.jsx, since every
-- employer has a 1:1 attached provider organisation (create_employer,
-- 20260902090000) rather than its own branding row. Nullable: unset falls
-- back to the app's existing moss/slate/gold design tokens everywhere these
-- are read (ProviderProfile.jsx), so this is purely additive/opt-in, not a
-- new required step. No RLS policy changes needed -- 0081's "Org admins can
-- update their own organisation" update policy is column-agnostic
-- (is_org_admin(id, auth.uid())) and already covers these.
alter table organisations add column brand_primary_color text;
alter table organisations add column brand_secondary_color text;
alter table organisations add column brand_hover_color text;

alter table organisations add constraint organisations_brand_primary_color_hex
  check (brand_primary_color is null or brand_primary_color ~ '^#[0-9a-fA-F]{6}$');
alter table organisations add constraint organisations_brand_secondary_color_hex
  check (brand_secondary_color is null or brand_secondary_color ~ '^#[0-9a-fA-F]{6}$');
alter table organisations add constraint organisations_brand_hover_color_hex
  check (brand_hover_color is null or brand_hover_color ~ '^#[0-9a-fA-F]{6}$');

-- Re-published with the three brand colours added to the `organisation`
-- object -- everything else is unchanged from 20260905180000's version of
-- this function.
create or replace function get_provider_profile(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'organisation', (
      select json_build_object(
        'id', o.id, 'name', o.name, 'about', o.about, 'logoUrl', o.logo_url, 'url', o.url,
        'brandPrimaryColor', o.brand_primary_color,
        'brandSecondaryColor', o.brand_secondary_color,
        'brandHoverColor', o.brand_hover_color
      )
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
