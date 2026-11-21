import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(pathToFileURL(process.argv[2] || '.test-runtime/node_modules/@electric-sql/pglite/dist/index.js').href)
const db = new PGlite()
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table auth.users(id uuid primary key);
  create table platform_admins(user_id uuid primary key references auth.users(id));
  create table organisations(id uuid primary key, status text not null);
  create table organisation_members(
    id uuid primary key, organisation_id uuid references organisations(id),
    user_id uuid references auth.users(id), role text, status text
  );
  create table course_catalogue(id uuid primary key, organisation_id uuid references organisations(id), name text);
  create table course_cohorts(id uuid primary key, course_catalogue_id uuid references course_catalogue(id));
  create table course_cohort_sessions(
    id uuid primary key, cohort_id uuid references course_cohorts(id), title text,
    starts_at timestamptz not null, ends_at timestamptz, location_or_link text
  );
  create table courses(
    id uuid primary key, user_id uuid references auth.users(id), cohort_id uuid references course_cohorts(id), status text
  );
  create table external_connections(
    id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) not null,
    provider text not null check (provider in ('strava')), provider_account_id text not null,
    access_token text not null, refresh_token text not null, token_expires_at timestamptz not null,
    scope text, status text not null default 'active', connected_at timestamptz not null default now(),
    last_synced_at timestamptz, unique(user_id, provider)
  );
  alter table external_connections enable row level security;
  grant select on organisations, organisation_members, course_catalogue, course_cohorts,
    course_cohort_sessions, courses, platform_admins to authenticated;

  create function is_platform_admin(check_user_id uuid) returns boolean language sql stable security definer
    set search_path=public as $$ select exists(select 1 from platform_admins where user_id=check_user_id) $$;
  create function is_org_member(org_id uuid, check_user_id uuid) returns boolean language sql stable security definer
    set search_path=public as $$
      select exists(select 1 from organisation_members where organisation_id=org_id and user_id=check_user_id and status='active')
        or is_platform_admin(check_user_id)
    $$;
`)

await db.exec(await readFile(new URL('../migrations/20261121131433_google_meet_attendance.sql', import.meta.url), 'utf8'))

await db.exec(`
  insert into auth.users values ('${id(1)}'), ('${id(2)}'), ('${id(3)}');
  insert into organisations values ('${id(10)}', 'active');
  insert into organisation_members values ('${id(20)}', '${id(10)}', '${id(2)}', 'trainer', 'active');
  insert into course_catalogue values ('${id(30)}', '${id(10)}', 'Live course');
  insert into course_cohorts values ('${id(40)}', '${id(30)}');
  insert into course_cohort_sessions values (
    '${id(50)}', '${id(40)}', 'Workshop', '2026-11-21T10:00:00Z', '2026-11-21T11:00:00Z', null
  );
  insert into courses values ('${id(60)}', '${id(1)}', '${id(40)}', null);
  insert into external_connections(user_id,provider,provider_account_id,access_token,refresh_token,token_expires_at)
    values ('${id(1)}','google','google-1','secret','refresh','2027-01-01T00:00:00Z');
  insert into course_session_google_meet(session_id,google_space_name,meeting_uri,organizer_user_id)
    values ('${id(50)}','spaces/space_1','https://meet.google.com/abc-defg-hij','${id(2)}');
  insert into google_meet_conferences(id,session_id,google_conference_name,started_at,ended_at)
    values ('${id(70)}','${id(50)}','conferenceRecords/one','2026-11-21T10:00:00Z','2026-11-21T11:00:00Z');
  insert into google_meet_attendance_segments(
    conference_id,google_participant_name,google_participant_session_name,google_user_id,matched_user_id,
    display_name,joined_at,left_at,participant_kind
  ) values ('${id(70)}','participants/one','participantSessions/one','google-1','${id(1)}','Learner',
    '2026-11-21T10:00:00Z','2026-11-21T10:45:00Z','signed_in');
  insert into course_session_attendance(session_id,user_id,attended_seconds,attendance_percent,calculation_status)
    values ('${id(50)}','${id(1)}',2700,75,'final');
`)

const actor = (n) => db.exec(`reset role; set test.uid='${n ? id(n) : ''}'; set role ${n ? 'authenticated' : 'anon'};`)
let checks = 0

await actor(1)
assert.equal((await db.query('select count(*)::int as count from course_session_google_meet')).rows[0].count, 1)
assert.equal((await db.query('select count(*)::int as count from course_session_attendance')).rows[0].count, 1)
assert.equal((await db.query('select count(*)::int as count from google_meet_attendance_segments')).rows[0].count, 0)
checks += 3

await actor(2)
assert.equal((await db.query('select count(*)::int as count from google_meet_attendance_segments')).rows[0].count, 1)
checks++

await actor(3)
assert.equal((await db.query('select count(*)::int as count from course_session_google_meet')).rows[0].count, 0)
assert.equal((await db.query('select count(*)::int as count from course_session_attendance')).rows[0].count, 0)
checks += 2

console.log(`${checks} Google Meet attendance database checks passed`)
await db.close()
