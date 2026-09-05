// @vitest-environment node
import { createServer } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { withManagedSshArtifactRelay } from '../../../src/app/main/controlSurface/topology/managedSshArtifactRelay'

it('relays only pinned assets and removes partial files after downstream failure', async () => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url!)
    response.end(request.url)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  let directory: string | null = null
  try {
    await expect(
      withManagedSshArtifactRelay(
        {
          installerUrl: `http://127.0.0.1:${port}/v0.3.1/opencove-install-v0.3.1.sh`,
          assetName: 'opencove-server-linux-x64.tar.gz',
          windows: false,
        },
        async path => {
          directory = path
          expect(await readFile(join(path, 'SHA256SUMS.txt'), 'utf8')).toBe(
            '/v0.3.1/SHA256SUMS.txt',
          )
          throw new Error('SSH disconnected')
        },
      ),
    ).rejects.toThrow('SSH disconnected')
    expect(requests).toEqual([
      '/v0.3.1/SHA256SUMS.txt',
      '/v0.3.1/opencove-install-v0.3.1.sh',
      '/v0.3.1/opencove-server-linux-x64.tar.gz',
    ])
    expect(directory).not.toBeNull()
    await expect(access(directory!)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => done()))
  }
})
