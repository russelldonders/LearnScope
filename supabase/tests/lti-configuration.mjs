import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const db = new PGlite()
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table auth.users(id uuid primary key); create table organisations(id uuid primary key);
create table organisation_members(organisation_id uuid,user_id uuid,role text,status text);
create table skill_library(id uuid primary key); create table organisation_offered_skills(organisation_id uuid,skill_library_id uuid);
create function is_org_admin(o uuid,u uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.organisation_members where organisation_id=o and user_id=u and role='admin' and status='active')$$;
create function is_org_member(o uuid,u uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.organisation_members where organisation_id=o and user_id=u and status='active')$$;
grant usage on schema public,auth to anon,authenticated;
insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}'); insert into organisations values('${id(10)}'),('${id(11)}');
insert into organisation_members values('${id(10)}','${id(1)}','admin','active'),('${id(11)}','${id(2)}','admin','active'),('${id(10)}','${id(3)}','trainer','active');
insert into skill_library values('${id(20)}'),('${id(21)}'); insert into organisation_offered_skills values('${id(10)}','${id(20)}');`)
await db.exec(await readFile(new URL('../migrations/20260911130000_lti_configuration.sql',import.meta.url),'utf8'))
async function actor(n) { await db.exec(`reset role; set test.uid='${n ? id(n) : ''}'; set role ${n ? 'authenticated' : 'anon'};`) }
const form = { name: 'LMS', issuer: 'https://lms.example', client_id: 'client', deployment_ids: ['a','a','b'], authorization_url: 'https://lms.example/auth', jwks_url: 'https://lms.example/jwks', token_url: 'https://lms.example/token' }
const object = { title: 'SQL', target_level: 3, grade_passback: true }
async function connection(org=10, config=form, rowId=null) { return (await db.query('select * from save_lti_connection($1,$2,$3)',[id(org),rowId,config])).rows[0] }
async function saveObject(ids, config=object, rowId=null, skill=20) { return (await db.query('select * from save_lti_skill_object($1,$2,$3,$4,$5)',[id(10),id(skill),rowId,config,ids])).rows[0] }
let checks=0
async function denies(fn,pattern) { await assert.rejects(fn,pattern); checks++ }
await actor(null); await denies(()=>connection(),/permission denied/)
await actor(3); await denies(()=>connection(),/Only an organisation admin/)
await actor(1)
await denies(()=>connection(11),/Only an organisation admin/)
await denies(()=>connection(10,{...form,issuer:'http://lms.example'}),/HTTPS/)
await denies(()=>connection(10,{...form,deployment_ids:[]}),/Deployment IDs/)
const a=await connection(); assert.equal(a.code,'LMS-00001'); assert.equal(a.status,'draft'); assert.deepEqual(a.deployment_ids,['a','b']); checks+=3
await denies(()=>connection(),/duplicate key/)
const b=await connection(10,{...form,client_id:'other'})
await actor(2); const foreign=await connection(11)
await actor(1)
await denies(()=>saveObject([foreign.id]),/this organisation/)
await denies(()=>saveObject([a.id],object,null,21),/not offered/)
await denies(()=>saveObject([a.id],{...object,target_level:6}),/check constraint/)
let saved=await saveObject([a.id,b.id,a.id]); assert.equal(saved.score_maximum,5); assert.equal(saved.grade_source,'proficiency'); assert.equal(saved.status,'draft');checks+=3
assert.equal((await db.query('select * from lti_object_connections')).rows.length,2);checks++
await denies(()=>saveObject([foreign.id],{...object,title:'Changed'},saved.id),/this organisation/)
assert.equal((await db.query('select title from lti_skill_objects')).rows[0].title,'SQL');checks++
await denies(()=>db.query("update lti_skill_objects set status='active'"),/permission denied/)
await denies(()=>saveObject([a.id],{...object,status:'active'},saved.id),/check constraint/)
await actor(2);assert.equal((await db.query('select * from lti_skill_objects')).rows.length,0);checks++
await denies(()=>connection(11,form,a.id),/not found/)
await actor(3); assert.equal((await db.query('select * from lti_skill_objects')).rows.length,1);checks++
await denies(()=>saveObject([]),/Only an organisation admin/)
await actor(1)
await connection(10,{...form,status:'archived'},a.id)
await denies(()=>saveObject([a.id],object,saved.id),/available LMS connection/)
saved=await saveObject([],{...object,status:'archived',grade_passback:false},saved.id)
assert.equal(saved.status,'archived'); assert.equal(saved.grade_passback,false); checks+=2
assert.equal((await db.query('select * from lti_object_connections')).rows.length,0);checks++
await saveObject([],{...object,status:'draft'},saved.id)
assert.equal((await db.query('select status from lti_skill_objects')).rows[0].status,'draft');checks++
await db.exec('reset role'); await db.query('delete from auth.users where id=$1',[id(1)]);
assert.equal((await db.query('select created_by from lti_connections where id=$1',[a.id])).rows[0].created_by,null);checks++;
assert.equal((await db.query('select created_by from lti_skill_objects where id=$1',[saved.id])).rows[0].created_by,null);checks++;
await db.close(); console.log(`${checks} LTI configuration permission and persistence checks passed`)
