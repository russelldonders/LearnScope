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
  create schema private;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table auth.users(id uuid primary key);
  create table organisations(
    id uuid primary key, name text, slug text, status text,
    public_profile_enabled boolean default true
  );
  create table employers(
    id uuid primary key, name text, provider_organisation_id uuid references organisations(id)
  );
  create table employer_members(
    id uuid primary key, employer_id uuid references employers(id), user_id uuid references auth.users(id),
    role text, status text
  );
  create table catalogues(
    id uuid primary key, organisation_id uuid references organisations(id), name text,
    description text, is_global boolean default false
  );
  create table employer_linked_providers(
    employer_id uuid, provider_organisation_id uuid, status text, sharing jsonb
  );
  create table employer_role_profiles(
    id uuid primary key, employer_id uuid references employers(id), name text, status text
  );
  create table employer_role_assignments(
    id uuid primary key, role_profile_id uuid references employer_role_profiles(id),
    employer_member_id uuid references employer_members(id), status text
  );
  create table course_catalogue(
    id uuid primary key, name text, provider text, synopsis text, course_type text,
    duration text, image_url text, status text, is_current_published boolean
  );
  create table course_catalogue_publications(
    catalogue_id uuid references catalogues(id), course_id uuid references course_catalogue(id),
    published_at timestamptz
  );
  create table skill_library(id uuid primary key, name text);
  create table course_catalogue_skills(course_catalogue_id uuid, skill_library_id uuid, level integer);
  create table tags(id uuid primary key, name text);
  create table course_catalogue_tags(course_catalogue_id uuid, tag_id uuid);

  create function is_employer_admin(e uuid, u uuid) returns boolean language sql stable security definer
    set search_path = public as $$
      select exists(select 1 from employer_members where employer_id=e and user_id=u and role='admin' and status='active')
    $$;
  create function employer_course_is_enabled(e uuid, c uuid) returns boolean language sql stable security definer
    set search_path = public as $$
      select exists(
        select 1 from course_catalogue_publications publication
        join catalogues catalogue on catalogue.id=publication.catalogue_id
        join employers employer on employer.id=e
        where publication.course_id=c and publication.published_at is not null
          and catalogue.organisation_id=employer.provider_organisation_id
      )
    $$;

  insert into auth.users values ('${id(1)}'), ('${id(2)}'), ('${id(3)}');
  insert into organisations values ('${id(10)}', 'Acme', 'acme', 'active', true);
  insert into employers values ('${id(20)}', 'Acme', '${id(10)}');
  insert into employer_members values
    ('${id(30)}', '${id(20)}', '${id(1)}', 'admin', 'active'),
    ('${id(31)}', '${id(20)}', '${id(2)}', 'member', 'active'),
    ('${id(32)}', '${id(20)}', '${id(3)}', 'member', 'active');
  insert into catalogues values ('${id(40)}', '${id(10)}', 'Acme essentials', 'Core learning', false);
  insert into employer_role_profiles values ('${id(50)}', '${id(20)}', 'Supervisor', 'active');
  insert into course_catalogue values
    ('${id(60)}', 'Safe working', 'Acme Learning', 'Stay safe', 'Online', '1 hour', null, 'approved', true);
  insert into course_catalogue_publications values ('${id(40)}', '${id(60)}', now());
`)

await db.exec(await readFile(new URL('../migrations/20260927094935_employer_catalogue_access.sql', import.meta.url), 'utf8'))

const actor = async (n) => db.exec(`reset role; set test.uid='${n ? id(n) : ''}'; set role ${n ? 'authenticated' : 'anon'};`)
const courseCount = async (rpc, argument) => Number((await db.query(`select jsonb_array_length(${rpc}($1)) as count`, [argument])).rows[0].count)
let checks = 0

await actor(1)
assert.equal((await db.query('select jsonb_array_length(list_employer_catalogue_access($1)) as count', [id(20)])).rows[0].count, 1)
checks++
await db.query('select set_employer_catalogue_access($1,$2,$3,$4)', [id(20), id(40), 'role_profiles', [id(50)]])

await actor(2)
assert.equal(await courseCount('list_my_employer_catalogue_courses', id(20)), 0)
checks++

await db.exec(`reset role; insert into employer_role_assignments values ('${id(70)}','${id(50)}','${id(31)}','linked')`)
await actor(2)
assert.equal(await courseCount('list_my_employer_catalogue_courses', id(20)), 1)
checks++

await actor(3)
assert.equal(await courseCount('list_my_employer_catalogue_courses', id(20)), 0)
checks++
await actor(null)
assert.equal(await courseCount('get_public_employer_catalogue_courses', 'acme'), 0)
checks++

await actor(1)
await db.query('select set_employer_catalogue_access($1,$2,$3,$4)', [id(20), id(40), 'public', []])
await actor(null)
assert.equal(await courseCount('get_public_employer_catalogue_courses', 'acme'), 1)
checks++
await actor(3)
assert.equal(await courseCount('list_my_employer_catalogue_courses', id(20)), 1)
checks++

console.log(`${checks} employer catalogue access checks passed`)
await db.close()
