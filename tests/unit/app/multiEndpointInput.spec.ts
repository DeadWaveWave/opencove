import { expect, it, vi } from 'vitest'
import { createMultiEndpointPtyRuntime } from '../../../src/app/main/controlSurface/ptyStream/multiEndpointPtyRuntime'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { SessionRuntimeWrite } from '../../../src/shared/runtime/sessionInputProvenance'

it.each(
  [false, true].flatMap(registered =>
    ['human', 'encoded', 'delivery'].map(writer => ({ registered, writer })),
  ),
)(
  'forwards the exact local write arguments, registered=$registered, writer=$writer',
  async ({ registered, writer }) => {
    const write = vi.fn()
    const runtime = createMultiEndpointPtyRuntime({
      localRuntime: {
        write,
        spawnSession: async () => ({ sessionId: 's' }),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
      },
      topology: createWorkerTopologyStore({ userDataPath: '/tmp/opencove-input-test' }),
      disposeLocalRuntime: false,
    })
    try {
      if (registered) {
        await runtime.spawnSession({ cwd: '/tmp', cols: 80, rows: 24, command: 'shell', args: [] })
      }
      const target = { providerSessionId: 'B', invocationId: 's', conversationGeneration: 2 }
      const args: Parameters<SessionRuntimeWrite> =
        writer === 'human'
          ? ['s', '\r']
          : writer === 'encoded'
            ? ['s', 'data', 'binary']
            : ['s', '\r', undefined, target]
      runtime.write(...args)
      expect(write.mock.calls).toEqual([args])
    } finally {
      await runtime.dispose()
    }
  },
)

it('keeps private local provenance out of the remote write transport', async () => {
  const { RemotePtyEndpointProxy } =
    await import('../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy')
  const attach = vi.spyOn(RemotePtyEndpointProxy.prototype, 'attach').mockImplementation(() => {})
  const remoteWrite = vi
    .spyOn(RemotePtyEndpointProxy.prototype, 'write')
    .mockImplementation(() => {})
  const localWrite = vi.fn()
  const runtime = createMultiEndpointPtyRuntime({
    localRuntime: {
      write: localWrite,
      spawnSession: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: () => () => {},
    },
    topology: createWorkerTopologyStore({ userDataPath: '/tmp/opencove-input-test' }),
    disposeLocalRuntime: false,
  })
  try {
    const home = runtime.registerRemoteSession({ endpointId: 'remote', remoteSessionId: 'foreign' })
    runtime.write(home, '\r', undefined, {
      providerSessionId: 'B',
      invocationId: 'local-invocation',
    })
    expect(remoteWrite).toHaveBeenCalledWith('foreign', '\r')
    expect(localWrite).not.toHaveBeenCalled()
  } finally {
    await runtime.dispose()
    attach.mockRestore()
    remoteWrite.mockRestore()
  }
})
