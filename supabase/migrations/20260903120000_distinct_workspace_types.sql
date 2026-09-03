-- Clarify that workspace is an access/navigation abstraction above the
-- existing employer and provider domains. `organisations` continues to mean
-- training-provider organisations; `employers` continues to mean company LMS
-- tenants. No third organisation-like business entity is introduced.

alter table workspaces drop constraint workspaces_check;
alter table workspaces drop constraint workspaces_workspace_type_check;

alter table workspaces
  add column provider_organisation_id uuid references organisations(id) on delete cascade;

-- No non-personal workspaces exist yet, but retain this conversion so the
-- migration is safe if an integration environment created one early.
update workspaces
set workspace_type = 'employer'
where workspace_type = 'organisation';

alter table workspaces
  add constraint workspaces_workspace_type_check
  check (workspace_type in ('personal', 'manager', 'employer', 'provider', 'platform_admin'));

alter table workspaces
  add constraint workspaces_owner_shape_check
  check (
    (workspace_type = 'personal'
      and personal_profile_id is not null
      and owner_person_id is not null
      and employer_id is null
      and provider_organisation_id is null)
    or (workspace_type = 'manager'
      and personal_profile_id is null
      and owner_person_id is not null
      and employer_id is null
      and provider_organisation_id is null)
    or (workspace_type = 'employer'
      and personal_profile_id is null
      and owner_person_id is null
      and employer_id is not null
      and provider_organisation_id is null)
    or (workspace_type = 'provider'
      and personal_profile_id is null
      and owner_person_id is null
      and employer_id is null
      and provider_organisation_id is not null)
    or (workspace_type = 'platform_admin'
      and personal_profile_id is null
      and owner_person_id is null
      and employer_id is null
      and provider_organisation_id is null)
  );

create index workspaces_provider_organisation_idx
  on workspaces (provider_organisation_id, status)
  where provider_organisation_id is not null;

