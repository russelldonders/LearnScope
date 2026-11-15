import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  insertUsage: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mocks.createMessage }
  },
}))

vi.mock('./supabaseAdmin.js', () => ({
  supabaseAdmin: () => ({
    from: (table) => {
      if (table !== 'ai_usage_events') throw new Error(`Unexpected table: ${table}`)
      return { insert: mocks.insertUsage }
    },
  }),
}))

import { createTrackedMessage, estimateAnthropicCostMicroUsd } from './trackedAnthropic.js'

describe('tracked Anthropic usage', () => {
  beforeEach(() => {
    mocks.createMessage.mockReset()
    mocks.insertUsage.mockReset().mockResolvedValue({ error: null })
  })

  it('prices the models used by LearnScope, including prompt caching', () => {
    expect(estimateAnthropicCostMicroUsd('claude-haiku-4-5-20251001', {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 50,
    })).toBe(218)
    expect(estimateAnthropicCostMicroUsd('claude-opus-5', {
      input_tokens: 100,
      output_tokens: 20,
    })).toBe(1000)
    expect(estimateAnthropicCostMicroUsd('future-model', { input_tokens: 100 })).toBe(0)
  })

  it('records successful requests without prompts or generated content', async () => {
    const providerResponse = {
      _request_id: 'req_123',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'private generated content' }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens_details: { thinking_tokens: 5 },
        service_tier: 'standard',
        inference_geo: 'global',
      },
    }
    mocks.createMessage.mockResolvedValue(providerResponse)

    const result = await createTrackedMessage({
      feature: 'course_draft_generation',
      userId: 'user-1',
      organisationId: 'org-1',
      params: {
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'private prompt' }],
      },
    })

    expect(result).toBe(providerResponse)
    expect(mocks.insertUsage).toHaveBeenCalledTimes(1)
    const row = mocks.insertUsage.mock.calls[0][0]
    expect(row).toMatchObject({
      feature: 'course_draft_generation',
      user_id: 'user-1',
      organisation_id: 'org-1',
      request_id: 'req_123',
      status: 'success',
      input_tokens: 100,
      output_tokens: 20,
      thinking_tokens: 5,
      estimated_cost_micro_usd: 200,
      metadata: { serviceTier: 'standard', inferenceGeo: 'global' },
    })
    expect(JSON.stringify(row)).not.toContain('private prompt')
    expect(JSON.stringify(row)).not.toContain('private generated content')
  })

  it('records provider failures and rethrows them', async () => {
    const providerError = Object.assign(new Error('rate limited'), {
      status: 429,
      request_id: 'req_failed',
    })
    mocks.createMessage.mockRejectedValue(providerError)

    await expect(createTrackedMessage({
      feature: 'cv_parsing',
      userId: 'user-1',
      params: { model: 'claude-opus-5', messages: [] },
    })).rejects.toBe(providerError)

    expect(mocks.insertUsage).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'cv_parsing',
      status: 'error',
      error_code: '429',
      request_id: 'req_failed',
      input_tokens: 0,
      output_tokens: 0,
    }))
  })
})
