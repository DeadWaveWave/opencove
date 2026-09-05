import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, getAppPath: () => state.directory, isPackaged: false },
}))
vi.mock('../../../src/app/main/worker/localWorkerCompatibility', () => ({
  isReusableLocalWorkerConnection: async () => true,
  resolveLocalWorkerReusePolicy: () => ({ canReuse: true }),
}))
vi.mock('../../../src/app/main/controlSurface/runtimeAppVersion', () => ({
  readRuntimeAppVersion: () => 'test-version',
}))

import {
  startLocalWorker,
  stopOwnedLocalWorker,
} from '../../../src/app/main/worker/localWorkerManager'

afterEach(async () => {
  await stopOwnedLocalWorker()
  if (state.directory) {
    await rm(state.directory, { recursive: true, force: true })
  }
  state.directory = ''
})

it('keeps draining the real child pipe after its ready handshake so logging cannot block work', async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'opencove-worker-stdout-'))
  const entryDirectory = join(state.directory, 'out', 'main')
  await mkdir(entryDirectory, { recursive: true })
  const completionPath = join(state.directory, 'output-drained')
  await writeFile(
    join(entryDirectory, 'worker.js'),
    `
    const fs = require('node:fs')
    const server = require('node:http').createServer((_request, response) => response.end('responsive'))
    server.listen(0, '127.0.0.1', () => {
      process.stdout.write(JSON.stringify({version:1,pid:process.pid,hostname:'127.0.0.1',
        port:server.address().port,token:'fixture-token',createdAt:new Date().toISOString(),
        appVersion:'test-version',startedBy:'desktop'}) + '\\n')
      setTimeout(async () => {
        const chunk = Buffer.alloc(64 * 1024, 120)
        for (let index = 0; index < 32; index++) {
          await new Promise(done => process.stdout.write(chunk, done))
        }
        fs.writeFileSync(${JSON.stringify(completionPath)}, 'done')
      }, 30)
    })
  `,
  )
  const status = await startLocalWorker()
  expect(status.status).toBe('running')
  await vi.waitFor(
    async () => {
      expect(await readFile(completionPath, 'utf8')).toBe('done')
    },
    { timeout: 2000, interval: 25 },
  )
  const response = await new Promise<string>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${status.connection!.port}`, result => {
      let body = ''
      result.setEncoding('utf8')
      result.on('data', chunk => {
        body += chunk
      })
      result.once('end', () => resolve(body))
      result.once('error', reject)
    })
    request.setTimeout(1000, () => request.destroy(new Error('Worker HTTP request timed out')))
    request.once('error', reject)
  })
  expect(response).toBe('responsive')
}, 10_000)
