-- Durable hand-off between short browser requests and long-running AI course
-- generation. Course drafts are available only to the service-role API; the
-- browser receives them through a caller-verified status endpoint.
create table public.skill_course_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  skill_library_id uuid not null references public.skill_library(id) on delete cascade,
  knowledge_level smallint not null check (knowledge_level between 1 and 5),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  draft jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (draft is null or jsonb_typeof(draft) = 'object'),
  check (
    (status = 'completed' and draft is not null and completed_at is not null)
    or (status <> 'completed' and draft is null)
  ),
  check (
    (status in ('completed', 'failed', 'cancelled') and completed_at is not null)
    or (status in ('queued', 'running') and completed_at is null)
  )
);

create index skill_course_generation_jobs_requester_created_idx
  on public.skill_course_generation_jobs (requested_by, created_at desc);

create index skill_course_generation_jobs_organisation_idx
  on public.skill_course_generation_jobs (organisation_id);

create index skill_course_generation_jobs_skill_idx
  on public.skill_course_generation_jobs (skill_library_id);

create index skill_course_generation_jobs_expiry_idx
  on public.skill_course_generation_jobs (expires_at);

alter table public.skill_course_generation_jobs enable row level security;

-- No browser role can read generated drafts directly. The serverless API uses
-- service_role after independently verifying the caller and job ownership.
revoke all on table public.skill_course_generation_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.skill_course_generation_jobs to service_role;
