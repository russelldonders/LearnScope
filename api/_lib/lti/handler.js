import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { verifySupabaseUser } from '../auth.js'
import { LtiError, CLAIM, DL, AGS, SCORE_SCOPE, randomToken, hash, safeJson, toolConfig, publicJwks, sign, verifyLaunch, serviceUrl, deliverScore } from './security.js'
import { buildProficiencyScore } from '../../../src/lib/lti/proficiencyGrade.js'

const must = result => { if (result.error) throw new LtiError('LTI storage operation failed.'); return result.data }
const fingerprint = c => hash(JSON.stringify([c.id,c.issuer,c.client_id,c.deployment_ids,c.authorization_url,c.jwks_url,c.token_url]))
const identityKey = c => hash(JSON.stringify([c.issuer,c.client_id]))
function enabled(c) { return c?.status === 'draft' && JSON.parse(process.env.LTI_ENABLED_CONNECTIONS || '{}')[c.id] === fingerprint(c) }
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]))
const js = value => JSON.stringify(value).replace(/</g, '\\u003c')
function html(res, body, script = '', frame = "'none'") {
  const additionalFrames=(process.env.LTI_FRAME_ORIGINS || '').split(',').filter(Boolean).map(value=>new URL(value).origin).filter(value=>value.startsWith('https://'))
  if(additionalFrames.length) frame=[...(frame === "'none'" ? [] : [frame]),...additionalFrames].join(' ')
  const nonce = randomToken()
  res.setHeader('Content-Type','text/html; charset=utf-8')
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action https:; frame-ancestors ${frame}; base-uri 'none'`)
  res.status(200).send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>LearnScope LMS</title></head><body style="font:18px system-ui;max-width:640px;margin:60px auto;padding:20px"><h1>LearnScope</h1>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`)
}
function body(req) { return typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {} }
async function connection(db, id) {
  const c = must(await db.from('lti_connections').select('*').eq('id',id).single())
  const org = must(await db.from('organisations').select('status').eq('id',c.organisation_id).single())
  if (org.status !== 'active') throw new LtiError('This provider is unavailable.')
  if (!enabled(c)) throw new LtiError('This LMS connection is unavailable or awaiting activation.')
  return c
}
async function object(db, c, id) {
  const o = must(await db.from('lti_skill_objects').select('*,lti_object_connections!inner(connection_id)').eq('id',id).eq('organisation_id',c.organisation_id).eq('status','draft').eq('lti_object_connections.connection_id',c.id).single())
  return o
}
async function session(db, req) {
  const [token,binding] = String(req.headers['x-lti-session'] || '').split('.')
  if (!token || !binding) throw new LtiError('Launch this skill from your LMS again.')
  const s = must(await db.from('lti_launch_sessions').select('*').eq('token_hash',hash(token)).eq('binding_hash',hash(binding)).gt('expires_at',new Date().toISOString()).single())
  const c = await connection(db,s.connection_id)
  if (s.claims.registration_hash !== fingerprint(c) || !c.deployment_ids.includes(s.deployment)) throw new LtiError('The LMS registration has changed. Launch again.')
  return { s,c }
}
async function caller(req) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  const user = bearer && await verifySupabaseUser(bearer)
  if (!user) throw new LtiError('Sign in to LearnScope to continue.')
  return user
}
async function identity(db,s,c,user) {
  const row = must(await db.from('lti_identities').select('*').eq('connection_id',c.id).eq('registration_key',identityKey(c)).eq('subject',s.subject).maybeSingle())
  if (row && row.user_id !== user.id) throw new LtiError('This LMS identity is linked to a different LearnScope account.')
  return row
}
async function runJob(db, id, config) {
  const [job] = must(await db.rpc('lti_claim_grade',{p_link:id})) || []
  if (!job) return
  try {
    const link = must(await db.from('lti_grade_links').select('*,lti_identities(*)').eq('id',id).single())
    const i = link.lti_identities
    const c = await connection(db,i.connection_id)
    const o = await object(db,c,link.object_id)
    if (!link.consent || !o.grade_passback || i.registration_key !== identityKey(c) || !c.deployment_ids.includes(link.deployment)) throw new LtiError('Grade sharing is unavailable.')
    const skill = must(await db.from('skills').select('id,level').eq('user_id',i.user_id).eq('library_skill_id',o.skill_library_id).maybeSingle())
    const assessment = skill && must(await db.from('skill_assessments').select('level').eq('skill_id',skill.id).eq('axis','practical').order('assessed_at',{ascending:false}).limit(1).maybeSingle())
    const level = skill?.level ?? assessment?.level ?? null
    if (level !== null && level !== job.delivered_level) {
      const score = buildProficiencyScore({ltiUserId:i.subject,level,timestamp:job.event_at})
      // Consent and revision are rechecked after resolving the current proficiency.
      const current = must(await db.from('lti_grade_jobs').select('revision').eq('link_id',id).single())
      if (current.revision !== job.revision) { must(await db.from('lti_grade_jobs').update({lease_until:null}).eq('link_id',id)); return }
      const sharing=must(await db.from('lti_grade_links').select('consent').eq('id',id).single())
      if(!sharing.consent) throw new LtiError('Grade sharing stopped.')
      await deliverScore(c,link.lineitem,score,config)
    }
    must(await db.from('lti_grade_jobs').update({status:level === null ? 'unassessed':'delivered',delivered_level:level ?? job.delivered_level,lease_until:null,error:null}).eq('link_id',id).eq('revision',job.revision))
  } catch {
    must(await db.from('lti_grade_jobs').update({status:'failed',error:'Delivery failed. Check LMS permissions and connection settings.',lease_until:null,next_attempt:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString()}).eq('link_id',id).eq('revision',job.revision))
  }
}
export default async function ltiHandler(req,res) {
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('X-Content-Type-Options','nosniff')
  const action = req.query.lti
  try {
    if(action === 'surface' && req.method === 'GET') {
      const origins=(process.env.LTI_FRAME_ORIGINS || '').split(',').filter(Boolean).map(value=>new URL(value).origin)
      if(origins.some(value=>!value.startsWith('https://'))) throw new LtiError('Invalid LMS framing configuration.')
      res.setHeader('Content-Security-Policy',"frame-ancestors 'self' "+origins.join(' ')+"; base-uri 'self'; object-src 'none'")
      res.setHeader('Content-Type','text/html; charset=utf-8')
      return res.status(200).send(await readFile(resolve(process.cwd(),'dist/index.html'),'utf8'))
    }
    if(['accounts','disconnect-account'].includes(action) && req.method === 'POST') {
      const user=await caller(req),db=supabaseAdmin()
      if(action === 'accounts') {
        const rows=must(await db.from('lti_identities').select('id,lti_connections(name)').eq('user_id',user.id))
        return res.status(200).json({accounts:rows.map(row=>({id:row.id,name:row.lti_connections?.name || 'LMS'}))})
      }
      const row=must(await db.from('lti_identities').select('*').eq('id',body(req).id).eq('user_id',user.id).single())
      must(await db.from('lti_identities').delete().eq('id',row.id).eq('user_id',user.id))
      must(await db.from('lti_launch_sessions').delete().eq('connection_id',row.connection_id).eq('subject',row.subject))
      return res.status(200).json({disconnected:true})
    }
    const config = toolConfig()
    const db = supabaseAdmin()
    const input = body(req)
    if (action === 'jwks' && req.method === 'GET') return res.status(200).json(publicJwks(config.jwk,JSON.parse(process.env.LTI_PREVIOUS_PUBLIC_JWKS || '[]')))
    if (action === 'worker' && req.method === 'POST') {
      if (!process.env.LTI_WORKER_SECRET || req.headers.authorization !== `Bearer ${process.env.LTI_WORKER_SECRET}`) return res.status(401).json({error:'Unauthorized'})
      const jobs = must(await db.from('lti_grade_jobs').select('link_id').in('status',['pending','failed']).lte('next_attempt',new Date().toISOString()).lt('attempts',8).order('next_attempt').limit(2))
      for (const job of jobs) await runJob(db,job.link_id,config)
      must(await db.from('lti_transactions').delete().lt('expires_at',new Date().toISOString()))
      must(await db.from('lti_launch_sessions').delete().lt('expires_at',new Date().toISOString()))
      return res.status(200).json({processed:jobs.length})
    }
    if (action === 'login' && ['GET','POST'].includes(req.method)) {
      const params = req.method === 'GET' ? req.query : input
      const rows = must(await db.from('lti_connections').select('*').eq('issuer',params.iss))
      const candidates = rows.filter(c => enabled(c) && (!params.client_id || c.client_id === params.client_id) && (!params.lti_deployment_id || c.deployment_ids.includes(params.lti_deployment_id)))
      if (candidates.length !== 1 || typeof params.login_hint !== 'string' || params.login_hint.length > 2000) throw new LtiError('Unknown or ambiguous LMS registration.')
      const c = candidates[0]
      const target = params.target_link_uri
      if (target !== config.origin+'/lti/deep-link') {
        const id = String(target).slice((config.origin+'/lti/resources/').length)
        if (target !== config.origin+'/lti/resources/'+id || !/^[0-9a-f-]{36}$/.test(id)) throw new LtiError('Invalid launch target.')
        await object(db,c,id)
      }
      const state=randomToken(), binding=randomToken(), nonce=randomToken()
      must(await db.from('lti_transactions').insert({state_hash:hash(state),binding_hash:hash(binding),nonce,connection_id:c.id,target,deployment:params.lti_deployment_id || null}))
      const auth = new URL(c.authorization_url)
      for (const [key,value] of Object.entries({scope:'openid',response_type:'id_token',response_mode:'form_post',prompt:'none',client_id:c.client_id,redirect_uri:config.origin+'/api/lti/launch',login_hint:params.login_hint,state,nonce,...(params.lti_message_hint ? {lti_message_hint:params.lti_message_hint}: {})})) auth.searchParams.set(key,value)
      return html(res,'<p id="status">Connecting to your LMS…</p>',`try { sessionStorage.setItem('lti-binding-'+${js(state)},${js(binding)}); location.replace(${js(auth.href)}); } catch { document.getElementById('status').textContent='Your browser blocked storage. Open this activity in a new window from your LMS.'; }`,new URL(c.authorization_url).origin)
    }
    if (action === 'launch' && req.method === 'POST') {
      if (typeof input.state !== 'string' || typeof input.id_token !== 'string' || input.id_token.length > 50000) throw new LtiError('Invalid launch.')
      const tx = must(await db.from('lti_transactions').select('*').eq('state_hash',hash(input.state)).eq('consumed',false).gt('expires_at',new Date().toISOString()).single())
      const c = await connection(db,tx.connection_id)
      const claims = await verifyLaunch(input.id_token,c,tx,await safeJson(c.jwks_url),config.origin)
      if (claims[CLAIM+'message_type'] === 'LtiResourceLinkRequest') await object(db,c,tx.target.split('/').pop())
      else serviceUrl(claims[DL+'deep_linking_settings'].deep_link_return_url,c)
      const consumed = must(await db.from('lti_transactions').update({consumed:true}).eq('state_hash',hash(input.state)).eq('consumed',false).gt('expires_at',new Date().toISOString()).select('state_hash'))
      if (consumed.length !== 1) throw new LtiError('This launch was already used.')
      const token=randomToken()
      // Retain only the protocol claims needed for this session, never the raw JWT.
      const saved = {registration_hash:fingerprint(c),type:claims[CLAIM+'message_type'],target:tx.target,resource:claims[CLAIM+'resource_link']?.id,context:claims[CLAIM+'context']?.title || '',ags:claims[AGS],deep:claims[DL+'deep_linking_settings']}
      must(await db.from('lti_launch_sessions').insert({token_hash:hash(token),binding_hash:tx.binding_hash,connection_id:c.id,deployment:claims[CLAIM+'deployment_id'],subject:claims.sub,claims:saved}))
      return html(res,'<p id="status">Opening your skill…</p>',`const binding=sessionStorage.getItem('lti-binding-'+${js(input.state)}); if(binding){sessionStorage.removeItem('lti-binding-'+${js(input.state)});sessionStorage.setItem('lti-session',${js(token)}+'.'+binding);location.replace('/lti/session');}else{document.getElementById('status').textContent='Launch could not be matched to this browser. Open the activity in a new window from your LMS and try again.';}`,new URL(c.authorization_url).origin)
    }
    if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'})
    if (req.headers.origin !== config.origin) return res.status(403).json({error:'Invalid request origin'})
    if (action === 'setup') {
      const user=await caller(req)
      const c=must(await db.from('lti_connections').select('*').eq('id',input.connectionId).single())
      if (!must(await db.rpc('is_org_admin',{org_id:c.organisation_id,check_user_id:user.id}))) throw new LtiError('Provider administrator access required.')
      return res.status(200).json({fingerprint:fingerprint(c),enabled:enabled(c),login:config.origin+'/api/lti/login',launch:config.origin+'/api/lti/launch',jwks:config.origin+'/api/lti/jwks',deepLink:config.origin+'/lti/deep-link'})
    }
    const {s,c} = await session(db,req)
    if (s.claims.type === 'LtiDeepLinkingRequest') {
      if (s.used) throw new LtiError('This selection has already been submitted. Open the LMS picker again.')
      if (action === 'session') {
        const objects=must(await db.from('lti_skill_objects').select('id,title,description,grade_passback,lti_object_connections!inner(connection_id)').eq('organisation_id',c.organisation_id).eq('status','draft').eq('lti_object_connections.connection_id',c.id))
        return res.status(200).json({type:'picker',objects})
      }
      if (action !== 'select') throw new LtiError('Invalid picker action.')
      const o=await object(db,c,input.objectId)
      const item={type:'ltiResourceLink',title:o.title,text:o.description,url:config.origin+'/lti/resources/'+o.id,custom:{learnscope_resource_id:o.id},presentation:{documentTarget:s.claims.deep.accept_presentation_document_targets.includes('iframe')?'iframe':'window'}}
      if(o.grade_passback) item.lineItem={scoreMaximum:5,label:o.title,resourceId:o.id,tag:'proficiency'}
      const jwt=await sign({[CLAIM+'deployment_id']:s.deployment,[CLAIM+'message_type']:'LtiDeepLinkingResponse',[CLAIM+'version']:'1.3.0',[DL+'content_items']:[item],...(s.claims.deep.data !== undefined ? {[DL+'data']:s.claims.deep.data}:{})},c.client_id,c.issuer,config)
      const consumed=must(await db.from('lti_launch_sessions').update({used:true}).eq('token_hash',s.token_hash).eq('used',false).select('token_hash'))
      if(consumed.length !== 1) throw new LtiError('Selection already submitted.')
      return res.status(200).json({jwt,returnUrl:serviceUrl(s.claims.deep.deep_link_return_url,c)})
    }
    const o=await object(db,c,s.claims.target.split('/').pop())
    if(action === 'session' && !req.headers.authorization) return res.status(200).json({type:'learner',title:o.title,description:o.description,loginRequired:true})
    const user=await caller(req)
    let i=await identity(db,s,c,user)
    if(action === 'link') {
      if(input.confirm !== true) throw new LtiError('Confirm account linking to continue.')
      if(!i) i=must(await db.from('lti_identities').insert({connection_id:c.id,registration_key:identityKey(c),subject:s.subject,user_id:user.id}).select('*').single())
    }
    if(action === 'disconnect') {
      if(i) must(await db.from('lti_identities').delete().eq('id',i.id).eq('user_id',user.id))
      must(await db.from('lti_launch_sessions').delete().eq('connection_id',c.id).eq('subject',s.subject))
      return res.status(200).json({disconnected:true})
    }
    if(!i) return res.status(200).json({type:'learner',title:o.title,linkRequired:true,lms:c.name})
    if(action === 'add') {
      const existing=must(await db.from('skills').select('id').eq('user_id',user.id).eq('library_skill_id',o.skill_library_id).maybeSingle())
      if(!existing) {
        const library=must(await db.from('skill_library').select('name,category,status').eq('id',o.skill_library_id).single())
        if(library.status !== 'active') throw new LtiError('This catalogue skill is unavailable.')
        const result=await db.from('skills').insert({user_id:user.id,name:library.name,category:library.category,library_skill_id:o.skill_library_id,level:null,is_current_role:false,tracking_reason:'career_development',lifecycle_stage:'identified'})
        if(result.error) throw new LtiError('A skill with this name may already exist in your profile. Open LearnScope to review it before adding another.')
      }
    }
    const skill=must(await db.from('skills').select('id').eq('user_id',user.id).eq('library_skill_id',o.skill_library_id).maybeSingle())
    const ags=s.claims.ags
    const canGrade=Boolean(o.grade_passback && Array.isArray(ags?.scope) && ags.scope.includes(SCORE_SCOPE) && ags?.lineitem)
    let link=must(await db.from('lti_grade_links').select('*').eq('identity_id',i.id).eq('deployment',s.deployment).eq('resource_link',s.claims.resource).maybeSingle())
    if(link && (link.object_id !== o.id || link.lineitem !== ags?.lineitem)) throw new LtiError('This LMS resource has changed. Disconnect and relaunch before sharing a grade.')
    if(action === 'consent') {
      if(!canGrade) throw new LtiError('This LMS launch does not provide grade delivery permissions.')
      const values={identity_id:i.id,object_id:o.id,deployment:s.deployment,resource_link:s.claims.resource,lineitem:serviceUrl(ags.lineitem,c),consent:input.consent === true,consented_at:new Date().toISOString()}
      link=must(await db.from('lti_grade_links').upsert(values,{onConflict:'identity_id,deployment,resource_link'}).select('*').single())
      if(link.consent) must(await db.rpc('lti_queue_grade',{p_link:link.id}))
    }
    if(action === 'sync') {
      if(!link?.consent || !canGrade) throw new LtiError('Allow proficiency sharing first.')
      must(await db.rpc('lti_queue_grade',{p_link:link.id}))
      await runJob(db,link.id,config)
    }
    const job=link && must(await db.from('lti_grade_jobs').select('status,error').eq('link_id',link.id).maybeSingle())
    return res.status(200).json({type:'learner',title:o.title,description:o.description,libraryId:o.skill_library_id,skillId:skill?.id,targetLevel:o.target_level,canGrade,consent:link?.consent || false,grade:job,context:s.claims.context})
  } catch (error) {
    const message = error instanceof LtiError && error.message !== 'LTI storage operation failed.' ? error.message : 'This launch is unavailable, expired, or no longer authorised. Launch again from your LMS.'
    if(['login','launch'].includes(action)) return html(res,`<p>${escape(message)}</p><p>Return to your LMS and open the activity in a new window to try again.</p>`)
    return res.status(400).json({error:message})
  }
}
