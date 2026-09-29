import { describe, expect, it } from 'vitest'
import { TRUST_STATUS, computeTrustStatus, isPersonValidated } from './skillProficiencyModel'

describe('isPersonValidated', () => {
  it('needs both a maintaining-phase skill and a validation a person confirmed', () => {
    expect(isPersonValidated('validated', true)).toBe(true)
    expect(isPersonValidated('maintained', true)).toBe(true)
    expect(isPersonValidated('validated', false)).toBe(false)
    expect(isPersonValidated('developing', true)).toBe(false)
  })

  it('leaves an AI-passed skill on the tier its own evidence supports', () => {
    const aiPassed = { axis: 'practical', evidenceCount: 3, formallyValidated: isPersonValidated('validated', false) }
    expect(computeTrustStatus(aiPassed)).toBe(TRUST_STATUS.EVIDENCE_SUPPORTED)
  })
})
