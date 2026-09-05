/* eslint-disable no-await-in-loop -- Stream reads and writes provide bounded download backpressure. */
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function download(
  url: string,
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<void> {
  const timeout = AbortSignal.timeout(300_000)
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok || !response.body) {
    throw new Error(
      `[opencove-bootstrap:installer_unavailable] Desktop download returned HTTP ${response.status}.`,
    )
  }
  const file = await open(path, 'wx', 0o600)
  const reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      size += chunk.value.byteLength
      if (size > limit) {
        throw new Error(
          '[opencove-bootstrap:installer_unavailable] Release download exceeds the allowed size.',
        )
      }
      await file.writeFile(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
    await file.close()
  }
}

/** Relay exactly the pinned release when the remote host cannot reach the release service. */
export async function withManagedSshArtifactRelay<T>(
  options: {
    installerUrl: string
    assetName: string
    windows: boolean
    signal?: AbortSignal
  },
  consume: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'opencove-ssh-relay-'))
  const base = options.installerUrl.slice(0, options.installerUrl.lastIndexOf('/'))
  try {
    await download(
      `${base}/SHA256SUMS.txt`,
      join(directory, 'SHA256SUMS.txt'),
      1_048_576,
      options.signal,
    )
    await download(
      options.installerUrl,
      join(directory, `opencove-install.${options.windows ? 'ps1' : 'sh'}`),
      1_048_576,
      options.signal,
    )
    await download(
      `${base}/${options.assetName}`,
      join(directory, options.assetName),
      1_073_741_824,
      options.signal,
    )
    return await consume(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
