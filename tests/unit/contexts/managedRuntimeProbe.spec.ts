// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { probeManagedRuntime } from '../../../src/contexts/topology/infrastructure/managedRuntime/managedRuntimeProbe'
import { runtimeBuildFixture } from '../../helpers/runtimeBuild'

async function withRuntime(value: unknown, status: number, check: (port: number) => Promise<void>) {
  const server = createServer((_, response) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  try {
    await check((server.address() as AddressInfo).port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => done()))
  }
}

describe('managed runtime readiness', () => {
  it('reports rejected credentials immediately instead of polling startup', async () => {
    await withRuntime({}, 401, async port => {
      await expect(
        probeManagedRuntime({ port, token: 'expected', deploymentId: 'endpoint' }),
      ).rejects.toThrow('credential_mismatch')
    })
  })

  it('does not accept HTTP 200 or a legacy ping as proof of a matching worker', async () => {
    await withRuntime({ ok: true, value: { ok: true } }, 200, async port => {
      await expect(
        probeManagedRuntime({ port, token: 'expected', deploymentId: 'endpoint' }),
      ).rejects.toThrow('runtime_legacy')
    })
  })

  it('does not attach to another deployment even when its build and credential work', async () => {
    await withRuntime(
      {
        ok: true,
        value: {
          runtimeBuild: runtimeBuildFixture,
          deploymentId: 'other',
          instanceId: 'instance',
          runtimeReady: true,
        },
      },
      200,
      async port => {
        await expect(
          probeManagedRuntime({ port, token: 'expected', deploymentId: 'endpoint' }),
        ).rejects.toThrow('runtime_legacy')
      },
    )
  })
})
