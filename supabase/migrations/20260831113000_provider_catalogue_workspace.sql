-- Expand provider catalogues into scoped workspaces with skills and role-based users.
alter table catalogue_approvers
  add column role text not null default 'approver'
  check (role in ('admin', 'approver'));

create table catalogue_skills (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  skill_library_id uuid not null references skill_library(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, skill_library_id)
);

create index catalogue_skills_catalogue_idx on catalogue_skills (catalogue_id);
create index catalogue_skills_skill_idx on catalogue_skills (skill_library_id);

create or replace function is_catalogue_admin(p_catalogue_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from catalogue_approvers ca
    join catalogues c on c.id = ca.catalogue_id
    join organisations o on o.id = c.organisation_id
    where ca.catalogue_id = p_catalogue_id
      and ca.user_id = p_user_id
      and ca.role = 'admin'
      and o.status = 'active'
  )
$$;

revoke all on function is_catalogue_admin(uuid, uuid) from public;
grant execute on function is_catalogue_admin(uuid, uuid) to authenticated;

create policy "Catalogue admins can update their catalogue"
  on catalogues for update to authenticated
  using (is_catalogue_admin(id, (select auth.uid())))
  with check (is_catalogue_admin(id, (select auth.uid())));

create policy "Catalogue admins can add catalogue users"
  on catalogue_approvers for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and is_catalogue_admin(catalogue_id, (select auth.uid()))
    and exists (
      select 1 from catalogues c
      join organisation_members om on om.organisation_id = c.organisation_id
      where c.id = catalogue_id and om.user_id = catalogue_approvers.user_id and om.status = 'active'
    )
  );

create policy "Catalogue admins can update catalogue users"
  on catalogue_approvers for update to authenticated
  using (is_catalogue_admin(catalogue_id, (select auth.uid())))
  with check (is_catalogue_admin(catalogue_id, (select auth.uid())));

create policy "Organisation admins can update catalogue users"
  on catalogue_approvers for update to authenticated
  using (
    exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  )
  with check (
    exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  );

create policy "Catalogue admins can remove catalogue users"
  on catalogue_approvers for delete to authenticated
  using (is_catalogue_admin(catalogue_id, (select auth.uid())));

alter table catalogue_skills enable row level security;

create policy "Organisation members can view catalogue skills"
  on catalogue_skills for select to authenticated
  using (
    exists (
      select 1 from catalogues c
      where c.id = catalogue_id and is_org_member(c.organisation_id, (select auth.uid()))
    )
  );

create policy "Catalogue admins manage catalogue skills"
  on catalogue_skills for all to authenticated
  using (
    is_catalogue_admin(catalogue_id, (select auth.uid()))
    or exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
  )
  with check (
    (
      is_catalogue_admin(catalogue_id, (select auth.uid()))
      or exists (select 1 from catalogues c where c.id = catalogue_id and is_org_admin(c.organisation_id, (select auth.uid())))
    )
    and exists (
      select 1
      from catalogues c
      join organisation_offered_skills os on os.organisation_id = c.organisation_id
      where c.id = catalogue_id and os.skill_library_id = catalogue_skills.skill_library_id
    )
  );
