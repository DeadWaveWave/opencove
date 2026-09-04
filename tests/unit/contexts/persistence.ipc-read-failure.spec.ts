import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { STORAGE_KEY } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/constants'
import { installMockStorage } from '../../support/persistenceTestStorage'

installMockStorage()

function installPersistenceApi(options: {
  readAppState: () => Promise<never>
  writeAppState: ReturnType<typeof vi.fn>
}): void {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        readAppState: options.readAppState,
        writeAppState: options.writeAppState,
      },
    } as unknown as Window['opencoveApi'],
  })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: undefined,
  })
})

describe('workspace persistence IPC read failures', () => {
  it('propagates the failure without migrating an empty local state back to IPC', async () => {
    const writeAppState = vi.fn(async () => ({
      ok: true as const,
      level: 'full' as const,
      bytes: 0,
    }))
    installPersistenceApi({
      readAppState: async () => {
        throw new Error('simulated persistence transport failure')
      },
      writeAppState,
    })
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: {},
      }),
    )

    await expect(readPersistedState()).rejects.toMatchObject({
      code: 'persistence.unavailable',
    })
    expect(writeAppState).not.toHaveBeenCalled()
  })
})
