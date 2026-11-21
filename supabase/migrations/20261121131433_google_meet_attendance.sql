-- Google Meet integration for scheduled course cohort sessions. OAuth
-- credentials stay in external_connections (which deliberately has no
-- client-readable policies); the tables below contain only launch metadata
-- and imported attendance evidence.

alter table public.external_connections
  drop constraint external_connections_provider_check;

alter table public.external_connections
  add constraint external_connections_provider_check
  check (provider in ('strava', 'google'));

create unique index external_connections_google_account_unique
  on public.external_connections (provider_account_id)
  where provider = 'google';

create table public.course_session_google_meet (
  session_id uuid primary key references public.course_cohort_sessions(id) on delete cascade,
  google_space_name text not null unique check (google_space_name ~ '^spaces/[A-Za-z0-9_-]+$'),
  meeting_uri text not null check (meeting_uri ~ '^https://meet\.google\.com/'),
  organizer_user_id uuid references auth.users(id) on delete set null,
  sync_status text not null default 'ready'
    check (sync_status in ('ready', 'syncing', 'synced', 'error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index course_session_google_meet_organizer_idx
  on public.course_session_google_meet (organizer_user_id)
  where organizer_user_id is not null;

create table public.google_meet_conferences (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.course_cohort_sessions(id) on delete cascade,
  google_conference_name text not null unique,
  started_at timestamptz not null,
  ended_at timestamptz,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index google_meet_conferences_session_started_idx
  on public.google_meet_conferences (session_id, started_at desc);

create table public.google_meet_attendance_segments (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.google_meet_conferences(id) on delete cascade,
  google_participant_name text not null,
  google_participant_session_name text not null unique,
  google_user_id text,
  matched_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  joined_at timestamptz not null,
  left_at timestamptz,
  participant_kind text not null
    check (participant_kind in ('signed_in', 'anonymous', 'phone')),
  imported_at timestamptz not null default now()
);

create index google_meet_attendance_segments_conference_idx
  on public.google_meet_attendance_segments (conference_id, joined_at);

create index google_meet_attendance_segments_google_user_idx
  on public.google_meet_attendance_segments (google_user_id)
  where google_user_id is not null;

create index google_meet_attendance_segments_matched_user_idx
  on public.google_meet_attendance_segments (matched_user_id)
  where matched_user_id is not null;

create table public.course_session_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.course_cohort_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attended_seconds integer not null default 0 check (attended_seconds >= 0),
  attendance_percent numeric(5,2) not null default 0
    check (attendance_percent >= 0 and attendance_percent <= 100),
  first_joined_at timestamptz,
  last_left_at timestamptz,
  calculation_status text not null default 'provisional'
    check (calculation_status in ('provisional', 'final')),
  calculated_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index course_session_attendance_user_idx
  on public.course_session_attendance (user_id, calculated_at desc);

create table public.course_session_launches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.course_cohort_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  launched_at timestamptz not null default now()
);

create index course_session_launches_session_user_idx
  on public.course_session_launches (session_id, user_id, launched_at desc);

alter table public.course_session_google_meet enable row level security;
alter table public.google_meet_conferences enable row level security;
alter table public.google_meet_attendance_segments enable row level security;
alter table public.course_session_attendance enable row level security;
alter table public.course_session_launches enable row level security;

-- Enrolled learners can read the meeting they are due to attend. Course
-- organisation members and platform admins can also read it for delivery
-- and support. Writes remain server-only through the service-role API.
create policy "View Google Meet details for an accessible cohort session"
  on public.course_session_google_meet for select
  to authenticated
  using (
    exists (
      select 1
      from public.course_cohort_sessions session
      join public.course_cohorts cohort on cohort.id = session.cohort_id
      join public.course_catalogue course on course.id = cohort.course_catalogue_id
      where session.id = course_session_google_meet.session_id
        and (
          is_platform_admin((select auth.uid()))
          or (course.organisation_id is not null and is_org_member(course.organisation_id, (select auth.uid())))
          or exists (
            select 1 from public.courses enrolment
            where enrolment.cohort_id = cohort.id
              and enrolment.user_id = (select auth.uid())
              and enrolment.status is null
          )
        )
    )
  );

-- Raw conference and participant evidence is visible only to the course's
-- delivery organisation (and platform admins), never to other attendees.
create policy "Course organisation members view Meet conferences"
  on public.google_meet_conferences for select
  to authenticated
  using (
    exists (
      select 1
      from public.course_cohort_sessions session
      join public.course_cohorts cohort on cohort.id = session.cohort_id
      join public.course_catalogue course on course.id = cohort.course_catalogue_id
      where session.id = google_meet_conferences.session_id
        and (
          is_platform_admin((select auth.uid()))
          or (course.organisation_id is not null and is_org_member(course.organisation_id, (select auth.uid())))
        )
    )
  );

create policy "Course organisation members view Meet attendance evidence"
  on public.google_meet_attendance_segments for select
  to authenticated
  using (
    exists (
      select 1
      from public.google_meet_conferences conference
      join public.course_cohort_sessions session on session.id = conference.session_id
      join public.course_cohorts cohort on cohort.id = session.cohort_id
      join public.course_catalogue course on course.id = cohort.course_catalogue_id
      where conference.id = google_meet_attendance_segments.conference_id
        and (
          is_platform_admin((select auth.uid()))
          or (course.organisation_id is not null and is_org_member(course.organisation_id, (select auth.uid())))
        )
    )
  );

create policy "Learners and course organisations view session attendance"
  on public.course_session_attendance for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.course_cohort_sessions session
      join public.course_cohorts cohort on cohort.id = session.cohort_id
      join public.course_catalogue course on course.id = cohort.course_catalogue_id
      where session.id = course_session_attendance.session_id
        and (
          is_platform_admin((select auth.uid()))
          or (course.organisation_id is not null and is_org_member(course.organisation_id, (select auth.uid())))
        )
    )
  );

create policy "Learners and course organisations view session launches"
  on public.course_session_launches for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.course_cohort_sessions session
      join public.course_cohorts cohort on cohort.id = session.cohort_id
      join public.course_catalogue course on course.id = cohort.course_catalogue_id
      where session.id = course_session_launches.session_id
        and (
          is_platform_admin((select auth.uid()))
          or (course.organisation_id is not null and is_org_member(course.organisation_id, (select auth.uid())))
        )
    )
  );

grant select on table public.course_session_google_meet to authenticated;
grant select on table public.google_meet_conferences to authenticated;
grant select on table public.google_meet_attendance_segments to authenticated;
grant select on table public.course_session_attendance to authenticated;
grant select on table public.course_session_launches to authenticated;
