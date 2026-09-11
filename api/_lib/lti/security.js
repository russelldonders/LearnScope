import { lookup } from 'node:dns/promises'
import { randomBytes, createHash } from 'node:crypto'
import { Agent, fetch } from 'undici'
import ipaddr from 'ipaddr.js'
import { createLocalJWKSet, jwtVerify, importJWK, SignJWT } from 'jose'

export class LtiError extends Error {}
export const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/'
export const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim/'
export const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint'
export const SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score'
export const randomToken = () => randomBytes(32).toString('base64url')
export const hash = value => createHash('sha256').update(value).digest('hex')
export function httpsUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') throw new LtiError('An HTTPS endpoint on port 443 is required.')
  return url
}
export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}
// Resolve once, validate every answer, then pin the connection to that answer.
// Redirects cannot move a credential-bearing request to another host.
export async function safeJson(url, options = {}) {
  const target = httpsUrl(url)
  const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true })
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new LtiError('The LMS endpoint must resolve to a public address.')
  const agent = new Agent({ connect: { lookup: (_host, opts, cb) => opts.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family) } })
  try {
    const response = await fetch(target, { ...options, dispatcher: agent, redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new LtiError(`LMS request failed (${response.status}).`)
    if (response.status === 204) return null
    let text = ''
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString('utf8')
      if (text.length > 1_000_000) throw new LtiError('LMS response exceeds the size limit.')
    }
    return text ? JSON.parse(text) : null
  } finally { await agent.close() }
}
export function toolConfig(env = process.env) {
  const origin = httpsUrl(env.LTI_TOOL_ORIGIN).origin
  if (env.LTI_TOOL_ORIGIN !== origin) throw new LtiError('LTI_TOOL_ORIGIN must be an HTTPS origin without a trailing slash.')
  let jwk
  try { jwk = JSON.parse(env.LTI_PRIVATE_JWK || 'null') } catch { throw new LtiError('The LTI signing key needs configuration.') }
  if (!jwk?.d || !jwk.kid || jwk.kty !== 'RSA') throw new LtiError('Configure a private RSA signing JWK with a unique kid.')
  return { origin, jwk }
}
export function publicJwks(jwk, oldKeys = []) {
  return { keys: [jwk, ...oldKeys].map(k => ({ kty: 'RSA', kid: k.kid, n: k.n, e: k.e, use: 'sig', alg: 'RS256' })) }
}
export async function sign(payload, issuer, audience, config) {
  const key = await importJWK(config.jwk, 'RS256')
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: config.jwk.kid }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').setJti(randomToken()).sign(key)
}
export function instructor(roles) {
  return Array.isArray(roles) && roles.some(role => [
    'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    'http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper',
  ].includes(role))
}
export async function verifyLaunch(token, registration, transaction, jwks, origin) {
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    algorithms: ['RS256'], issuer: registration.issuer, audience: registration.client_id,
    requiredClaims: ['exp', 'iat', 'sub', 'nonce'], maxTokenAge: '5m', clockTolerance: 5,
  })
  if (payload.iat > Date.now() / 1000 + 5 || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 500) throw new LtiError('Invalid launch subject or time.')
  if (payload.azp !== undefined && payload.azp !== registration.client_id || Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== registration.client_id) throw new LtiError('Invalid authorised party.')
  if (payload.nonce !== transaction.nonce || payload[CLAIM + 'version'] !== '1.3.0') throw new LtiError('Invalid launch nonce or version.')
  const deployment = payload[CLAIM + 'deployment_id']
  if (!registration.deployment_ids.includes(deployment) || transaction.deployment && deployment !== transaction.deployment) throw new LtiError('Deployment is not registered.')
  if (payload[CLAIM + 'target_link_uri'] !== transaction.target) throw new LtiError('Launch target mismatch.')
  const roles = payload[CLAIM + 'roles']
  if (!Array.isArray(roles) || roles.some(r => typeof r !== 'string')) throw new LtiError('Missing launch roles.')
  const type = payload[CLAIM + 'message_type']
  if (type === 'LtiResourceLinkRequest') {
    const resourceId=payload[CLAIM + 'resource_link']?.id
    if (typeof resourceId !== 'string' || !resourceId || resourceId.length > 500 || !new RegExp('^' + origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/lti/resources/[0-9a-f-]{36}$').test(transaction.target)) throw new LtiError('Invalid resource link.')
  } else if (type === 'LtiDeepLinkingRequest') {
    const settings = payload[DL + 'deep_linking_settings']
    if (!instructor(roles) || transaction.target !== origin + '/lti/deep-link' || !Array.isArray(settings?.accept_types) || !settings.accept_types.includes('ltiResourceLink')) throw new LtiError('This launch cannot select skill objects.')
    httpsUrl(settings.deep_link_return_url)
    if (!Array.isArray(settings.accept_presentation_document_targets) || !settings.accept_presentation_document_targets.some(t => ['iframe', 'window'].includes(t))) throw new LtiError('The LMS must accept an iframe or window presentation.')
  } else throw new LtiError('Unsupported LTI message type.')
  return payload
}
export function serviceUrl(value, registration) {
  const url = httpsUrl(value)
  const approved = (process.env.LTI_SERVICE_ORIGINS || '').split(',').filter(Boolean)
  if (![new URL(registration.issuer).origin, new URL(registration.authorization_url).origin, ...approved].includes(url.origin)) throw new LtiError('The LMS service origin is not approved.')
  return url.href
}
export async function deliverScore(registration, lineitem, payload, config, request = safeJson) {
  const token = await sign({ sub: registration.client_id }, registration.client_id, registration.token_url, config)
  const auth = await request(registration.token_url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: token, scope: SCORE_SCOPE }).toString() })
  if (!auth?.access_token || auth.token_type?.toLowerCase() !== 'bearer' || auth.scope && !auth.scope.split(' ').includes(SCORE_SCOPE)) throw new LtiError('LMS did not grant score delivery.')
  const endpoint = new URL(serviceUrl(lineitem, registration))
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/scores'
  await request(endpoint.href, { method: 'POST', headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/vnd.ims.lis.v1.score+json' }, body: JSON.stringify(payload) })
}
