import { describe, expect, it } from 'vitest'
import {
  AGENT_PROVIDER_DESCRIPTORS,
  isTerminalAgentShimProvider,
} from '../../../src/shared/contracts/agentProviderDescriptors'
import { AGENT_PROVIDER_IDS, isAgentProviderId } from '../../../src/shared/contracts/dto'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import {
  AGENT_PROVIDER_CAPABILITIES,
  AGENT_PROVIDER_LABEL,
} from '../../../src/contexts/settings/domain/agentSettings.providerMeta'

describe('agent provider descriptors', () => {
  it('has exactly one entry per provider id', () => {
    expect(Object.keys(AGENT_PROVIDER_DESCRIPTORS).sort()).toEqual([...AGENT_PROVIDER_IDS].sort())
  })

  it('recognizes provider ids and rejects everything else', () => {
    for (const id of AGENT_PROVIDER_IDS) {
      expect(isAgentProviderId(id)).toBe(true)
    }
    for (const value of ['', 'Codex', 'constructor', '__proto__', null, undefined, 1, {}]) {
      expect(isAgentProviderId(value)).toBe(false)
    }
  })

  it('derives the terminal activity shim set from the capability', () => {
    const shim = AGENT_PROVIDER_IDS.filter(id => isTerminalAgentShimProvider(id))
    expect(shim).toEqual(['claude-code', 'codex', 'pi'])
    for (const value of ['constructor', 'Codex', '', null, 3]) {
      expect(isTerminalAgentShimProvider(value)).toBe(false)
    }
  })

  it('feeds the settings labels and capabilities without copies', () => {
    for (const id of AGENT_PROVIDER_IDS) {
      expect(AGENT_PROVIDER_LABEL[id]).toBe(AGENT_PROVIDER_DESCRIPTORS[id].label)
      expect(AGENT_PROVIDER_CAPABILITIES[id]).toBe(AGENT_PROVIDER_DESCRIPTORS[id].capabilities)
    }
  })

  it('names each contribution from the descriptor label', () => {
    const contributions = createBuiltinAgentProviderContributions()
    expect(contributions.map(contribution => contribution.descriptor.id)).toEqual([
      ...AGENT_PROVIDER_IDS,
    ])
    for (const contribution of contributions) {
      expect(contribution.descriptor.displayName).toBe(
        AGENT_PROVIDER_DESCRIPTORS[contribution.descriptor.id].label,
      )
    }
  })
})
