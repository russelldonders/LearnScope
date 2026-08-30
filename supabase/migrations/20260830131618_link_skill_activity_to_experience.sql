-- A logged skill activity can optionally happen within a specific work,
-- education, subject, project, or other experience. The xAPI statement keeps
-- the portable context extension; this column is its queryable mirror.

alter table public.xapi_statements
  add column experience_id uuid references public.experience(id) on delete set null;

create index xapi_statements_experience_id_recorded_at_idx
  on public.xapi_statements (experience_id, recorded_at desc)
  where experience_id is not null;

create or replace function public.validate_xapi_statement_context_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.skill_id is not null and not exists (
    select 1 from public.skills
    where id = new.skill_id and user_id = new.user_id
  ) then
    raise exception 'Activity skill must belong to the same user';
  end if;

  if new.experience_id is not null and not exists (
    select 1 from public.experience
    where id = new.experience_id and user_id = new.user_id
  ) then
    raise exception 'Activity experience must belong to the same user';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_xapi_statement_context_ownership() from public;

create trigger validate_xapi_statement_context_ownership_before_write
before insert or update of user_id, skill_id, experience_id
on public.xapi_statements
for each row execute function public.validate_xapi_statement_context_ownership();
