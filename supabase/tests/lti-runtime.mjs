import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
import { pathToFileURL } from 'node:url'
const {PGlite}=await import(pathToFileURL(process.argv[2]).href)
const db=new PGlite()
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create table auth.users(id uuid primary key);create table organisations(id uuid primary key);create table skill_library(id uuid primary key);
create table organisation_offered_skills(organisation_id uuid,skill_library_id uuid);
create function is_org_admin(uuid,uuid) returns boolean language sql as $$select true$$;
create function is_org_member(uuid,uuid) returns boolean language sql as $$select true$$;
create table skills(id uuid primary key,user_id uuid,library_skill_id uuid,level integer);
create table skill_assessments(id uuid primary key,skill_id uuid,level integer,axis text,assessed_at timestamptz);
grant usage on schema public to anon,authenticated,service_role;`)
for(const file of ['20260911130000_lti_configuration.sql','20260911140000_lti_runtime.sql']) await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'))
const uid='00000000-0000-0000-0000-000000000001',oid='00000000-0000-0000-0000-000000000002',sid='00000000-0000-0000-0000-000000000003'
await db.exec(`insert into auth.users values('${uid}');insert into organisations values('${oid}');insert into skill_library values('${sid}');`)
const c=(await db.query(`insert into lti_connections(organisation_id,name,issuer,client_id,deployment_ids,authorization_url,jwks_url,token_url,created_by) values($1,'LMS','https://lms.example','client',array['d'],'https://lms.example/auth','https://lms.example/jwks','https://lms.example/token',$2) returning id`,[oid,uid])).rows[0].id
const o=(await db.query(`insert into lti_skill_objects(organisation_id,skill_library_id,title,created_by) values($1,$2,'Skill',$3) returning id`,[oid,sid,uid])).rows[0].id
const i=(await db.query(`insert into lti_identities(connection_id,subject,registration_key,user_id) values($1,'subject','registration',$2) returning id`,[c,uid])).rows[0].id
const l=(await db.query(`insert into lti_grade_links(identity_id,object_id,deployment,resource_link,lineitem,consent) values($1,$2,'d','r','https://lms.example/item',true) returning id`,[i,o])).rows[0].id
let checks=0
for(const role of ['anon','authenticated']) {
 await db.exec(`set role ${role}`)
 for(const table of ['lti_transactions','lti_launch_sessions','lti_identities','lti_grade_links','lti_grade_jobs']) {await assert.rejects(()=>db.query('select * from '+table),/permission denied/);checks++}
 for(const fn of ['lti_queue_grade','lti_claim_grade']) {await assert.rejects(()=>db.query(`select ${fn}($1)`,[l]),/permission denied/);checks++}
 await db.exec('reset role')
}
await db.query('select lti_queue_grade($1)',[l])
assert.equal((await db.query('select * from lti_claim_grade($1)',[l])).rows.length,1);checks++
assert.equal((await db.query('select * from lti_claim_grade($1)',[l])).rows.length,0);checks++
await db.query(`insert into skills values($1,$2,$3,2)`,[sid,uid,sid])
assert.equal((await db.query('select revision from lti_grade_jobs')).rows[0].revision,2);checks++
await db.query(`insert into skill_assessments values($1,$1,4,'practical',now())`,[sid])
assert.equal((await db.query('select revision from lti_grade_jobs')).rows[0].revision,3);checks++
await db.query('delete from skill_assessments where id=$1',[sid])
assert.equal((await db.query('select revision from lti_grade_jobs')).rows[0].revision,4);checks++
await db.query('update lti_grade_links set consent=false where id=$1',[l]);await db.query('select lti_queue_grade($1)',[l])
assert.equal((await db.query('select revision from lti_grade_jobs')).rows[0].revision,4);checks++
await db.query(`insert into lti_transactions(state_hash,connection_id,nonce,binding_hash,target) values('state',$1,'nonce','binding','target')`,[c])
for(const count of [1,0]){assert.equal((await db.query("update lti_transactions set consumed=true where state_hash='state' and not consumed returning state_hash")).rows.length,count);checks++}
await db.query('delete from lti_identities where id=$1',[i]);assert.equal((await db.query('select * from lti_grade_jobs')).rows.length,0);checks++
await db.close();console.log(`${checks} private runtime, replay, consent, trigger and queue checks passed`)
