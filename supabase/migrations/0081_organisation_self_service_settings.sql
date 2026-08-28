-- Provider self-service org settings: a logo and an "about us" blurb, plus
-- genuine self-service editing of the website url (0068) -- previously
-- organisations had no update policy at all except for platform admins
-- (0065), so a provider could never edit their own org's url either, only
-- ask a platform admin to do it via AdminProviders.jsx.
alter table organisations add column logo_url text;
alter table organisations add column about text;

-- Additive to (not a replacement for) the existing platform-admin update
-- policy -- RLS can't restrict this to specific columns, so name/status/
-- type stay platform-admin-only via the trigger below instead, same
-- approach as 0065's prevent_self_account_status_change guard on profiles:
-- renaming, deactivating, or changing an org's type has moderation
-- implications (deactivation revokes staff access org-wide, 0069) that
-- should stay a platform decision, while url/logo/about are the org's own
-- identity to manage.
create policy "Org admins can update their own organisation"
  on organisations for update
  to authenticated
  using (is_org_admin(id, auth.uid()))
  with check (is_org_admin(id, auth.uid()));

create or replace function prevent_org_identity_change_by_non_admin()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.status is distinct from old.status
      or new.type is distinct from old.type)
     and auth.uid() is not null
     and not is_platform_admin(auth.uid()) then
    raise exception 'name, status, and type can only be changed by a platform admin';
  end if;
  return new;
end;
$$;

create trigger prevent_org_identity_change_by_non_admin_trigger
  before update on organisations
  for each row execute procedure prevent_org_identity_change_by_non_admin();

-- Org logos: same public-bucket, path-scoped-by-owner pattern as avatars
-- (0004_avatar_and_current_role.sql), scoped by organisation_id instead of
-- user_id. Upload/replace/remove restricted to that organisation's own
-- admins (is_org_admin), matching the Users tab's admin-only gating in the
-- provider console -- trainers can build training/resources but org
-- identity settings are an admin-only action.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "Organisation logos are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'org-logos');

create policy "Org admins can upload their own organisation's logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

create policy "Org admins can replace their own organisation's logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  )
  with check (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );

create policy "Org admins can remove their own organisation's logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'org-logos'
    and exists (
      select 1 from organisations o
      where o.id::text = (storage.foldername(name))[1] and is_org_admin(o.id, auth.uid())
    )
  );
