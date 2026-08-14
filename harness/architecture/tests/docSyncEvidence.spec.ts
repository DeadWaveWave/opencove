import { describe, expect, it } from 'vitest'
import { isContractSyncEvidence } from '../lib/doc-sync-evidence.mjs'

describe('architecture contract sync evidence', () => {
  it('accepts a Control Surface contract test for an operation-only contract change', () => {
    expect(isContractSyncEvidence('tests/contract/controlSurface.sshConfigHosts.spec.ts')).toBe(
      true,
    )
  })

  it('does not accept unrelated unit tests as architecture contract evidence', () => {
    expect(isContractSyncEvidence('tests/unit/contexts/example.spec.ts')).toBe(false)
  })
})
