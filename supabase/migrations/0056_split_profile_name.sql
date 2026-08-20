-- Splits the single full_name field into first_name/last_name so the
-- profile edit form (and CV import) can work with them separately,
-- matching what signup already collects. full_name becomes a generated
-- column derived from the two rather than a second stored copy -- the
-- dozen+ read-only call sites across the app (AppHeader, connections,
-- validation requests, etc.) all just SELECT full_name for display, so
-- keeping it as a real, always-in-sync column means none of them need to
-- change; only the few places that write a name needed updating.

alter table profiles add column first_name text;
alter table profiles add column last_name text;

-- Backfill from the existing full_name: first word -> first_name, the
-- remainder -> last_name. Collapses repeated internal whitespace (e.g.
-- "John   Smith") to a single space first, so the regenerated full_name
-- below reproduces the original faithfully rather than just approximately.
update profiles
set
  first_name = split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 1),
  last_name = nullif(
    trim(substring(
      regexp_replace(trim(full_name), '\s+', ' ', 'g')
      from length(split_part(regexp_replace(trim(full_name), '\s+', ' ', 'g'), ' ', 1)) + 1
    )),
    ''
  )
where full_name is not null and trim(full_name) <> '';

-- validator_directory (0051) selects profiles.full_name directly, which
-- blocks dropping the column outright -- drop and recreate it around the
-- swap instead of CASCADE, so the validator-discovery feature keeps working
-- unchanged rather than silently losing the view.
drop view validator_directory;

-- concat_ws() is STABLE, not IMMUTABLE (its variadic "any" signature can't
-- be proven side-effect-free), so it's rejected in a generated column
-- expression -- plain || concatenation with coalesce-to-'' is immutable
-- and gives the same result for two text columns.
alter table profiles drop column full_name;
alter table profiles add column full_name text
  generated always as (
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
  ) stored;

create view validator_directory
  with (security_invoker = true)
as
select
  s.id as skill_id,
  s.user_id as validator_id,
  s.library_skill_id,
  s.level,
  s.lifecycle_stage,
  s.offer_validate_connections,
  s.offer_validate_others,
  p.full_name,
  p.avatar_url,
  is_connected(auth.uid(), s.user_id) as is_connection
from skills s
join profiles p on p.id = s.user_id
where s.lifecycle_stage in ('validated', 'maintained')
  and s.user_id != auth.uid()
  and (
    s.offer_validate_others = true
    or (s.offer_validate_connections = true and is_connected(auth.uid(), s.user_id))
  );

grant select on validator_directory to authenticated;

-- full_name being generated can no longer be inserted into directly, so
-- this now writes first_name/last_name. For OAuth providers (e.g. Google)
-- that only supply a combined name, falls back to splitting it the same
-- way the backfill above did.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
  v_provider_name text;
begin
  v_first_name := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last_name := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');

  if v_first_name is null and v_last_name is null then
    v_provider_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), '');
    if v_provider_name is not null then
      v_provider_name := regexp_replace(v_provider_name, '\s+', ' ', 'g');
      v_first_name := split_part(v_provider_name, ' ', 1);
      v_last_name := nullif(trim(substring(v_provider_name from length(v_first_name) + 1)), '');
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name)
  values (new.id, v_first_name, v_last_name);

  return new;
end;
$$;
