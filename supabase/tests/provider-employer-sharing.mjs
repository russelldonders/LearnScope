import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.argv[2] || '.test-runtime/node_modules/@electric-sql/pglite/dist/index.js').href)
const db = new PGlite()
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table auth.users(id uuid primary key);
create table organisations(id uuid primary key,name text);
create table employers(id uuid primary key,name text,provider_organisation_id uuid);
create table employer_members(employer_id uuid,user_id uuid,role text,status text);
create table organisation_members(organisation_id uuid,user_id uuid,role text,status text);
create function is_employer_admin(e uuid,u uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from employer_members where employer_id=e and user_id=u and role='admin' and status='active') $$;
create function is_employer_member(e uuid,u uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from employer_members where employer_id=e and user_id=u and status='active') $$;
create function is_org_admin(o uuid,u uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from organisation_members where organisation_id=o and user_id=u and role='admin' and status='active') $$;
create table catalogues(id uuid primary key,organisation_id uuid,is_global boolean default false,name text);
create table course_catalogue(id uuid primary key,name text,status text default 'approved',is_current_published boolean default true);
create table course_catalogue_publications(catalogue_id uuid,course_id uuid,published_at timestamptz default now());
create table course_assignments(id uuid primary key default gen_random_uuid(),employer_id uuid,catalogue_course_id uuid,assigned_to uuid,assigned_by uuid,unique(employer_id,catalogue_course_id,assigned_to));
grant usage on schema public,auth to authenticated,anon;
grant select on employers,catalogues,course_catalogue,course_catalogue_publications to authenticated;
alter table employers enable row level security;
create policy employer_read on employers for select to authenticated using(is_employer_member(id,auth.uid()));
insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
insert into organisations values('${id(10)}','Main'),('${id(11)}','Provider');
insert into employers values('${id(20)}','Employer','${id(10)}');
insert into employer_members values('${id(20)}','${id(1)}','admin','active'),('${id(20)}','${id(4)}','member','active');
insert into organisation_members values('${id(11)}','${id(2)}','admin','active');
insert into catalogues values('${id(30)}','${id(10)}',false,'Main'),('${id(31)}','${id(11)}',false,'External');
insert into course_catalogue(id,name) values('${id(40)}','Main course'),('${id(41)}','Shared'),('${id(42)}','Excluded');
insert into course_catalogue_publications(catalogue_id,course_id) values('${id(30)}','${id(40)}'),('${id(31)}','${id(41)}'),('${id(31)}','${id(42)}');
`)
await db.exec(await readFile(new URL('../migrations/20260902310000_employer_linked_providers.sql',import.meta.url),'utf8'))
await db.exec('alter table employer_linked_providers drop constraint employer_linked_providers_linked_by_fkey, add constraint employer_linked_providers_linked_by_fkey foreign key(linked_by) references auth.users(id) on delete set null')
await db.exec(await readFile(new URL('../migrations/20260912152917_provider_employer_sharing.sql',import.meta.url),'utf8'))
const actor = async n => db.exec(`reset role; set test.uid='${n ? id(n):''}'; set role ${n ? 'authenticated':'anon'};`)
let checks=0
async function denied(fn,re) { await assert.rejects(fn,re); checks++ }
async function enabled(course,expected) { const r=await db.query('select employer_course_is_enabled($1,$2) as enabled',[id(20),id(course)]); assert.equal(r.rows[0].enabled,expected); checks++ }
const specific={all:false,catalogues:[{id:id(31),all:false,courses:[id(41)]}]}
async function request(side='employer',sharing=specific,provider=11) { return (await db.query(`insert into employer_linked_providers(employer_id,provider_organisation_id,linked_by,initiated_by,sharing) values($1,$2,auth.uid(),$3,$4) returning *`,[id(20),id(provider),side,sharing])).rows[0] }
const decide = (row,status='accepted') => db.query('update employer_linked_providers set status=$2 where id=$1 returning *',[row.id,status])
await actor(null); await denied(()=>request(),/permission denied|Not authorized/)
await actor(3); await denied(()=>request(),/row-level security|Not authorized/)
await actor(1); await enabled(40,true); await enabled(41,false)
await denied(()=>request('employer',specific,10),/permanent/)
await denied(()=>request('provider'),/Not authorized/)
await denied(()=>request('employer',{all:false,catalogues:[]}),/at least one/)
await denied(()=>request('employer',{all:false,catalogues:[{id:id(30),all:true,courses:[]}]}),/owned/)
await denied(()=>request('employer',{all:false,catalogues:[{id:id(31),all:false,courses:[id(40)]}]}),/published course/)
let row=await request(); await enabled(41,false)
await denied(()=>decide(row),/receiving/)
await denied(()=>db.query('update employer_linked_providers set sharing=$2 where id=$1',[row.id,{all:true,catalogues:[]}]),/cannot change/)
await denied(()=>db.query('select * from assign_course_to_employer_members($1,$2,$3)',[id(20),id(41),[id(4)]]),/confirmed/)
await actor(2); assert.equal((await db.query('select * from sharing_employer_directory($1)',[id(11)])).rows.length,1); checks++
await decide(row)
await denied(()=>decide(row),/already been decided/)
await actor(1); await enabled(41,true); await enabled(42,false)
assert.equal((await db.query('select * from list_employer_shared_courses($1)',[id(20)])).rows.length,2); checks++
assert.equal((await db.query('select * from assign_course_to_employer_members($1,$2,$3)',[id(20),id(41),[id(4),id(3)]])).rows.length,1); checks++
await db.query('delete from employer_linked_providers where id=$1',[row.id]); await enabled(41,false)
await actor(2); row=await request('provider',{all:false,catalogues:[{id:id(31),all:true,courses:[]}]}); await denied(()=>decide(row),/receiving/)
await actor(1); await decide(row); await enabled(42,true)
await db.exec(`reset role; insert into course_catalogue(id,name) values('${id(43)}','Future'); insert into course_catalogue_publications(catalogue_id,course_id) values('${id(31)}','${id(43)}');`)
await actor(1); await enabled(43,true)
await db.query('delete from employer_linked_providers where id=$1',[row.id]); row=await request('employer',{all:true,catalogues:[]})
await actor(2); await decide(row)
await db.exec(`reset role; insert into catalogues values('${id(32)}','${id(11)}',false,'Future catalogue'); insert into course_catalogue(id,name) values('${id(44)}','Future catalogue course'); insert into course_catalogue_publications(catalogue_id,course_id) values('${id(32)}','${id(44)}');`)
await actor(1); await enabled(44,true)
await db.exec(`reset role; delete from course_catalogue_publications where course_id='${id(44)}'`); await actor(1); await enabled(44,false)
await actor(3); assert.equal((await db.query('select * from employer_linked_providers')).rows.length,0); checks++
await denied(()=>db.query('select * from sharing_employer_directory($1)',[id(11)]),/Not authorized/)
await actor(1); await db.query('delete from employer_linked_providers where id=$1',[row.id]); row=await request()
await actor(2); await decide(row,'declined'); await actor(1); await enabled(41,false)
await db.exec('reset role; set test.uid=\'\'')
await db.query('delete from auth.users where id=$1',[id(1)])
assert.equal((await db.query('select linked_by from employer_linked_providers where id=$1',[row.id])).rows[0].linked_by,null); checks++
await db.query('delete from auth.users where id=$1',[id(2)])
assert.equal((await db.query('select decided_by from employer_linked_providers where id=$1',[row.id])).rows[0].decided_by,null); checks++
await db.query('delete from organisations where id=$1',[id(11)])
assert.equal((await db.query('select * from employer_linked_providers')).rows.length,0); checks++
console.log(`${checks} sharing database checks passed`)
await db.close()
