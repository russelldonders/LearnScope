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
  create table auth.users (id uuid primary key);
  create table organisations (id uuid primary key);
  create table organisation_members (
    organisation_id uuid not null,
    user_id uuid not null,
    status text not null
  );
  create table platform_admins (user_id uuid primary key);
  create table catalogues (
    id uuid primary key,
    organisation_id uuid,
    name text not null,
    is_global boolean not null default false
  );
  create table course_catalogue (
    id uuid primary key,
    organisation_id uuid,
    name text not null,
    status text not null,
    is_current_published boolean not null default false
  );
  create table course_catalogue_publications (
    course_id uuid not null,
    catalogue_id uuid not null,
    selected_by uuid,
    published_at timestamptz,
    primary key (course_id, catalogue_id)
  );
  create table admin_activity_log (
    actor_id uuid,
    actor_label text not null,
    action text not null,
    entity_type text not null,
    entity_id uuid not null,
    entity_label text,
    reason text
  );
  create function is_org_member(p_organisation_id uuid, p_user_id uuid)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select exists (
    select 1 from public.organisation_members om
    where om.organisation_id = p_organisation_id
      and om.user_id = p_user_id
      and om.status = 'active'
  ) $$;
  create function is_platform_admin(p_user_id uuid)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select exists (
    select 1 from public.platform_admins pa where pa.user_id = p_user_id
  ) $$;
  create function admin_activity_actor_label(p_user_id uuid)
  returns text language sql stable security definer set search_path = ''
  as $$ select p_user_id::text $$;
  grant usage on schema public, auth to authenticated, anon;
  grant select on course_catalogue, course_catalogue_publications, admin_activity_log to authenticated;

  insert into auth.users values ('${id(1)}'), ('${id(2)}'), ('${id(3)}');
  insert into organisations values ('${id(10)}'), ('${id(11)}');
  insert into organisation_members values ('${id(10)}', '${id(1)}', 'active');
  insert into platform_admins values ('${id(3)}');
  insert into catalogues values
    ('${id(20)}', null, 'Global catalogue', true),
    ('${id(21)}', '${id(10)}', 'Provider catalogue', false);
  insert into course_catalogue values
    ('${id(30)}', '${id(10)}', 'Live course', 'approved', true),
    ('${id(31)}', '${id(11)}', 'Other course', 'approved', true),
    ('${id(32)}', '${id(10)}', 'Draft course', 'draft', false);
  insert into course_catalogue_publications values
    ('${id(30)}', '${id(21)}', '${id(1)}', now());
`)

await db.exec(await readFile(new URL('../migrations/20260912205236_provider_global_catalogue_requests.sql', import.meta.url), 'utf8'))

const actor = async (n) => {
  await db.exec(`reset role; set test.uid='${n ? id(n) : ''}'; set role ${n ? 'authenticated' : 'anon'};`)
}
let checks = 0
const denied = async (operation, pattern) => {
  await assert.rejects(operation, pattern)
  checks += 1
}
const publication = async (course, catalogue) =>
  (await db.query(
    'select published_at from course_catalogue_publications where course_id = $1 and catalogue_id = $2',
    [id(course), id(catalogue)]
  )).rows[0]

await actor(1)
await db.query('select request_global_catalogue_publication($1)', [id(30)])
assert.equal((await publication(30, 20)).published_at, null)
assert.ok((await publication(30, 21)).published_at)
assert.deepEqual(
  (await db.query('select status, is_current_published from course_catalogue where id = $1', [id(30)])).rows[0],
  { status: 'approved', is_current_published: true }
)
checks += 3

await db.query('select request_global_catalogue_publication($1)', [id(30)])
assert.equal((await db.query('select count(*)::int as count from course_catalogue_publications where course_id = $1 and catalogue_id = $2', [id(30), id(20)])).rows[0].count, 1)
checks += 1
await denied(() => db.query('select request_global_catalogue_publication($1)', [id(31)]), /Not authorized/)
await denied(() => db.query('select request_global_catalogue_publication($1)', [id(32)]), /current approved/)

await actor(3)
await db.query('select approve_global_catalogue_publication($1)', [id(30)])
assert.ok((await publication(30, 20)).published_at)
assert.ok((await publication(30, 21)).published_at)
checks += 2

await actor(1)
await denied(() => db.query('select request_global_catalogue_publication($1)', [id(30)]), /already published/)

await db.exec(`
  reset role;
  update course_catalogue_publications set published_at = null
  where course_id = '${id(30)}' and catalogue_id = '${id(20)}';
`)
await actor(2)
await denied(() => db.query('select reject_global_catalogue_publication($1, $2)', [id(30), 'No']), /Not authorized/)
await actor(3)
await denied(() => db.query('select reject_global_catalogue_publication($1, $2)', [id(30), '  ']), /reason is required/)
await db.query('select reject_global_catalogue_publication($1, $2)', [id(30), 'Needs clearer outcomes'])
assert.equal(await publication(30, 20), undefined)
assert.ok((await publication(30, 21)).published_at)
assert.equal((await db.query('select status from course_catalogue where id = $1', [id(30)])).rows[0].status, 'approved')
assert.equal((await db.query("select reason from admin_activity_log where action = 'course.global_catalogue_rejected'")).rows[0].reason, 'Needs clearer outcomes')
checks += 4

console.log(`${checks} provider Global catalogue request checks passed`)
await db.close()
