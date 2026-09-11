// @vitest-environment node
import { beforeAll,beforeEach,expect,it,vi } from 'vitest'
import { generateKeyPair,exportJWK,SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import handler from './handler.js'
import { CLAIM,AGS,SCORE_SCOPE,hash,safeJson,deliverScore } from './security.js'
const state=vi.hoisted(()=>({tables:{},user:{id:'user-1'}}))
vi.mock('../supabaseAdmin.js',()=>({supabaseAdmin:()=>({from:table=>new Query(table),rpc:async(name,_params)=>name==='is_org_admin'?{data:true}:name==='lti_claim_grade'?{data:[]}:{data:null}})}))
vi.mock('../auth.js',()=>({verifySupabaseUser:async()=>state.user}))
vi.mock('./security.js',async original=>({...await original(),safeJson:vi.fn(),deliverScore:vi.fn()}))
class Query {
 constructor(table){this.table=table;this.filters=[];this.mode='select'}
 select(){return this} eq(key,value){this.filters.push(row=>key.includes('.')?row.lti_object_connections?.some(c=>c.connection_id===value):row[key]===value);return this}
 gt(key,value){this.filters.push(row=>row[key]>value);return this} lt(key,value){this.filters.push(row=>row[key]<value);return this}
 lte(key,value){this.filters.push(row=>row[key]<=value);return this} in(key,values){this.filters.push(row=>values.includes(row[key]));return this}
 order(){return this} limit(){return this} single(){this.one=true;return this} maybeSingle(){this.one=true;this.optional=true;return this}
 update(value){this.mode='update';this.value=value;return this} insert(value){this.mode='insert';this.value=value;return this} upsert(value){this.mode='upsert';this.value=value;return this} delete(){this.mode='delete';return this}
 then(resolve){
  const table=state.tables[this.table] ||= [];let rows=table.filter(row=>this.filters.every(f=>f(row)))
  if(this.mode==='insert'||this.mode==='upsert'){
   let row=this.mode==='upsert'?table.find(r=>r.identity_id===this.value.identity_id&&r.deployment===this.value.deployment&&r.resource_link===this.value.resource_link):null
   if(row) Object.assign(row,this.value);else {row={id:randomUUID(),expires_at:new Date(Date.now()+3600000).toISOString(),consumed:false,used:false,...this.value};table.push(row)}rows=[row]
  }
  if(this.mode==='update') rows.forEach(row=>Object.assign(row,this.value))
  if(this.mode==='delete') state.tables[this.table]=table.filter(row=>!rows.includes(row))
  return Promise.resolve({data:this.one?(rows[0] || null):structuredClone(rows),error:this.one&&(!this.optional&&!rows.length||rows.length>1)?{message:'not found'}:null}).then(resolve)
 }
}
let pair,jwks,config
const origin='https://tool.example',objectId='00000000-0000-0000-0000-000000000001'
const c={id:'connection',organisation_id:'org',name:'LMS',issuer:'https://lms.example',client_id:'client',deployment_ids:['d'],authorization_url:'https://lms.example/auth',jwks_url:'https://lms.example/jwks',token_url:'https://lms.example/token',status:'draft'}
beforeAll(async()=>{pair=await generateKeyPair('RS256',{extractable:true});jwks={keys:[{...await exportJWK(pair.publicKey),kid:'key'}]};config={...await exportJWK(pair.privateKey),kid:'key'}})
beforeEach(()=>{
 process.env.LTI_TOOL_ORIGIN=origin;process.env.LTI_PRIVATE_JWK=JSON.stringify(config);process.env.LTI_ENABLED_CONNECTIONS=JSON.stringify({connection:hash(JSON.stringify([c.id,c.issuer,c.client_id,c.deployment_ids,c.authorization_url,c.jwks_url,c.token_url]))})
 state.user={id:'user-1'};state.tables={lti_connections:[{...c}],organisations:[{id:'org',status:'active'}],lti_skill_objects:[{id:objectId,organisation_id:'org',skill_library_id:'library',title:'SQL',description:'',status:'draft',grade_passback:true,lti_object_connections:[{connection_id:'connection'}]}],skills:[],lti_identities:[]};safeJson.mockResolvedValue(jwks);deliverScore.mockReset()
})
async function call(action,{method='POST',body={},headers={},query={}}={}){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.value=v;return this},send(v){this.value=v;return this}};await handler({method,query:{lti:action,...query},body,headers:{origin,...headers}},res);return res}
async function launch(){
 const login=await call('login',{method:'GET',query:{iss:c.issuer,client_id:c.client_id,login_hint:'learner',target_link_uri:origin+'/lti/resources/'+objectId}})
 expect(login.code).toBe(200)
 const auth=new URL(JSON.parse(login.value.match(/location.replace\(("[^"]+")\)/)[1]))
 const binding=login.value.match(/sessionStorage.setItem\('lti-binding-'\+"[^"]+","([^"]+)"\)/)[1]
 const claims={sub:'lms-user',nonce:auth.searchParams.get('nonce'),[CLAIM+'version']:'1.3.0',[CLAIM+'deployment_id']:'d',[CLAIM+'target_link_uri']:origin+'/lti/resources/'+objectId,[CLAIM+'message_type']:'LtiResourceLinkRequest',[CLAIM+'roles']:['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],[CLAIM+'resource_link']:{id:'course-resource'},[AGS]:{scope:[SCORE_SCOPE],lineitem:'https://lms.example/lineitems/1'}}
 const jwt=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'key'}).setIssuer(c.issuer).setAudience(c.client_id).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey)
 const body={state:auth.searchParams.get('state'),id_token:jwt}
 const result=await call('launch',{body})
 const token=result.value.match(/setItem\('lti-session',"([^"]+)"/)[1]
 return {body,session:token+'.'+binding}
}
it('performs signed launch and consumes the state exactly once',async()=>{const l=await launch();expect(state.tables.lti_launch_sessions).toHaveLength(1);await call('launch',{body:l.body});expect(state.tables.lti_launch_sessions).toHaveLength(1);expect(state.tables.lti_launch_sessions[0].claims).not.toHaveProperty('email')})
it('requires browser binding even with a valid launch token',async()=>{const l=await launch();const response=await call('session',{headers:{'x-lti-session':l.session.split('.')[0]+'.wrong'}});expect(response.code).toBe(400)})
it('requires Supabase authentication before linking',async()=>{const l=await launch();const response=await call('session',{headers:{'x-lti-session':l.session}});expect(response.value.loginRequired).toBe(true);expect(state.tables.lti_identities).toHaveLength(0)})
it('requires explicit account confirmation and rejects another LearnScope user',async()=>{const l=await launch();const headers={'x-lti-session':l.session,authorization:'Bearer authenticated'};expect((await call('link',{headers})).code).toBe(400);expect((await call('link',{headers,body:{confirm:true}})).code).toBe(200);expect(state.tables.lti_identities[0].user_id).toBe('user-1');state.user={id:'user-2'};expect((await call('session',{headers})).code).toBe(400)})
it('does not share a grade as a side effect of linking',async()=>{const l=await launch();const headers={'x-lti-session':l.session,authorization:'Bearer authenticated'};await call('link',{headers,body:{confirm:true}});expect(state.tables.lti_grade_links).toHaveLength(0);await call('consent',{headers,body:{consent:true}});expect(state.tables.lti_grade_links[0].consent).toBe(true);expect(deliverScore).not.toHaveBeenCalled()})
it('rejects cross-origin account linking',async()=>{const l=await launch();const response=await call('link',{headers:{'x-lti-session':l.session,authorization:'Bearer authenticated',origin:'https://evil.example'},body:{confirm:true}});expect(response.code).toBe(403)})
it('revokes existing launches when the provider is deactivated',async()=>{const l=await launch();state.tables.organisations[0].status='inactive';expect((await call('session',{headers:{'x-lti-session':l.session}})).code).toBe(400)})
it('requires reactivation after connection endpoint changes',async()=>{const l=await launch();state.tables.lti_connections[0].token_url='https://other.example/token';expect((await call('session',{headers:{'x-lti-session':l.session}})).code).toBe(400)})
it('blocks a resource removed from its provider',async()=>{const l=await launch();state.tables.lti_skill_objects[0].organisation_id='other-org';expect((await call('session',{headers:{'x-lti-session':l.session}})).code).toBe(400)})
it('never echoes a malformed private key',async()=>{process.env.LTI_PRIVATE_JWK='secret-fragment';const response=await call('jwks',{method:'GET'});expect(JSON.stringify(response.value)).not.toContain('secret-fragment')})

it('allows independent owner revocation even when signing secrets are unavailable',async()=>{const l=await launch();const headers={'x-lti-session':l.session,authorization:'Bearer authenticated'};await call('link',{headers,body:{confirm:true}});const id=state.tables.lti_identities[0].id;delete process.env.LTI_PRIVATE_JWK;expect((await call('disconnect-account',{headers:{authorization:'Bearer authenticated'},body:{id}})).code).toBe(200);expect(state.tables.lti_identities).toHaveLength(0);expect(state.tables.lti_launch_sessions).toHaveLength(0)})
it('rejects revoking another learner’s LMS link',async()=>{state.tables.lti_identities=[{id:'other',user_id:'user-2'}];expect((await call('disconnect-account',{headers:{authorization:'Bearer authenticated'},body:{id:'other'}})).code).toBe(400)})
