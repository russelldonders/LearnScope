-- Cancellation and course saving must contend on the same locked job row.
-- Whichever transaction claims a completed job first determines whether a
-- course is saved or the job is cancelled.
alter table public.skill_course_generation_jobs
  -- A saved job is only a record of the hand-off, so it goes with its course
  -- (set null would break the saved-needs-a-course check below).
  add column course_id uuid references public.course_catalogue(id) on delete cascade;

create index skill_course_generation_jobs_course_idx
  on public.skill_course_generation_jobs (course_id)
  where course_id is not null;

alter table public.skill_course_generation_jobs
  drop constraint skill_course_generation_jobs_status_check,
  drop constraint skill_course_generation_jobs_check,
  drop constraint skill_course_generation_jobs_check1;

alter table public.skill_course_generation_jobs
  add constraint skill_course_generation_jobs_status_check
    check (status in ('queued', 'running', 'completed', 'saving', 'saved', 'failed', 'cancelled')),
  add constraint skill_course_generation_jobs_draft_state_check
    check (
      (status in ('completed', 'saving') and draft is not null)
      or (status not in ('completed', 'saving') and draft is null)
    ),
  add constraint skill_course_generation_jobs_completed_state_check
    check (
      (status in ('queued', 'running') and completed_at is null)
      or (status not in ('queued', 'running') and completed_at is not null)
    ),
  add constraint skill_course_generation_jobs_course_state_check
    check (
      (status = 'saved' and course_id is not null)
      or (status <> 'saved' and course_id is null)
    );

create or replace function public.save_generated_skill_course_job(
  p_job_id uuid,
  p_publish_global boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_job public.skill_course_generation_jobs%rowtype;
  v_course_id uuid;
begin
  if v_caller is null or not public.is_platform_admin(v_caller) then
    raise insufficient_privilege using message = 'Platform administrator access required';
  end if;

  select *
  into v_job
  from public.skill_course_generation_jobs
  where id = p_job_id
    and requested_by = v_caller
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Generation job not found or expired';
  end if;
  if v_job.status = 'saved' then
    return v_job.course_id;
  end if;
  if v_job.status = 'cancelled' then
    raise exception 'Course build was aborted';
  end if;
  if v_job.status <> 'completed' then
    raise exception 'The generated course is not ready to save';
  end if;

  update public.skill_course_generation_jobs
  set status = 'saving', updated_at = now()
  where id = p_job_id;

  v_course_id := public.create_generated_skill_course(
    v_job.skill_library_id,
    v_job.knowledge_level,
    v_job.draft,
    p_publish_global
  );

  update public.skill_course_generation_jobs
  set status = 'saved',
      draft = null,
      course_id = v_course_id,
      updated_at = now()
  where id = p_job_id;

  return v_course_id;
end;
$$;

revoke all on function public.save_generated_skill_course_job(uuid, boolean)
  from public, anon;
grant execute on function public.save_generated_skill_course_job(uuid, boolean)
  to authenticated;

