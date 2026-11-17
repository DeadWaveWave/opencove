import { negotiateManagedClaudeWorkerSupport } from '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeWorkerSupport'
import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createDesktopOpenCoveApi } from '../../../src/app/renderer/bootstrap/installDesktopOpenCoveApi'
import { createAppError, toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import type { PersistWriteResult } from '../../../src/shared/contracts/dto'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

const ipc = vi.hoisted(() => ({
  profile: '',
  listeners: new Map<string, (...args: unknown[]) => void>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => ipc.profile },
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => Reflect.set(window, key, value),
  },
  webUtils: {},
  ipcMain: {
    on: (key: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(key, fn),
    removeListener: (key: string) => ipc.listeners.delete(key),
    handle: (key: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(key, fn),
    removeHandler: (key: string) => ipc.handlers.delete(key),
  },
  ipcRenderer: {
    on: vi.fn(),
    send: (key: string, payload: unknown) => ipc.listeners.get(key)?.({}, structuredClone(payload)),
    invoke: async (key: string, payload: unknown) =>
      structuredClone(await ipc.handlers.get(key)?.({}, payload)),
  },
}))

const { flushScheduledPersistedStateWrite, schedulePersistedStateWrite } = vi.hoisted(() => ({
  flushScheduledPersistedStateWrite: vi.fn(),
  schedulePersistedStateWrite: vi.fn(),
}))

vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/persistence', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/contexts/workspace/presentation/renderer/utils/persistence')
  >('../../../src/contexts/workspace/presentation/renderer/utils/persistence')

  return {
    ...actual,
    flushScheduledPersistedStateWrite,
    schedulePersistedStateWrite,
  }
})

const { flushScheduledScrollbackWrites } = vi.hoisted(() => ({
  flushScheduledScrollbackWrites: vi.fn(),
}))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule',
  async () => {
    const actual = await vi.importActual<
      typeof import('../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule')
    >('../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule')

    return {
      ...actual,
      flushScheduledScrollbackWrites,
    }
  },
)

import { usePersistedAppState } from '../../../src/app/renderer/shell/hooks/usePersistedAppState'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { requestWorkspaceDocumentPersistFlush } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'

describe('usePersistedAppState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    flushScheduledPersistedStateWrite.mockReset()
    schedulePersistedStateWrite.mockReset()
    flushScheduledScrollbackWrites.mockReset()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: { meta: { isTest: false } },
    })

    useAppStore.getState().setPersistNotice(null)
  })

  it('flushes app state + node scrollbacks on beforeunload', () => {
    schedulePersistedStateWrite.mockImplementation(() => {})
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

    function Harness() {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }

    render(<Harness />)

    window.dispatchEvent(new Event('beforeunload'))

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opencove:terminal-flush-scrollback' }),
    )
    expect(flushScheduledScrollbackWrites).toHaveBeenCalledTimes(1)
    expect(flushScheduledPersistedStateWrite).toHaveBeenCalledTimes(1)
  })

  it('carries save errors through preload and logs once from the result handler into the profile', async () => {
    ipc.profile = await mkdtemp(join(process.cwd(), 'node_modules/persistence-diagnostics-'))
    const { registerDiagnosticsIpcHandlers } =
      await import('../../../src/app/main/ipc/registerDiagnosticsIpcHandlers')
    const { registerPersistenceIpcHandlers } =
      await import('../../../src/platform/persistence/sqlite/ipc/register')
    const failure: PersistWriteResult = {
      ok: false,
      reason: 'io',
      outcome: 'notSubmitted',
      error: toAppErrorDescriptor(
        createAppError('persistence.io_failed', {
          debugMessage: 'SqliteError(SQLITE_BUSY): database is locked',
          details: { stage: 'worker-store', privateState: 'DO NOT LOG' },
        }),
      ),
    }
    const diagnostics = registerDiagnosticsIpcHandlers()
    const persistence = registerPersistenceIpcHandlers(
      async () =>
        ({
          writeAppState: async () => failure,
        }) as unknown as PersistenceStore,
    )
    await import('../../../src/app/preload/index')
    window.opencoveApi = createDesktopOpenCoveApi(window.__opencoveBridge)
    let deliver!: (result: PersistWriteResult) => void
    schedulePersistedStateWrite.mockImplementation((_producer, options) => {
      deliver = options.onResult
    })
    function Harness() {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }
    const rendered = render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>,
    )
    try {
      act(() => requestWorkspaceDocumentPersistFlush())
      const result = await window.opencoveApi.persistence.writeAppState({ state: {} })
      expect(result).toEqual(failure)
      // A connection notice takes precedence, but must not hide save diagnostics.
      const notice = {
        tone: 'error' as const,
        kind: 'connection' as const,
        message: 'Disconnected',
      }
      act(() => useAppStore.getState().setPersistNotice(notice))
      act(() => deliver(result))
      expect(useAppStore.getState().persistNotice).toEqual(notice)
      act(() => deliver({ ok: true, level: 'full', bytes: 1 }))
      const raw = await readFile(join(ipc.profile, 'logs/runtime-diagnostics.log'), 'utf8')
      const lines = raw
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatchObject({
        source: 'renderer-persistence',
        level: 'error',
        event: 'persistence-write-failed',
        details: {
          errorCode: 'persistence.io_failed',
          reason: 'io',
          outcome: 'notSubmitted',
          debugMessage: 'SqliteError(SQLITE_BUSY): database is locked',
          stage: 'worker-store',
          noticeKey: 'persistence.ioFailed',
        },
      })
      expect(lines[1]).toMatchObject({
        source: 'renderer-persistence',
        event: 'persistence-write-recovered',
        details: { failedCount: 1 },
      })
      expect(raw).not.toContain('DO NOT LOG')
    } finally {
      rendered.unmount()
      persistence.dispose()
      diagnostics.dispose()
      await rm(ipc.profile, { recursive: true, force: true })
    }
  })

  it('keeps recovery notices after successful full writes', async () => {
    useAppStore.getState().setPersistNotice({
      tone: 'warning',
      message: 'Persistence database was corrupted and has been reset.',
      kind: 'recovery',
    })

    schedulePersistedStateWrite.mockImplementation((_producer, options) => {
      options?.onResult?.({ ok: true, level: 'full', bytes: 1 })
    })

    function Harness() {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }

    render(<Harness />)

    await waitFor(() => {
      expect(useAppStore.getState().persistNotice?.kind).toBe('recovery')
    })
  })
  it('restores the scoped freeze reason after a write error and successful save', async () => {
    window.opencoveApi = {
      persistence: {},
      controlSurface: {
        invoke: vi.fn(async () => ({
          features: {
            managedClaudeResumeBindingDeliveryV1: true,
            managedClaudeResumeBindingWritesEnabled: false,
          },
        })),
      },
      meta: { isTest: true },
    } as unknown as typeof window.opencoveApi
    await negotiateManagedClaudeWorkerSupport('required')
    const notice = useAppStore.getState().persistNotice
    let deliver!: (result: unknown) => void
    schedulePersistedStateWrite.mockImplementation((_producer, options) => {
      deliver = options.onResult
    })
    function Harness() {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }
    const rendered = render(<Harness />)
    rendered.rerender(<Harness />)
    act(() =>
      deliver({
        ok: false,
        reason: 'io',
        outcome: 'notCommitted',
        error: { code: 'persistence.unavailable' },
      }),
    )
    expect(useAppStore.getState().persistNotice?.kind).toBe('write')
    act(() => deliver({ ok: true, level: 'full', bytes: 1 }))
    expect(useAppStore.getState().persistNotice).toEqual(notice)
  })

  // Every canvas flush reaches the shell only through the registration of `requestPersistFlush`
  // with the document module (#702, PR 14), since the canvas no longer takes a flush prop.
  describe('the flush the canvas requests through the document module', () => {
    function Harness({ agentSettings = DEFAULT_AGENT_SETTINGS }: { agentSettings?: unknown }) {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: agentSettings as typeof DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }

    it('schedules a write and flushes it once with the next app-state change', () => {
      const rendered = render(<Harness />)
      schedulePersistedStateWrite.mockClear()
      flushScheduledPersistedStateWrite.mockClear()

      act(() => requestWorkspaceDocumentPersistFlush())

      expect(schedulePersistedStateWrite).toHaveBeenCalledTimes(1)
      expect(flushScheduledPersistedStateWrite).not.toHaveBeenCalled()

      rendered.rerender(<Harness agentSettings={{ ...DEFAULT_AGENT_SETTINGS }} />)

      expect(flushScheduledPersistedStateWrite).toHaveBeenCalledTimes(1)
    })

    // Hydration changes the identity of `requestPersistFlush`. React runs every passive cleanup
    // of a commit before any passive setup, so a registration that followed the identity left
    // the child effects of that commit with nothing to reach.
    it('reaches the shell from a child effect in the commit that completes hydration', () => {
      function FlushOnHydration({ isHydrated }: { isHydrated: boolean }) {
        React.useEffect(() => {
          if (isHydrated) {
            requestWorkspaceDocumentPersistFlush()
          }
        }, [isHydrated])
        return null
      }
      function HydratingHarness({ isHydrated }: { isHydrated: boolean }) {
        usePersistedAppState({
          workspaces: [],
          activeWorkspaceId: null,
          agentSettings: DEFAULT_AGENT_SETTINGS,
          isHydrated,
          producePersistedState,
        })
        return <FlushOnHydration isHydrated={isHydrated} />
      }
      const producePersistedState = () => ({
        formatVersion: 0,
        activeWorkspaceId: null,
        workspaces: [],
        settings: DEFAULT_AGENT_SETTINGS,
      })

      const rendered = render(<HydratingHarness isHydrated={false} />)
      schedulePersistedStateWrite.mockClear()
      flushScheduledPersistedStateWrite.mockClear()

      rendered.rerender(<HydratingHarness isHydrated />)

      // Without the request, hydration skips its first write.
      expect(schedulePersistedStateWrite).toHaveBeenCalled()
      expect(flushScheduledPersistedStateWrite).toHaveBeenCalledTimes(1)

      // Later requests reach the hydrated function, which schedules a write by itself.
      schedulePersistedStateWrite.mockClear()
      act(() => requestWorkspaceDocumentPersistFlush())
      expect(schedulePersistedStateWrite).toHaveBeenCalledTimes(1)
    })

    it("reaches the shell from a child effect in the shell's first commit", () => {
      function FlushOnMount() {
        React.useEffect(() => {
          requestWorkspaceDocumentPersistFlush()
        }, [])
        return null
      }
      function MountingHarness() {
        usePersistedAppState({
          workspaces: [],
          activeWorkspaceId: null,
          agentSettings: DEFAULT_AGENT_SETTINGS,
          isHydrated: true,
          producePersistedState: () => ({
            formatVersion: 0,
            activeWorkspaceId: null,
            workspaces: [],
            settings: DEFAULT_AGENT_SETTINGS,
          }),
        })
        return <FlushOnMount />
      }

      render(<MountingHarness />)

      expect(flushScheduledPersistedStateWrite).toHaveBeenCalledTimes(1)
    })

    it('reaches nothing after the shell is gone', () => {
      const rendered = render(<Harness />)
      rendered.unmount()
      schedulePersistedStateWrite.mockClear()
      flushScheduledPersistedStateWrite.mockClear()

      requestWorkspaceDocumentPersistFlush()

      expect(schedulePersistedStateWrite).not.toHaveBeenCalled()
      expect(flushScheduledPersistedStateWrite).not.toHaveBeenCalled()
    })
  })
})
