import { describe, expect, it } from 'vitest'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { normalizeProvider } from '../../../src/shared/contracts/normalizeAgentProvider'
import { isAgentProvider } from '../../../src/shared/sync/persistedStateValidationPrimitives'
import {
  normalizeTerminalAgentReexecInput,
  toTerminalAgentActivityFence,
} from '../../../src/shared/runtime/terminalAgentReexec'
import { normalizeTerminalAgentActivitySnapshot } from '../../../src/shared/runtime/terminalAgentActivity'
import {
  AGENT_PROVIDER_CAPABILITIES,
  AGENT_PROVIDER_LABEL,
} from '../../../src/contexts/settings/domain/agentSettings.providerMeta'
import { isValidProvider } from '../../../src/contexts/settings/domain/agentSettings.providers'
import { providerTitlePrefix } from '../../../src/contexts/workspace/presentation/renderer/utils/agentTitle'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { parseBrowserPtyMetadata } from '../../../src/app/renderer/browser/BrowserPtyMetadata'

// These pin the observable outputs of the per-provider decisions before they move behind the
// provider descriptor table, so the migration cannot change behaviour.

const PROVIDERS = ['claude-code', 'codex', 'opencode', 'gemini', 'pi', 'kimi'] as const
const SHIM_PROVIDERS = ['claude-code', 'codex', 'pi'] as const
const NOT_PROVIDERS = ['', 'Codex', 'claude', 'claude_code', ' codex', null, undefined, 1, {}, []]

describe('agent provider behavior (pinned)', () => {
  it('has exactly the six providers, in order', () => {
    expect([...AGENT_PROVIDER_IDS]).toEqual([...PROVIDERS])
  })

  it('validates provider ids identically in every validator', () => {
    for (const provider of PROVIDERS) {
      expect(isValidProvider(provider)).toBe(true)
      expect(isAgentProvider(provider)).toBe(true)
      expect(normalizeProvider(provider)).toBe(provider)
    }
    for (const value of NOT_PROVIDERS) {
      expect(isValidProvider(value)).toBe(false)
      expect(isAgentProvider(value)).toBe(false)
      expect(() => normalizeProvider(value)).toThrow()
    }
  })

  it('keeps the labels', () => {
    expect(AGENT_PROVIDER_LABEL).toEqual({
      'claude-code': 'Claude Code',
      codex: 'Codex',
      opencode: 'OpenCode',
      gemini: 'Gemini CLI',
      pi: 'Pi',
      kimi: 'Kimi Code',
    })
  })

  it('keeps the capability flags', () => {
    const flags = Object.fromEntries(
      PROVIDERS.map(provider => {
        const { taskTitle, worktreeNameSuggestion, runtimeObservation, experimental } =
          AGENT_PROVIDER_CAPABILITIES[provider]
        return [provider, { taskTitle, worktreeNameSuggestion, runtimeObservation, experimental }]
      }),
    )
    expect(flags).toEqual({
      'claude-code': {
        taskTitle: true,
        worktreeNameSuggestion: true,
        runtimeObservation: 'jsonl',
        experimental: false,
      },
      codex: {
        taskTitle: true,
        worktreeNameSuggestion: true,
        runtimeObservation: 'jsonl',
        experimental: false,
      },
      opencode: {
        taskTitle: false,
        worktreeNameSuggestion: false,
        runtimeObservation: 'provider-api',
        experimental: false,
      },
      gemini: {
        taskTitle: false,
        worktreeNameSuggestion: false,
        runtimeObservation: 'none',
        experimental: false,
      },
      pi: {
        taskTitle: false,
        worktreeNameSuggestion: false,
        runtimeObservation: 'jsonl',
        experimental: false,
      },
      kimi: {
        taskTitle: false,
        worktreeNameSuggestion: false,
        runtimeObservation: 'jsonl',
        experimental: false,
      },
    })
  })

  it('keeps the title prefixes', () => {
    expect(
      Object.fromEntries(PROVIDERS.map(provider => [provider, providerTitlePrefix(provider)])),
    ).toEqual({
      'claude-code': 'claude',
      codex: 'codex',
      opencode: 'opencode',
      gemini: 'gemini',
      pi: 'pi',
      kimi: 'kimi',
    })
  })

  it('accepts terminal Agent activity snapshots only for the shim providers', () => {
    const snapshot = {
      invocationId: 'invocation-1',
      generation: 1,
      phase: 'active',
      observedAtMs: 1_000,
      identityAuthority: null,
    }
    for (const provider of PROVIDERS) {
      const normalized = normalizeTerminalAgentActivitySnapshot({ provider, ...snapshot })
      expect(normalized?.provider ?? null).toBe(
        (SHIM_PROVIDERS as readonly string[]).includes(provider) ? provider : null,
      )
    }
    expect(normalizeTerminalAgentActivitySnapshot({ provider: 'Codex', ...snapshot })).toBeNull()
  })

  it('accepts re-exec activity fences only for the shim providers', () => {
    const fence = {
      invocationId: 'invocation-1',
      generation: 1,
      phase: 'active',
      observedAtMs: 1_000,
    }
    for (const provider of PROVIDERS) {
      const input = normalizeTerminalAgentReexecInput({
        sessionId: 'session-1',
        provider,
        resumeSessionId: null,
        expectedActivity: { provider, ...fence },
      })
      const isShim = (SHIM_PROVIDERS as readonly string[]).includes(provider)
      expect(input === null).toBe(!isShim)
      if (input) {
        expect(input.provider).toBe(provider)
        expect(input.expectedActivity?.provider).toBe(provider)
      }
      // Without an expected fence, every provider id is accepted.
      expect(
        normalizeTerminalAgentReexecInput({
          sessionId: 'session-1',
          provider,
          resumeSessionId: null,
          expectedActivity: null,
        })?.provider,
      ).toBe(provider)
    }
    expect(typeof toTerminalAgentActivityFence).toBe('function')
  })

  it('restores terminalProviderHint for every provider and drops anything else', () => {
    const restore = (hint: unknown) =>
      ensurePersistedWorkspace({
        id: 'workspace',
        name: 'Workspace',
        path: '/workspace',
        nodes: [
          {
            id: 'terminal',
            title: 'Terminal',
            kind: 'terminal',
            width: 640,
            height: 360,
            position: { x: 0, y: 0 },
            terminalProviderHint: hint,
          },
        ],
      })?.nodes[0]?.terminalProviderHint
    for (const provider of PROVIDERS) {
      expect(restore(provider)).toBe(provider)
    }
    for (const value of ['Codex', 'bash', '', null, 3]) {
      expect(restore(value) ?? null).toBeNull()
    }
  })

  it('parses browser PTY metadata provider for every provider and drops anything else', () => {
    for (const provider of PROVIDERS) {
      expect(parseBrowserPtyMetadata('session-1', { agentProvider: provider })?.agentProvider).toBe(
        provider,
      )
    }
    for (const value of ['Codex', 'bash', '', null, 3]) {
      expect(
        parseBrowserPtyMetadata('session-1', { agentProvider: value })?.agentProvider ?? null,
      ).toBeNull()
    }
  })
})
