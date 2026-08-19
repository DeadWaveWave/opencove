import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import {
  clearIssueReportBreadcrumbsForTests,
  getIssueReportBreadcrumbs,
} from '../../../src/app/main/diagnostics/issueReportBreadcrumbs'

const listeners = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>())

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/opencove-test' },
  ipcMain: {
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener)
    }),
    removeListener: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

describe('diagnostics IPC handlers', () => {
  beforeEach(() => {
    clearIssueReportBreadcrumbsForTests()
    listeners.clear()
    delete process.env['OPENCOVE_TERMINAL_DIAGNOSTICS']
    delete process.env['OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS']
  })

  afterEach(() => {
    delete process.env['OPENCOVE_TERMINAL_DIAGNOSTICS']
    delete process.env['OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS']
  })

  it('records key terminal events without diagnostic environment flags', async () => {
    const { registerDiagnosticsIpcHandlers } =
      await import('../../../src/app/main/ipc/registerDiagnosticsIpcHandlers')
    registerDiagnosticsIpcHandlers()
    const listener = listeners.get(IPC_CHANNELS.terminalDiagnosticsLog)

    listener?.(
      {},
      {
        source: 'renderer-terminal',
        nodeId: 'node-1',
        sessionId: 'session-1',
        nodeKind: 'terminal',
        title: 'Terminal',
        event: 'resize',
        snapshot: {
          bufferKind: 'normal',
          activeBaseY: 0,
          activeViewportY: 0,
          activeLength: 24,
          cols: 100,
          rows: 24,
          viewportScrollTop: 0,
          viewportScrollHeight: 480,
          viewportClientHeight: 480,
          hasViewport: true,
          hasVerticalScrollbar: false,
        },
      },
    )

    expect(getIssueReportBreadcrumbs()).toEqual([
      expect.objectContaining({ source: 'renderer-terminal', event: 'resize' }),
    ])
  })
})
