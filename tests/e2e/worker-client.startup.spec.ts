import { createServer } from 'node:net'
import { expect, test } from '@playwright/test'
import { createTestUserDataDir, removePathWithRetry } from './workspace-canvas.helpers'
import { startWorker } from './worker-client.helpers'

test('Worker startup reports the exit reason and stderr for an occupied port', async () => {
  const userDataDir = await createTestUserDataDir()
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listener')
    }
    await expect(
      startWorker({ userDataDir, port: address.port, env: { NODE_ENV: 'test' } }),
    ).rejects.toThrow(/Worker exited before ready \(code=1, signal=none\)[\s\S]*EADDRINUSE/)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    )
    await removePathWithRetry(userDataDir)
  }
})
