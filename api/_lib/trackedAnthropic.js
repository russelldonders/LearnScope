import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabaseAdmin.js'

export const AI_PRICING_VERSION = '2026-11-15'

// USD per million tokens. At this scale the numeric rate also equals
// micro-USD per token, which lets the database retain integer costs.
const MODEL_PRICING = [
  {
    matches: (model) => model.startsWith('claude-haiku-4-5'),
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
  {
    matches: (model) => model.startsWith('claude-opus-5'),
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
]

let anthropicClient

function getAnthropicClient() {
  anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropicClient
}

function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function estimateAnthropicCostMicroUsd(model, usage = {}) {
  const pricing = MODEL_PRICING.find((entry) => entry.matches(model))
  if (!pricing) return 0

  const cacheCreation = usage.cache_creation ?? {}
  const cacheWrite1h = nonNegativeNumber(cacheCreation.ephemeral_1h_input_tokens)
  const explicitCacheWrite5m = nonNegativeNumber(cacheCreation.ephemeral_5m_input_tokens)
  const aggregateCacheWrite = nonNegativeNumber(usage.cache_creation_input_tokens)
  const cacheWrite5m = explicitCacheWrite5m || Math.max(0, aggregateCacheWrite - cacheWrite1h)
  const batchMultiplier = usage.service_tier === 'batch' ? 0.5 : 1

  return Math.round(batchMultiplier * (
    nonNegativeNumber(usage.input_tokens) * pricing.input
    + nonNegativeNumber(usage.output_tokens) * pricing.output
    + cacheWrite5m * pricing.cacheWrite5m
    + cacheWrite1h * pricing.cacheWrite1h
    + nonNegativeNumber(usage.cache_read_input_tokens) * pricing.cacheRead
  ))
}

function usageRow({ feature, userId, organisationId, model, status, response, error, durationMs }) {
  const usage = response?.usage ?? {}
  const metadata = {}
  if (usage.service_tier) metadata.serviceTier = usage.service_tier
  if (usage.inference_geo) metadata.inferenceGeo = usage.inference_geo

  return {
    user_id: userId ?? null,
    organisation_id: organisationId ?? null,
    feature,
    provider: 'anthropic',
    model,
    status,
    request_id: response?._request_id ?? error?.request_id ?? null,
    input_tokens: nonNegativeNumber(usage.input_tokens),
    output_tokens: nonNegativeNumber(usage.output_tokens),
    thinking_tokens: nonNegativeNumber(usage.output_tokens_details?.thinking_tokens),
    cache_creation_input_tokens: nonNegativeNumber(usage.cache_creation_input_tokens),
    cache_read_input_tokens: nonNegativeNumber(usage.cache_read_input_tokens),
    duration_ms: Math.max(0, Math.round(durationMs)),
    estimated_cost_micro_usd: estimateAnthropicCostMicroUsd(model, usage),
    pricing_version: AI_PRICING_VERSION,
    error_code: error ? String(error.error?.type ?? error.code ?? error.status ?? error.name ?? 'unknown') : null,
    metadata,
  }
}

async function recordUsage(row) {
  try {
    const { error } = await supabaseAdmin().from('ai_usage_events').insert(row)
    if (error) throw error
  } catch (error) {
    // Metering is fail-open: an observability outage must not break the user
    // feature whose usage it is trying to describe.
    console.error('ai usage event write failed:', error)
  }
}

export async function createTrackedMessage({ feature, userId, organisationId = null, params }) {
  if (!feature || !params?.model) throw new Error('Tracked AI requests require feature and model')

  const startedAt = Date.now()
  try {
    const response = await getAnthropicClient().messages.create(params)
    await recordUsage(usageRow({
      feature,
      userId,
      organisationId,
      model: params.model,
      status: response.stop_reason === 'refusal' ? 'refusal' : 'success',
      response,
      durationMs: Date.now() - startedAt,
    }))
    return response
  } catch (error) {
    await recordUsage(usageRow({
      feature,
      userId,
      organisationId,
      model: params.model,
      status: 'error',
      error,
      durationMs: Date.now() - startedAt,
    }))
    throw error
  }
}
