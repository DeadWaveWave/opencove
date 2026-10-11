// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { invokeRemoteValue } from '../../../src/app/main/controlSurface/handlers/filesystemMountSupport'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import * as http from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'

it('rechecks caller lifetime after endpoint resolution before sending HTTP mutation', async () => {
  const request = vi
    .spyOn(http, 'invokeControlSurface')
    .mockRejectedValue(new Error('must not dispatch'))
  let finish!: (value: { hostname: string; port: number; token: string }) => void
  const topology = {
    resolveRemoteEndpointConnection: () =>
      new Promise(resolve => {
        finish = resolve
      }),
  } as unknown as WorkerTopologyStore
  let active = true
  try {
    const pending = invokeRemoteValue({
      topology,
      endpointId: 'remote',
      kind: 'command',
      id: 'filesystem.writeFileText',
      payload: { uri: 'file:///remote/a', content: 'forbidden' },
      assertActive: () => {
        if (!active) {
          throw new Error('Caller retired')
        }
      },
    })
    active = false
    finish({ hostname: '127.0.0.1', port: 1, token: 'unused-fixture' })
    await expect(pending).rejects.toThrow('retired')
    expect(request).not.toHaveBeenCalled()
  } finally {
    request.mockRestore()
  }
})
