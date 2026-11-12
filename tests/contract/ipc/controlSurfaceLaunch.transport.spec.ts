import { afterEach, expect, it, vi } from 'vitest'
import { launchWorkspaceAgentSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceAgentLaunch.shared'
import { createRendererBridge } from '@app/preload/rendererBridge'
import { createDesktopOpenCoveApi } from '@app/renderer/bootstrap/installDesktopOpenCoveApi'
import { persistenceWriteFailure } from '@shared/sync/persistenceWriteOutcome'
const harness = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      harness.handlers.set(channel, handler),
    removeHandler: (channel: string) => harness.handlers.delete(channel),
  },
  ipcRenderer: {
    invoke: (channel: string, payload: unknown) =>
      harness.handlers.get(channel)!({ sender: { id: 1 } }, payload),
  },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  harness.handlers.clear()
})
it.each([
  'invalid JSON',
  'missing envelope',
  'invalid ok',
  'invalid error',
  'HTTP failure',
  'worker unavailable',
])('never replays an executed launch after %s before Main conversion', async corruption => {
  const requests: string[] = []
  let executed = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      requests.push(request.id)
      if (request.id === 'system.capabilities') {
        return new Response(
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: true,
            value: { features: { managedClaudeResumeBindingDeliveryV1: true } },
          }),
        )
      }
      executed += 1
      return new Response(
        corruption === 'invalid JSON'
          ? '{broken'
          : JSON.stringify(
              corruption === 'worker unavailable'
                ? {
                    __opencoveControlEnvelope: true,
                    ok: false,
                    error: { code: 'worker.unavailable' },
                  }
                : corruption === 'invalid ok'
                  ? { __opencoveControlEnvelope: true, ok: 'true' }
                  : corruption === 'invalid error'
                    ? { __opencoveControlEnvelope: true, ok: false, error: {} }
                    : {},
            ),
        { status: corruption === 'HTTP failure' ? 502 : 200 },
      )
    }),
  )
  const { registerControlSurfaceIpcHandlers } =
    await import('@app/main/ipc/registerControlSurfaceIpcHandlers')
  const { invokeIpc } = await import('@app/preload/ipcInvoke')
  const disposable = registerControlSurfaceIpcHandlers({
    endpointResolver: async () => ({ hostname: 'worker.test', port: 1234, token: 'PRIVATE_TOKEN' }),
  })
  window.opencoveApi = createDesktopOpenCoveApi(
    createRendererBridge({
      controlSurface: {
        invoke: (request: unknown) => invokeIpc('control-surface:invoke', request),
      },
    } as never),
  )
  const repair = vi.fn(async () => ({ mountId: 'changed', executionDirectory: '/changed' }))
  try {
    const error = await launchWorkspaceAgentSession({
      canvasNodeId: 'agent',
      workspaceId: 'project',
      mountId: 'initial',
      workspacePath: '/repo',
      executionDirectory: '/repo',
      provider: 'claude-code',
      mode: 'new',
      prompt: '',
      model: null,
      mergedEnv: {},
      agentSettings: {
        agentFullAccess: false,
        codexReuseRunningAppServer: false,
        defaultTerminalProfileId: null,
      },
      launchGeometry: { terminalGeometry: { cols: 80, rows: 24 } },
      retryResolveMountBinding: repair,
    }).catch(caught => caught)
    expect(error).toMatchObject(
      corruption === 'worker unavailable'
        ? { name: 'OpenCoveAppError', code: 'worker.unavailable' }
        : { name: 'RendererTransportError' },
    )
    expect(persistenceWriteFailure(error).outcome).toBe('unknown')
    expect(requests).toEqual(['system.capabilities', 'session.launchAgentInMount'])
    expect(executed).toBe(1)
    expect(repair).not.toHaveBeenCalled()
    expect(JSON.stringify(error)).not.toContain('PRIVATE_TOKEN')
  } finally {
    disposable.dispose()
  }
})
