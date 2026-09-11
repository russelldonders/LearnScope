// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, importJWK } from 'jose'
import { CLAIM, DL, SCORE_SCOPE, verifyLaunch, publicAddress, httpsUrl, publicJwks, deliverScore, serviceUrl } from './security.js'
let pair, jwks, privateJwk
const c={issuer:'https://lms.example',client_id:'client',deployment_ids:['deployment'],authorization_url:'https://lms.example/auth',token_url:'https://lms.example/token'}
const tx={nonce:'nonce',target:'https://tool.example/lti/resources/00000000-0000-0000-0000-000000000001'}
const claims=()=>({sub:'learner-1',nonce:'nonce',[CLAIM+'version']:'1.3.0',[CLAIM+'deployment_id']:'deployment',[CLAIM+'target_link_uri']:tx.target,[CLAIM+'message_type']:'LtiResourceLinkRequest',[CLAIM+'resource_link']:{id:'resource'},[CLAIM+'roles']:['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner']})
async function token(overrides={},options={}) {return new SignJWT({...claims(),...overrides}).setProtectedHeader({alg:'RS256',kid:options.kid || 'key'}).setIssuer(options.issuer || c.issuer).setAudience(options.audience || c.client_id).setIssuedAt().setExpirationTime(options.expires || '5m').sign(options.key || pair.privateKey)}
beforeAll(async()=>{pair=await generateKeyPair('RS256',{extractable:true});const pub=await exportJWK(pair.publicKey);privateJwk={...await exportJWK(pair.privateKey),kid:'key'};jwks={keys:[{...pub,kid:'key',alg:'RS256'}]}})
describe('LTI launch validation',()=>{
 it('accepts a signed registered learner launch',async()=>expect((await verifyLaunch(await token(),c,tx,jwks,'https://tool.example')).sub).toBe('learner-1'))
 it.each([{nonce:'forged'},{[CLAIM+'deployment_id']:'other'},{[CLAIM+'version']:'1.1.0'},{[CLAIM+'target_link_uri']:'https://attacker.example'},{[CLAIM+'roles']:null},{[CLAIM+'message_type']:'other'},{[CLAIM+'resource_link']:{}},{azp:'other'}])('rejects invalid claims %j',async patch=>{await expect(verifyLaunch(await token(patch),c,tx,jwks,'https://tool.example')).rejects.toThrow()})
 it.each([{issuer:'https://other.example'},{audience:'other'},{kid:'unknown'},{expires:'-1m'}])('rejects invalid JWT metadata %j',async options=>{await expect(verifyLaunch(await token({},options),c,tx,jwks,'https://tool.example')).rejects.toThrow()})
 it('rejects a forged signature',async()=>{const other=await generateKeyPair('RS256');await expect(verifyLaunch(await token({},{key:other.privateKey}),c,tx,jwks,'https://tool.example')).rejects.toThrow()})
 it('requires azp for multiple audiences',async()=>{await expect(verifyLaunch(await token({},{audience:['client','another']}),c,tx,jwks,'https://tool.example')).rejects.toThrow()})
 it('checks the deployment hint independently',async()=>{await expect(verifyLaunch(await token(),c,{...tx,deployment:'other'},jwks,'https://tool.example')).rejects.toThrow()})
 it('requires an instructor and compatible content types for Deep Linking',async()=>{
  const target='https://tool.example/lti/deep-link', patch={[CLAIM+'target_link_uri']:target,[CLAIM+'message_type']:'LtiDeepLinkingRequest',[DL+'deep_linking_settings']:{accept_types:['ltiResourceLink'],accept_presentation_document_targets:['window'],deep_link_return_url:'https://lms.example/return'}}
  await expect(verifyLaunch(await token(patch),c,{...tx,target},jwks,'https://tool.example')).rejects.toThrow()
  patch[CLAIM+'roles']=['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor']
  expect((await verifyLaunch(await token(patch),c,{...tx,target},jwks,'https://tool.example'))[CLAIM+'message_type']).toBe('LtiDeepLinkingRequest')
 })
})
describe('network and signing boundaries',()=>{
 it.each(['127.0.0.1','10.1.2.3','169.254.169.254','192.168.0.1','::1','::ffff:127.0.0.1','fc00::1','100.64.0.1','0.0.0.0'])('rejects non-public IP %s',address=>expect(publicAddress(address)).toBe(false))
 it('accepts public addresses',()=>expect(publicAddress('8.8.8.8')).toBe(true))
 it.each(['http://lms.example','https://user:pass@lms.example','https://lms.example:8443','https://lms.example/#fragment'])('rejects unsafe endpoints %s',url=>expect(()=>httpsUrl(url)).toThrow())
 it('rejects an unapproved service origin',()=>expect(()=>serviceUrl('https://untrusted.example/score',c)).toThrow())
 it('never publishes private key parameters',()=>expect(publicJwks(privateJwk).keys[0]).not.toHaveProperty('d'))
 it('authenticates with a signed client assertion and sends only the proficiency score',async()=>{
  const calls=[],score={userId:'lms-subject',scoreGiven:3,scoreMaximum:5,timestamp:'2026-09-07T10:00:00Z',activityProgress:'Completed',gradingProgress:'FullyGraded'}
  await deliverScore(c,'https://lms.example/lineitems/1?course=2',score,{jwk:privateJwk},async(url,options)=>{calls.push({url,options});return calls.length===1?{access_token:'secret',token_type:'Bearer',scope:SCORE_SCOPE}:null})
  const assertion=new URLSearchParams(calls[0].options.body).get('client_assertion')
  expect((await jwtVerify(assertion,await importJWK(jwks.keys[0]),{issuer:'client',audience:c.token_url})).payload.sub).toBe('client')
  expect(calls[1].url).toBe('https://lms.example/lineitems/1/scores?course=2')
  expect(JSON.parse(calls[1].options.body)).toEqual(score)
 })
})
