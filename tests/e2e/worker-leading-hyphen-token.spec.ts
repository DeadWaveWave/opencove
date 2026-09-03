import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
  type RemoteWorkerHandle,
} from './m6.endpoints-mounts.integration.helpers'

test('Worker authenticates an opaque bearer token that starts with hyphens', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opencove-e2e-worker-token-'))
  const userDataDir = path.join(root, 'user-data')
  const homeDir = path.join(root, 'home')
  const token = '--opaque-leading-token'
  const port = await reserveLoopbackPort()
  let worker: RemoteWorkerHandle | null = null

  try {
    worker = await startRemoteWorker({
      hostname: '127.0.0.1',
      port,
      token,
      userDataDir,
      homeDir,
      approveRoot: root,
    })

    const response = await fetch(`http://127.0.0.1:${String(port)}/invoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
    })
    await expect(response.json()).resolves.toMatchObject({
      __opencoveControlEnvelope: true,
      ok: true,
    })
  } finally {
    if (worker) {
      await stopRemoteWorker(worker.child)
    }
    await rm(root, { recursive: true, force: true })
  }
})
