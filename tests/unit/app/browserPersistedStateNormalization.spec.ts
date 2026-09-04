import { describe, expect, it } from 'vitest'
import {
  normalizeCanonicalPersistedAppStateForMerge,
  normalizePersistedAppStateForMerge,
} from '../../../src/app/renderer/browser/browserOpenCoveApi.helpers'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'

function legacyState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/workspace',
        nodes: [
          {
            id: 'terminal-1',
            title: 'Terminal',
            position: { x: 0, y: 0 },
            width: 400,
            height: 300,
            kind: 'terminal',
          },
        ],
      },
    ],
    settings: { language: 'zh-CN' },
  }
}

describe('browser persisted-state merge normalization', () => {
  it('normalizes remote legacy omissions but requires canonical local settings', () => {
    const legacy = legacyState()
    expect(normalizePersistedAppStateForMerge(legacy)).toMatchObject({
      activeWorkspaceId: 'workspace-1',
      workspaces: [
        {
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          spaces: [],
          spaceArchiveRecords: [],
        },
      ],
      settings: { language: 'zh-CN' },
    })
    expect(normalizeCanonicalPersistedAppStateForMerge(legacy)).toBeNull()

    const canonical = { ...legacy, settings: DEFAULT_AGENT_SETTINGS }
    expect(normalizeCanonicalPersistedAppStateForMerge(canonical)).not.toBeNull()
  })

  it('rejects malformed present durable fields on both paths', () => {
    const malformed = legacyState()
    malformed.workspaces[0]!.nodes[0]!.width = Number.NaN

    expect(normalizePersistedAppStateForMerge(malformed)).toBeNull()
    expect(normalizeCanonicalPersistedAppStateForMerge(malformed)).toBeNull()
  })
})
