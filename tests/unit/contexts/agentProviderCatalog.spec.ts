import { describe, expect, it } from 'vitest'
import { AgentProviderRegistry } from '../../../src/contexts/agent/application/services/AgentProviderRegistry'
import {
  createBuiltinAgentProviderContributions,
  resolveAgentProviderCatalog,
} from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import type { AgentProviderContribution } from '../../../src/contexts/agent/application/ports/AgentProviderContribution'

function contribution(id: 'claude-code' | 'codex'): AgentProviderContribution {
  return {
    descriptor: {
      displayName: id,
      documentationUrl: 'https://example.com',
      id,
      launch: { defaultArguments: [], defaultEnvironment: {}, executable: id },
    },
    detector: {
      inspect: async () => ({
        provider: id,
        command: id,
        status: 'unavailable',
        executablePath: null,
        source: null,
        diagnostics: [],
      }),
    },
    launcher: {
      createLaunchPlan: async () => ({
        args: [],
        command: id,
        effectiveModel: null,
        env: {},
        launchMode: 'new',
        resumeSessionId: null,
      }),
    },
  }
}

describe('built-in Agent Provider catalog', () => {
  it('resolves formal contributions before generic entries in union order', () => {
    const contributions = createBuiltinAgentProviderContributions()
    expect(contributions.map(item => item.descriptor.id)).toEqual([
      'claude-code',
      'codex',
      'opencode',
      'gemini',
      'pi',
      'kimi',
    ])

    const registry = new AgentProviderRegistry(contributions)
    expect(registry.require('claude-code')).toBe(contributions[0])
    expect(registry.require('pi').descriptor.launch.executable).toBe('pi')
    expect(registry.require('kimi').descriptor.launch.executable).toBe('kimi')
    expect(registry.listDescriptors()).toHaveLength(6)
  })

  it('throws immediately when the union has no formal or generic entry', () => {
    const formal = new Map([['claude-code' as const, contribution('claude-code')]])
    const generic = new Map([['codex' as const, contribution('codex')]])

    expect(() =>
      resolveAgentProviderCatalog(['claude-code', 'codex', 'gemini'], formal, generic),
    ).toThrow('Missing built-in Agent Provider: gemini')
  })

  it('rejects duplicate registry entries', () => {
    expect(() => new AgentProviderRegistry([contribution('codex'), contribution('codex')])).toThrow(
      'registered more than once',
    )
  })
})
