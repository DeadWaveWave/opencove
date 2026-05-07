import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/constants/ipc'
import { createAppError } from '../../../src/shared/errors/appError'
import { invokeHandledIpc } from './ipcTestUtils'

async function setupIpc() {
  vi.resetModules()

  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }

  vi.doMock('electron', () => ({ ipcMain }))

  const service = {
    prepare: vi.fn(async payload => ({
      reportId: 'report-1',
      createdAt: '2026-05-07T00:00:00.000Z',
      reportPath: '/tmp/opencove/issue-reports/report.md',
      markdown: '# report',
      githubIssueUrl: 'https://github.com/DeadWaveWave/opencove/issues/new?title=report',
      includedDiagnostics: {
        system: true,
        worker: true,
        agent: true,
        logs: true,
        localPaths: payload.includeLocalPaths === true,
      },
    })),
    openGithubIssue: vi.fn(async () => undefined),
    showReportFile: vi.fn(async () => undefined),
  }

  const { registerIssueReportIpcHandlers } =
    await import('../../../src/contexts/issueReport/presentation/main-ipc/register')

  return {
    handlers,
    service,
    disposable: registerIssueReportIpcHandlers(service),
  }
}

describe('issue report IPC', () => {
  it('normalizes prepare payloads before generating a report', async () => {
    const { handlers, service, disposable } = await setupIpc()

    await expect(
      invokeHandledIpc(handlers.get(IPC_CHANNELS.issueReportPrepare), null, {
        title: '  Run Agent failed  ',
        description: '  cannot launch  ',
        includeLocalPaths: true,
        context: {
          activeWorkspaceName: '  OpenCove  ',
        },
      }),
    ).resolves.toMatchObject({ reportId: 'report-1' })

    expect(service.prepare).toHaveBeenCalledWith({
      kind: 'run_agent_failed',
      title: 'Run Agent failed',
      description: 'cannot launch',
      includeLocalPaths: true,
      context: {
        activeWorkspaceName: 'OpenCove',
        activeWorkspacePath: null,
        activeSpaceName: null,
        activeSpacePath: null,
      },
    })

    disposable.dispose()
  })

  it('rejects invalid show-file payloads before reaching the service', async () => {
    const { handlers, service, disposable } = await setupIpc()

    await expect(
      invokeHandledIpc(handlers.get(IPC_CHANNELS.issueReportShowFile), null, { reportPath: '' }),
    ).rejects.toThrow(createAppError('common.invalid_input').message)

    expect(service.showReportFile).not.toHaveBeenCalled()

    disposable.dispose()
  })
})
