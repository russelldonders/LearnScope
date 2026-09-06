import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
import { pathToFileURL } from 'node:url'
// Run with: node supabase/tests/scoped-employer-access.mjs <path-to-pglite/dist/index.js>
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite')
const db = new PGlite()
const sql = (name) => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key);
create table public.employers(id uuid primary key);
create table public.employer_members(id uuid primary key default gen_random_uuid(), employer_id uuid, user_id uuid, role text, status text);
create function public.is_employer_admin(e uuid,u uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.employer_members where employer_id=e and user_id=u and role='admin' and status='active') $$;
create function public.is_employer_member(e uuid,u uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.employer_members where employer_id=e and user_id=u and status='active') $$;
create table public.skill_library(id uuid primary key, name text, is_private boolean default false, status text default 'active');
create table public.skills(id uuid primary key, user_id uuid, library_skill_id uuid);
create table public.skill_assessments(id uuid primary key, skill_id uuid, user_id uuid);
create table public.courses(id uuid primary key,user_id uuid);
create table public.experience(id uuid primary key,user_id uuid);
alter table public.skills enable row level security;
alter table public.skill_assessments enable row level security;
alter table public.courses enable row level security;
alter table public.experience enable row level security;
grant usage on schema public,auth to authenticated,anon;
grant select on public.skills,public.skill_assessments,public.courses,public.experience to authenticated;
insert into auth.users values ('${id(1)}'),('${id(2)}'),('${id(3)}');
insert into employers values('${id(10)}');
insert into employer_members(employer_id,user_id,role,status) values('${id(10)}','${id(1)}','admin','active'),('${id(10)}','${id(2)}','member','active');
insert into skill_library(id,name) values('${id(20)}','SQL'),('${id(21)}','Writing');
insert into skills values('${id(30)}','${id(2)}','${id(20)}'),('${id(31)}','${id(2)}','${id(21)}'),('${id(32)}','${id(3)}','${id(20)}');
insert into courses values('${id(40)}','${id(2)}');
insert into experience values('${id(50)}','${id(2)}');
`)
await db.exec(await sql('20260902200000_employer_data_access_requests.sql'))
await db.exec(await sql('20260902220000_employer_data_access_shared_skills.sql'))
const hardened = await sql('20260902240000_critical_employer_grant_fixes.sql')
await db.exec(hardened.slice(hardened.indexOf('create or replace function set_employer_data_access_shared_skills'), hardened.indexOf('-- ----------------------------------------------------------------------------', hardened.indexOf('revoke all on function set_employer_data_access_shared_skills'))))
await db.exec(await sql('20260906193000_scoped_employer_data_access.sql'))
async function actor(n) { await db.exec(`reset role; set test.uid='${n ? id(n) : ''}'; set role ${n ? 'authenticated' : 'anon'};`) }
async function count(table) { return (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n }
async function request(categories, skills = [], comment = '') {
  return (await db.query('select * from public.request_scoped_employer_data_access($1,$2,$3,$4,$5)', [id(10),id(2),categories,skills,comment])).rows[0]
}
async function decide(row, categories, skills = [], accept = true) {
  return db.query('select public.decide_scoped_employer_data_access($1,$2,$3,$4)',[row.id,accept,skills,categories])
}
let checks = 0
async function denied(fn, pattern) { await assert.rejects(fn, pattern); checks++ }
await actor(null)
await denied(() => request(['training']), /permission denied/)
await actor(3)
await denied(() => request(['training']), /Not authorized/)
await actor(1)
await denied(() => request([]), /Choose skills/)
await denied(() => request(['training'], [id(20)]), /Specific skills/)
await denied(() => request(['skills'], [id(99)]), /active public/)
await denied(() => request(['skills'], [], 'x'.repeat(2001)), /2000/)
let row = await request(['skills','training'], [id(20)], 'For your development plan')
assert.deepEqual(row.requested_skill_names,['SQL']); assert.equal(row.request_comment,'For your development plan'); checks += 2
assert.equal(await count('courses'),0); checks++
await denied(() => request(['experience']), /already has/)
await actor(3)
await denied(() => decide(row,['training']), /Not authorized/)
await actor(2)
await denied(() => decide(row,['experience']), /only the data/)
await denied(() => decide(row,['skills'],[id(31)]), /own requested skills/)
await denied(() => decide(row,['skills'],[id(32)]), /own requested skills/)
await decide(row,['skills','training'],[id(30)])
await denied(() => decide(row,['training']), /already been decided/)
await actor(1)
assert.equal(await count('skills'),1); assert.equal(await count('courses'),1); assert.equal(await count('experience'),0); checks+=3
await actor(3)
assert.equal(await count('courses'),0); checks++
await actor(2)
await db.query('select public.revoke_employer_data_access($1)',[row.id])
await actor(1)
assert.equal(await count('courses'),0); assert.equal(await count('skills'),0); checks+=2
row=await request(['experience'])
assert.equal(row.request_comment,null); assert.deepEqual(row.requested_skill_names,[]); checks+=2
await actor(2)
await decide(row,['experience'])
await actor(1)
assert.equal(await count('experience'),1); assert.equal(await count('courses'),0); checks+=2
await db.exec(`reset role; update employer_members set status='pending' where user_id='${id(2)}';`)
await actor(1)
assert.equal(await count('experience'),0); checks++
await db.exec(`reset role; update employer_members set status='active' where user_id='${id(2)}';`)
await actor(2)
await db.query('select public.revoke_employer_data_access($1)',[row.id])
await db.query('select public.share_data_with_employer($1,$2)',[id(10),[id(30)]])
await actor(1)
assert.equal(await count('experience'),0); assert.equal(await count('skills'),1); checks+=2
await db.close()
console.log(`${checks} scoped access and RLS checks passed`)
