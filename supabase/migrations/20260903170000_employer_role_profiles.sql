-- Employer-owned role templates linked, with learner consent, to a learner-
-- owned current employment record. Linking never transfers ownership of the
-- learner's experience or grants general access to their profile.

create table public.employer_role_profiles (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 5000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index employer_role_profiles_employer_idx
  on public.employer_role_profiles (employer_id, status, name);
create index employer_role_profiles_created_by_idx
  on public.employer_role_profiles (created_by);

create table public.employer_role_profile_skills (
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  library_skill_id uuid not null references public.skill_library(id) on delete restrict,
  target_level integer not null check (target_level between 1 and 5),
  requirement text not null default 'required' check (requirement in ('required', 'recommended')),
  created_at timestamptz not null default now(),
  primary key (role_profile_id, library_skill_id)
);

create index employer_role_profile_skills_library_idx
  on public.employer_role_profile_skills (library_skill_id);

create table public.employer_role_profile_training (
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  catalogue_course_id uuid not null references public.course_catalogue(id) on delete restrict,
  requirement text not null default 'required' check (requirement in ('required', 'recommended')),
  created_at timestamptz not null default now(),
  primary key (role_profile_id, catalogue_course_id)
);

create index employer_role_profile_training_course_idx
  on public.employer_role_profile_training (catalogue_course_id);

create table public.employer_role_assignments (
  id uuid primary key default gen_random_uuid(),
  role_profile_id uuid not null references public.employer_role_profiles(id) on delete cascade,
  employer_member_id uuid not null references public.employer_members(id) on delete cascade,
  learner_experience_id uuid references public.experience(id) on delete set null,
  status text not null default 'proposed'
    check (status in ('proposed', 'linked', 'declined', 'disconnected', 'withdrawn')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  disconnected_at timestamptz,
  unique (role_profile_id, employer_member_id)
);

create index employer_role_assignments_member_idx
  on public.employer_role_assignments (employer_member_id, status);
create index employer_role_assignments_experience_idx
  on public.employer_role_assignments (learner_experience_id)
  where learner_experience_id is not null;
create index employer_role_assignments_proposed_by_idx
  on public.employer_role_assignments (proposed_by);

create or replace function private.can_view_employer_role_profile(
  p_role_profile_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employer_role_profiles rp
    join public.employer_members em on em.employer_id = rp.employer_id
    where rp.id = p_role_profile_id
      and em.user_id = p_user_id
      and em.status = 'active'
  ) or public.is_platform_admin(p_user_id)
$$;

revoke all on function private.can_view_employer_role_profile(uuid, uuid) from public;
grant execute on function private.can_view_employer_role_profile(uuid, uuid) to authenticated;

alter table public.employer_role_profiles enable row level security;
alter table public.employer_role_profile_skills enable row level security;
alter table public.employer_role_profile_training enable row level security;
alter table public.employer_role_assignments enable row level security;

create policy "Active employer members can view role profiles"
  on public.employer_role_profiles for select to authenticated
  using (private.can_view_employer_role_profile(id, (select auth.uid())));

create policy "Employer admins can create role profiles"
  on public.employer_role_profiles for insert to authenticated
  with check (
    public.is_employer_admin(employer_id, (select auth.uid()))
    and created_by = (select auth.uid())
  );

create policy "Employer admins can update role profiles"
  on public.employer_role_profiles for update to authenticated
  using (public.is_employer_admin(employer_id, (select auth.uid())))
  with check (public.is_employer_admin(employer_id, (select auth.uid())));

create policy "Employer admins can remove role profiles"
  on public.employer_role_profiles for delete to authenticated
  using (public.is_employer_admin(employer_id, (select auth.uid())));

create policy "Employer members can view role skill requirements"
  on public.employer_role_profile_skills for select to authenticated
  using (private.can_view_employer_role_profile(role_profile_id, (select auth.uid())));

create policy "Employer admins can add role skill requirements"
  on public.employer_role_profile_skills for insert to authenticated
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can update role skill requirements"
  on public.employer_role_profile_skills for update to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can remove role skill requirements"
  on public.employer_role_profile_skills for delete to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer members can view role training requirements"
  on public.employer_role_profile_training for select to authenticated
  using (private.can_view_employer_role_profile(role_profile_id, (select auth.uid())));

create policy "Employer admins can add role training requirements"
  on public.employer_role_profile_training for insert to authenticated
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can update role training requirements"
  on public.employer_role_profile_training for update to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employer admins can remove role training requirements"
  on public.employer_role_profile_training for delete to authenticated
  using (
    exists (
      select 1 from public.employer_role_profiles rp
      where rp.id = role_profile_id
        and public.is_employer_admin(rp.employer_id, (select auth.uid()))
    )
  );

create policy "Employers and assigned learners can view role assignments"
  on public.employer_role_assignments for select to authenticated
  using (
    exists (
      select 1
      from public.employer_members em
      join public.employer_role_profiles rp
        on rp.id = employer_role_assignments.role_profile_id
      where em.id = employer_role_assignments.employer_member_id
        and em.employer_id = rp.employer_id
        and (
          em.user_id = (select auth.uid())
          or public.is_employer_admin(rp.employer_id, (select auth.uid()))
        )
    )
  );

-- Assignment mutations are RPC-only so neither party can change the other
-- party's fields through the Data API.
grant select, insert, delete on public.employer_role_profiles,
  public.employer_role_profile_skills, public.employer_role_profile_training to authenticated;
grant update (name, description, status, updated_at)
  on public.employer_role_profiles to authenticated;
grant update (target_level, requirement)
  on public.employer_role_profile_skills to authenticated;
grant update (requirement)
  on public.employer_role_profile_training to authenticated;
grant select on public.employer_role_assignments to authenticated;
grant select on public.skill_library, public.course_catalogue, public.experience to authenticated;

create or replace function public.assign_employer_role_profile(
  p_role_profile_id uuid,
  p_employer_member_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_assignment_id uuid;
begin
  select rp.employer_id into v_employer_id
  from public.employer_role_profiles rp
  where rp.id = p_role_profile_id and rp.status = 'active';

  if v_employer_id is null
     or not public.is_employer_admin(v_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  if not exists (
    select 1 from public.employer_members em
    where em.id = p_employer_member_id
      and em.employer_id = v_employer_id
      and em.role = 'member'
      and em.status = 'active'
  ) then
    raise exception 'Choose an active learner from this employer';
  end if;

  insert into public.employer_role_assignments
    (role_profile_id, employer_member_id, proposed_by)
  values (p_role_profile_id, p_employer_member_id, auth.uid())
  on conflict (role_profile_id, employer_member_id) do update
    set status = 'proposed', learner_experience_id = null,
        proposed_by = auth.uid(), proposed_at = now(), decided_at = null,
        disconnected_at = null
    where public.employer_role_assignments.status in ('declined', 'disconnected', 'withdrawn')
  returning id into v_assignment_id;

  if v_assignment_id is null then
    raise exception 'This learner already has a live assignment for this role';
  end if;
  return v_assignment_id;
end
$$;

create or replace function public.decide_employer_role_assignment(
  p_assignment_id uuid,
  p_accept boolean,
  p_learner_experience_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  select em.user_id into v_user_id
  from public.employer_role_assignments a
  join public.employer_members em on em.id = a.employer_member_id
  where a.id = p_assignment_id and a.status = 'proposed';

  if v_user_id is distinct from auth.uid() then
    raise exception 'Pending role assignment not found';
  end if;
  if p_accept and not exists (
    select 1 from public.experience e
    where e.id = p_learner_experience_id
      and e.user_id = auth.uid()
      and e.type = 'employment'
      and e.end_date is null
  ) then
    raise exception 'Choose one of your current employment roles';
  end if;

  update public.employer_role_assignments
  set status = case when p_accept then 'linked' else 'declined' end,
      learner_experience_id = case when p_accept then p_learner_experience_id else null end,
      decided_at = now(), disconnected_at = null
  where id = p_assignment_id;
end
$$;

create or replace function public.disconnect_employer_role_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employer_role_assignments a
  set status = 'disconnected', learner_experience_id = null, disconnected_at = now()
  from public.employer_members em
  where a.id = p_assignment_id
    and em.id = a.employer_member_id
    and em.user_id = auth.uid()
    and a.status = 'linked';
  if not found then raise exception 'Linked role assignment not found'; end if;
end
$$;

create or replace function public.withdraw_employer_role_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.employer_role_assignments a
  set status = 'withdrawn', learner_experience_id = null, disconnected_at = now()
  from public.employer_role_profiles rp
  where a.id = p_assignment_id
    and rp.id = a.role_profile_id
    and public.is_employer_admin(rp.employer_id, auth.uid())
    and a.status in ('proposed', 'linked');
  if not found then raise exception 'Live role assignment not found'; end if;
end
$$;

revoke all on function public.assign_employer_role_profile(uuid, uuid),
  public.decide_employer_role_assignment(uuid, boolean, uuid),
  public.disconnect_employer_role_assignment(uuid),
  public.withdraw_employer_role_assignment(uuid)
from public, anon;
grant execute on function public.assign_employer_role_profile(uuid, uuid),
  public.decide_employer_role_assignment(uuid, boolean, uuid),
  public.disconnect_employer_role_assignment(uuid),
  public.withdraw_employer_role_assignment(uuid)
to authenticated;
