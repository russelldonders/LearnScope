-- Signup now collects first/last name; rather than adding first_name/
-- last_name columns alongside the existing full_name (a competing
-- representation of the same information), the two values are combined
-- client-side and passed through signUp's user metadata, which this
-- trigger picks up when it creates the profile row -- before email
-- confirmation, since auth.users gets the insert immediately either way.
-- Falls back to whatever a provider (e.g. Google OAuth) already supplies
-- as full_name/name, so that path keeps working exactly as before.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(
      coalesce(
        nullif(trim(concat_ws(' ', new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name')), ''),
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      ),
      ''
    )
  );
  return new;
end;
$$;

-- Gates the first-login wizard: null means "hasn't gone through it yet".
-- Backfilled to "already done" for every existing account below so the
-- wizard only ever appears for accounts created after this migration.
alter table profiles add column onboarding_completed_at timestamptz;

update profiles set onboarding_completed_at = now() where onboarding_completed_at is null;
