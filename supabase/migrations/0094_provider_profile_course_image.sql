-- The public provider page (0091) built its course tiles before 0093 added
-- course_catalogue.image_url -- surface it here too, the same way 0091
-- added skill/tag chips, so an uploaded course image replaces
-- CourseThumbnail's placeholder on the public page exactly as it already
-- does on the learner-facing catalogue (src/lib/courseCatalogue.js, a plain
-- `select *` that already carries the new column with no query change
-- needed there).
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
        'imageUrl', cc.image_url,
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
