import { beforeEach, describe, expect, it } from 'vitest'
import {
  readPersistedState,
  toPersistedState,
  writePersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { installMockStorage, MockStorage } from '../../support/persistenceTestStorage'

installMockStorage()

beforeEach(() => {
  window.localStorage.clear()
})

describe('workspace persistence (write)', () => {
  it('ignores persistence failures (quota exceeded, disabled storage, etc.)', async () => {
    const previousStorage = window.localStorage

    class ThrowingStorage extends MockStorage {
      public override setItem(_key: string, _value: string): void {
        throw new Error('QuotaExceededError')
      }
    }

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: new ThrowingStorage(),
    })

    await writePersistedState(toPersistedState([], null))

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: previousStorage,
    })
  })

  it('falls back to persisting settings only when quota is exceeded', async () => {
    const previousStorage = window.localStorage

    class LimitedStorage extends MockStorage {
      public constructor(private readonly maxBytes: number) {
        super()
      }

      public override setItem(key: string, value: string): void {
        if (value.length > this.maxBytes) {
          const error =
            typeof DOMException === 'undefined'
              ? Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' })
              : new DOMException('Quota exceeded', 'QuotaExceededError')
          throw error
        }

        super.setItem(key, value)
      }
    }

    const state = toPersistedState(
      [
        {
          id: 'workspace-1',
          name: 'cove',
          path: '/tmp/cove',
          worktreesRoot: '',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [],
          activeSpaceId: null,
          spaceArchiveRecords: [],
          nodes: [
            {
              id: 'terminal-1',
              type: 'terminalNode',
              position: { x: 120, y: 120 },
              data: {
                sessionId: 'session-1',
                title: 'terminal-1',
                width: 460,
                height: 300,
                kind: 'terminal',
                status: null,
                startedAt: null,
                endedAt: null,
                exitCode: null,
                lastError: 'x'.repeat(5000),
                scrollback: null,
                agent: null,
                task: null,
                note: null,
              },
            },
          ],
        },
      ],
      'workspace-1',
    )
    const settingsOnlyBytes = JSON.stringify({
      formatVersion: state.formatVersion,
      activeWorkspaceId: state.activeWorkspaceId,
      workspaces: [],
      settings: state.settings,
    }).length

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: new LimitedStorage(settingsOnlyBytes + 64),
    })

    const result = await writePersistedState(state)
    expect(result.ok).toBe(true)
    expect(result.ok ? result.level : null).toBe('settings_only')

    const restored = await readPersistedState()
    expect(restored?.workspaces).toEqual([])

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: previousStorage,
    })
  })
})
