-- Public provider profile pages: an opt-in, anonymously-readable page at
-- /providers/:slug listing an organisation's offered skills and approved
-- training courses. 0076 deliberately kept offered-skills visibility scoped
-- to org members only ("no learner-facing surface for this yet, not
-- requested") -- this is that request, but still opt-in per-organisation
-- (public_profile_enabled, default false) rather than making every
-- provider's roster public the moment this ships.
alter table organisations add column slug text unique;
alter table organisations add column public_profile_enabled boolean not null default false;

-- Lowercase, non-alphanumeric runs collapsed to a single hyphen, trimmed --
-- e.g. "Acme Training Ltd." -> "acme-training-ltd".
create or replace function slugify_organisation_name(p_name text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'))
$$;

-- Appends -2, -3, ... on collision. p_existing_id excludes the row being
-- (re)slugged itself, so re-running this for an unchanged name doesn't
-- collide with its own current slug.
create or replace function generate_unique_organisation_slug(p_name text, p_existing_id uuid)
returns text
language plpgsql
as $$
declare
  base_slug text := nullif(slugify_organisation_name(p_name), '');
  candidate text;
  suffix int := 1;
begin
  base_slug := coalesce(base_slug, 'provider');
  candidate := base_slug;
  while exists (
    select 1 from organisations
    where slug = candidate and id is distinct from p_existing_id
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;
  return candidate;
end;
$$;

create or replace function set_organisation_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null then
    new.slug := generate_unique_organisation_slug(new.name, new.id);
  end if;
  return new;
end;
$$;

create trigger set_organisation_slug_trigger
  before insert on organisations
  for each row execute procedure set_organisation_slug();

-- Backfill existing organisations one row at a time (not a single bulk
-- UPDATE) so two orgs sharing a name still get distinct slugs -- a
-- statement-level snapshot wouldn't see an earlier row's new slug within
-- the same UPDATE, but each iteration of this loop is its own statement.
do $$
declare
  r record;
begin
  for r in select id, name from organisations where slug is null order by created_at loop
    update organisations set slug = generate_unique_organisation_slug(r.name, r.id) where id = r.id;
  end loop;
end $$;

-- Anonymous-safe read: a single security-definer RPC (same pattern as
-- get_invite_preview, 0010) rather than opening organisations/
-- course_catalogue/organisation_offered_skills RLS to anon directly. Returns
-- null organisation (and empty skills/courses) uniformly whether the slug
-- doesn't exist, the org is inactive, or public_profile_enabled is false --
-- so this can't be used to enumerate which providers exist vs. have opted
-- out.
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
        'duration', cc.duration
      ) order by cc.name), '[]'::json)
      from course_catalogue cc
      join organisations o on o.id = cc.organisation_id
      where o.slug = p_slug and o.status = 'active' and o.public_profile_enabled = true
        and cc.status = 'approved'
    )
  )
$$;

grant execute on function get_provider_profile(text) to anon, authenticated;
