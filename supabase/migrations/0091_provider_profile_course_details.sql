-- The public provider page's course tiles should look like the catalogue's
-- own browse card (same skill/tag chips), not a stripped-down summary --
-- replace get_provider_profile's courses branch to also aggregate
-- course_catalogue_skills/course_catalogue_tags per course, matching what
-- src/lib/courseCatalogue.js's listCatalogueCourses() already returns for
-- these same rows.
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
        'id', o.id,
        'name', o.name,
        'about', o.about,
        'logoUrl', o.logo_url,
        'url', o.url
      )
      from organisations o
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'skills', (
      select coalesce(json_agg(json_build_object(
        'id', sl.id,
        'name', sl.name,
        'category', sl.category,
        'description', sl.description
      ) order by sl.name), '[]'::json)
      from organisation_offered_skills oos
      join skill_library sl on sl.id = oos.skill_library_id
      join organisations o on o.id = oos.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
    ),
    'courses', (
      select coalesce(json_agg(json_build_object(
        'id', cc.id,
        'name', cc.name,
        'synopsis', cc.synopsis,
        'courseType', cc.course_type,
        'duration', cc.duration,
        'skillEntries', (
          select coalesce(json_agg(json_build_object(
            'skillId', ccs.skill_library_id,
            'skillName', sl2.name,
            'level', ccs.level
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
        )
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;
