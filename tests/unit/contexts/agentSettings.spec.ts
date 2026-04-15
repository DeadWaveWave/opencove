import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'

describe('normalizeAgentSettings', () => {
  it('provides defaults for quick menu fields', () => {
    expect(DEFAULT_AGENT_SETTINGS.quickCommands).toEqual([])
    expect(DEFAULT_AGENT_SETTINGS.quickPhrases).toEqual([])
    expect(DEFAULT_AGENT_SETTINGS.agentEnvByProvider.codex).toEqual([])
    expect(DEFAULT_AGENT_SETTINGS.agentEnvByProvider['claude-code']).toEqual([])
    expect(DEFAULT_AGENT_SETTINGS.agentEnvByProvider.opencode).toEqual([])
    expect(DEFAULT_AGENT_SETTINGS.agentEnvByProvider.gemini).toEqual([])
  })

  it('keeps the default terminal profile unset by default', () => {
    expect(DEFAULT_AGENT_SETTINGS.defaultTerminalProfileId).toBeNull()
    expect(normalizeAgentSettings({}).defaultTerminalProfileId).toBeNull()
  })

  it('restores a persisted terminal profile id when it is present', () => {
    const settings = normalizeAgentSettings({
      defaultTerminalProfileId: 'wsl:Ubuntu',
    })

    expect(settings.defaultTerminalProfileId).toBe('wsl:Ubuntu')
  })

  it('falls back to automatic terminal profile selection for invalid values', () => {
    const settings = normalizeAgentSettings({
      defaultTerminalProfileId: 123,
    })

    expect(settings.defaultTerminalProfileId).toBeNull()
  })

  it('normalizes the standard window size bucket', () => {
    expect(
      normalizeAgentSettings({ standardWindowSizeBucket: 'large' }).standardWindowSizeBucket,
    ).toBe('large')
    expect(
      normalizeAgentSettings({ standardWindowSizeBucket: 'invalid' }).standardWindowSizeBucket,
    ).toBe(DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket)
  })

  it('defaults and normalizes the visible-canvas focus centering toggle', () => {
    expect(DEFAULT_AGENT_SETTINGS.focusNodeUseVisibleCanvasCenter).toBe(true)
    expect(normalizeAgentSettings({}).focusNodeUseVisibleCanvasCenter).toBe(true)
    expect(
      normalizeAgentSettings({
        focusNodeUseVisibleCanvasCenter: false,
      }).focusNodeUseVisibleCanvasCenter,
    ).toBe(false)
  })

  it('normalizes quick commands', () => {
    const settings = normalizeAgentSettings({
      quickCommands: [
        {
          id: 'cmd-1',
          title: 'Build',
          kind: 'terminal',
          command: 'pnpm build',
          enabled: false,
          pinned: true,
        },
        {
          id: 'cmd-2',
          title: 'Docs',
          kind: 'url',
          url: 'https://example.com',
        },
        {
          id: 'cmd-2',
          title: 'Duplicate',
          kind: 'terminal',
          command: 'echo hi',
        },
        {
          id: 'cmd-3',
          title: '',
          kind: 'terminal',
          command: 'echo hi',
        },
      ],
    })

    expect(settings.quickCommands).toEqual([
      {
        id: 'cmd-1',
        title: 'Build',
        kind: 'terminal',
        command: 'pnpm build',
        enabled: false,
        pinned: true,
      },
      {
        id: 'cmd-2',
        title: 'Docs',
        kind: 'url',
        url: 'https://example.com',
        enabled: true,
        pinned: false,
      },
    ])
  })

  it('normalizes quick phrases', () => {
    const settings = normalizeAgentSettings({
      quickPhrases: [
        {
          id: 'phrase-1',
          title: 'Greeting',
          content: 'Hello',
          enabled: false,
        },
        {
          id: '',
          title: 'Invalid',
          content: 'Ignored',
        },
      ],
    })

    expect(settings.quickPhrases).toEqual([
      {
        id: 'phrase-1',
        title: 'Greeting',
        content: 'Hello',
        enabled: false,
      },
    ])
  })

  it('normalizes agent env by provider', () => {
    const settings = normalizeAgentSettings({
      agentEnvByProvider: {
        codex: [
          { id: 'row-1', key: 'FOO', value: 'bar', enabled: true },
          { id: 'row-2', key: 'INVALID KEY', value: 'ignored', enabled: true },
        ],
        gemini: 'invalid',
      },
    })

    expect(settings.agentEnvByProvider.codex).toEqual([
      { id: 'row-1', key: 'FOO', value: 'bar', enabled: true },
    ])
    expect(settings.agentEnvByProvider.gemini).toEqual([])
  })

  it('defaults experimental remote workers to disabled', () => {
    expect(DEFAULT_AGENT_SETTINGS.experimentalRemoteWorkersEnabled).toBe(false)
    expect(normalizeAgentSettings({}).experimentalRemoteWorkersEnabled).toBe(false)
    expect(
      normalizeAgentSettings({ experimentalRemoteWorkersEnabled: true })
        .experimentalRemoteWorkersEnabled,
    ).toBe(true)
  })
})
