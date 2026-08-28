import { describe, expect, it } from 'vitest'
import { AGENT_PROVIDER_CAPABILITIES } from '../../../src/contexts/settings/domain/agentSettings.providerMeta'

describe('agent provider capabilities', () => {
  it('documents pi session JSONL runtime observation', () => {
    expect(AGENT_PROVIDER_CAPABILITIES.pi.runtimeObservation).toBe('jsonl')
  })
})
