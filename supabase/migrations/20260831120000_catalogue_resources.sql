-- Allow an organisation resource to be assigned to one or more catalogues
-- without duplicating or transferring ownership of the underlying resource.
create table catalogue_resources (
  id uuid primary key default gen_random_uuid(),
  catalogue_id uuid not null references catalogues(id) on delete cascade,
  resource_id uuid not null references content_resources(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (catalogue_id, resource_id)
);

create index catalogue_resources_catalogue_idx on catalogue_resources (catalogue_id);
create index catalogue_resources_resource_idx on catalogue_resources (resource_id);

alter table catalogue_resources enable row level security;

revoke all on table catalogue_resources from anon, authenticated;
grant select, insert, delete on table catalogue_resources to authenticated;

create policy "Organisation members can view catalogue resources"
  on catalogue_resources for select to authenticated
  using (
    exists (
      select 1
      from catalogues c
      where c.id = catalogue_resources.catalogue_id
        and is_org_member(c.organisation_id, (select auth.uid()))
    )
  );

create policy "Catalogue admins can assign resources"
  on catalogue_resources for insert to authenticated
  with check (
    is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid()))
    and catalogue_resources.created_by = (select auth.uid())
    and exists (
      select 1
      from catalogues c
      join content_resources cr on cr.organisation_id = c.organisation_id
      where c.id = catalogue_resources.catalogue_id
        and cr.id = catalogue_resources.resource_id
    )
  );

create policy "Catalogue admins can unassign resources"
  on catalogue_resources for delete to authenticated
  using (is_catalogue_admin(catalogue_resources.catalogue_id, (select auth.uid())));
