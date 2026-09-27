-- Consolidate the former employer/provider workspace distinction into one
-- organisation workspace. Capabilities describe what an organisation can do;
-- memberships remain separate grants because workforce data and learning
-- authoring have different security boundaries.

create table organisation_capabilities (
  organisation_id uuid not null references organisations(id) on delete cascade,
  capability text not null check (capability in (
    'employs_people',
    'manages_workforce_development',
    'authors_learning',
    'supplies_learning_externally'
  )),
  status text not null default 'active' check (status in ('active', 'inactive')),
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users(id) on delete set null,
  primary key (organisation_id, capability)
);

create index organisation_capabilities_active_idx
  on organisation_capabilities (organisation_id, capability)
  where status = 'active';

alter table organisation_capabilities enable row level security;
grant select on organisation_capabilities to authenticated;

create policy "Members can view their organisation capabilities"
  on organisation_capabilities for select
  to authenticated
  using (
    exists (
      select 1
      from organisation_members om
      where om.organisation_id = organisation_capabilities.organisation_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
    )
    or exists (
      select 1
      from employers e
      join employer_members em on em.employer_id = e.id
      where e.provider_organisation_id = organisation_capabilities.organisation_id
        and em.user_id = (select auth.uid())
        and em.status = 'active'
    )
    or exists (
      select 1 from platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

-- Every existing organisation is already a learning-content owner. Employer-
-- backed organisations additionally gain workforce capabilities. An
-- organisation may carry both sets: that is the central purpose of this
-- model, rather than creating parallel employer and provider identities.
insert into organisation_capabilities (organisation_id, capability)
select id, capability
from organisations
cross join lateral (
  values ('authors_learning'), ('supplies_learning_externally')
) capabilities(capability)
on conflict (organisation_id, capability) do nothing;

insert into organisation_capabilities (organisation_id, capability)
select distinct e.provider_organisation_id, capability
from employers e
cross join lateral (
  values ('employs_people'), ('manages_workforce_development')
) capabilities(capability)
where e.provider_organisation_id is not null
on conflict (organisation_id, capability) do nothing;

-- Replace the short-lived employer/provider navigation abstraction with a
-- durable organisation owner. Learning profiles continue to be employer-
-- scoped: this migration changes workspace identity, not learner-data
-- ownership or its RLS boundary.
alter table workspaces add column organisation_id uuid references organisations(id) on delete cascade;

update workspaces w
set organisation_id = coalesce(w.provider_organisation_id, e.provider_organisation_id),
    workspace_type = 'organisation'
from employers e
where w.workspace_type = 'employer'
  and e.id = w.employer_id;

update workspaces
set organisation_id = provider_organisation_id,
    workspace_type = 'organisation'
where workspace_type = 'provider';

alter table workspaces drop constraint if exists workspaces_owner_shape_check;
alter table workspaces drop constraint if exists workspaces_workspace_type_check;
drop index if exists workspaces_employer_idx;
drop index if exists workspaces_provider_organisation_idx;
alter table workspaces drop column employer_id;
alter table workspaces drop column provider_organisation_id;

alter table workspaces
  add constraint workspaces_workspace_type_check
  check (workspace_type in ('personal', 'manager', 'organisation', 'platform_admin'));

alter table workspaces
  add constraint workspaces_owner_shape_check
  check (
    (workspace_type = 'personal'
      and personal_profile_id is not null
      and owner_person_id is not null
      and organisation_id is null)
    or (workspace_type = 'manager'
      and personal_profile_id is null
      and owner_person_id is not null
      and organisation_id is null)
    or (workspace_type = 'organisation'
      and personal_profile_id is null
      and owner_person_id is null
      and organisation_id is not null)
    or (workspace_type = 'platform_admin'
      and personal_profile_id is null
      and owner_person_id is null
      and organisation_id is null)
  );

create index workspaces_organisation_idx
  on workspaces (organisation_id, status)
  where organisation_id is not null;

-- One canonical workspace per organisation. Reuse the organisation UUID to
-- make the backfill deterministic and keep later membership grants simple.
insert into workspaces (id, workspace_type, name, organisation_id)
select o.id, 'organisation', o.name, o.id
from organisations o
where not exists (
  select 1 from workspaces w
  where w.workspace_type = 'organisation'
    and w.organisation_id = o.id
)
on conflict (id) do nothing;

alter table workspace_access drop constraint if exists workspace_access_access_role_check;
update workspace_access set access_role = 'organisation_admin' where access_role = 'lms_admin';
update workspace_access set access_role = 'content_editor' where access_role = 'provider';
update workspace_access set access_role = 'member' where access_role = 'employee';

alter table workspace_access
  add constraint workspace_access_access_role_check
  check (access_role in (
    'owner', 'member', 'manager', 'organisation_admin', 'content_editor', 'platform_admin'
  ));

insert into workspace_access (workspace_id, auth_account_id, access_role)
select w.id, paa.id,
  case when om.role = 'admin' then 'organisation_admin' else 'content_editor' end
from organisation_members om
join workspaces w
  on w.organisation_id = om.organisation_id
 and w.workspace_type = 'organisation'
join person_auth_accounts paa on paa.auth_user_id = om.user_id
where om.status = 'active'
on conflict (workspace_id, auth_account_id, access_role) do nothing;

insert into workspace_access (workspace_id, auth_account_id, access_role)
select w.id, paa.id,
  case when em.role = 'admin' then 'organisation_admin' else 'member' end
from employer_members em
join employers e on e.id = em.employer_id
join workspaces w
  on w.organisation_id = e.provider_organisation_id
 and w.workspace_type = 'organisation'
join person_auth_accounts paa on paa.auth_user_id = em.user_id
where em.status = 'active'
on conflict (workspace_id, auth_account_id, access_role) do nothing;
