import { expect, it } from 'vitest'
import { PromptDeliveryRecords } from '../../../src/contexts/agent/application/PromptDeliveryRecords'
import { PromptDeliveryEvidence } from '../../../src/contexts/agent/application/PromptDeliveryEvidence'
import { samePromptEntry } from '../../../src/contexts/agent/application/promptAdmission'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'

it('does not let retired closed unknown records exhaust capacity after 40 conversations', () => {
  const f = promptDeliveryRuntimeFixture()
  const records = new PromptDeliveryRecords(() => 1000)
  try {
    for (let generation = 1; generation <= 40; generation++) {
      const fence = {
        ...f.registry.readFence({ sessionId: 's' })!,
        conversationGeneration: generation,
      }
      expect(records.blocking(fence)).toBeUndefined()
      const record = records.allocate(String(generation), fence, 'turn')
      expect(record).toBeDefined()
      record!.dto.status = 'unknown'
      records.stopReconciliation(record!)
      expect(records.blocking(fence)).toBe(record)
    }
    expect(records.records.size).toBe(32)
    expect(records.get('1')).toMatchObject({ available: false, reason: 'unavailable' })
    expect(records.get('40')).toMatchObject({ available: true, status: 'unknown' })
  } finally {
    records.dispose()
    f.dispose()
  }
})
it('checks source generation independently of the current fence in both receipt streams', () => {
  const f = promptDeliveryRuntimeFixture()
  try {
    const fence = { ...f.registry.readFence({ sessionId: 's' })!, conversationGeneration: 2 }
    expect(samePromptEntry(fence, { ...fence, conversationGeneration: 1 })).toBe(false)
    const records = new PromptDeliveryRecords(() => 1000)
    const record = records.allocate('d', fence, 'turn')!
    record.submitAt = 1000
    const evidence = new PromptDeliveryEvidence(true)
    evidence.capture(fence, { providerSessionId: 'B' })
    const receipt = {
      fence,
      conversationGeneration: 1,
      providerSessionId: 'B',
      promptId: 'b',
      turnId: 't',
      source: 'claude_hook',
      hookEventName: 'UserPromptSubmit',
      sourceSequence: 20,
      emittedAtMs: 1000,
    }
    expect(evidence.qualify(receipt, record, 1000)).toBeUndefined()
    expect(evidence.qualify({ ...receipt, conversationGeneration: 2 }, record, 1000)).toMatchObject(
      { turnId: 't' },
    )
  } finally {
    f.dispose()
  }
})
