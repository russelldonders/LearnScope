-- A skill target set by an employer (via a role profile's required level,
-- or a direct employer_skill_suggestions.suggested_target_level) should
-- only be treated as "met" once an employer admin has actually confirmed
-- the learner's level -- a bare self-assessment isn't enough for a target
-- someone else set. This is a new, deliberately separate concept from:
--   * skill_targets.set_by_manager -- attributes who *set* a target, says
--     nothing about whether it's been reached or by whom;
--   * manager_team_skill_assessments -- explicitly "not a form of
--     verification exposed anywhere else in the product yet" per its own
--     migration comment, and scoped to a personal manager relationship with
--     no link to employer membership at all;
--   * skill_validation_requests -- peer-to-peer only, driven by the
--     learner inviting a specific validator.
-- History-preserving (insert-only, latest row per employer/user/skill
-- wins), same shape as skill_targets. Creation is RPC-only -- no insert
-- policy at all, mirroring employer_skill_suggestions' own pattern -- so an
-- admin can never write a level to a member outside their own employer.
create table public.employer_skill_confirmations (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  library_skill_id uuid not null references public.skill_library(id) on delete cascade,
  confirmed_level smallint not null check (confirmed_level between 1 and 5),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index employer_skill_confirmations_user_skill_idx
  on public.employer_skill_confirmations (user_id, library_skill_id, created_at desc);
create index employer_skill_confirmations_employer_idx
  on public.employer_skill_confirmations (employer_id, user_id, library_skill_id);

alter table public.employer_skill_confirmations enable row level security;

create policy "Learners view their own employer skill confirmations"
  on public.employer_skill_confirmations for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Employer admins view their own employer's skill confirmations"
  on public.employer_skill_confirmations for select to authenticated
  using (public.is_employer_admin(employer_id, (select auth.uid())));

grant select on public.employer_skill_confirmations to authenticated;

create or replace function public.confirm_employer_skill_level(
  p_employer_id uuid,
  p_user_id uuid,
  p_library_skill_id uuid,
  p_level smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_employer_admin(p_employer_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  if not exists (
    select 1 from public.employer_members
    where employer_id = p_employer_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'Not an active member of this employer';
  end if;

  insert into public.employer_skill_confirmations (employer_id, user_id, library_skill_id, confirmed_level, confirmed_by)
  values (p_employer_id, p_user_id, p_library_skill_id, p_level, auth.uid());
end
$$;

revoke all on function public.confirm_employer_skill_level(uuid, uuid, uuid, smallint) from public, anon;
grant execute on function public.confirm_employer_skill_level(uuid, uuid, uuid, smallint) to authenticated;
