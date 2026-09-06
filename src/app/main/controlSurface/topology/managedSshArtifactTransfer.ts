/* eslint-disable no-await-in-loop -- Complete each upload before opening another SSH process. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runCommand } from '../../../../platform/process/runCommand'
import { createCommandOutputCapture } from '../../../../platform/process/boundedCommandOutput'
import { shellQuote } from './managedSshBootstrapScripts'
import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'
import { buildSshArgs } from './managedSshArgs'

function sshArgs(access: ManagedSshEndpointRuntimeAccess): string[] {
  return buildSshArgs(access, [])
}

async function upload(options: {
  ssh: string
  access: ManagedSshEndpointRuntimeAccess
  relativePath: string
  windows: boolean
  input: Readable
  signal?: AbortSignal
}): Promise<void> {
  const relative = options.relativePath
  if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.split('/').includes('..')) {
    throw new Error('Invalid staging path.')
  }
  const command = options.windows
    ? [
        'powershell',
        '-NoProfile',
        '-EncodedCommand',
        Buffer.from(
          `$p=Join-Path $HOME '${relative}'; [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)) | Out-Null; $f=[IO.File]::Open($p,'CreateNew','Write','None'); try { [Console]::OpenStandardInput().CopyTo($f) } finally { $f.Dispose() }`,
          'utf16le',
        ).toString('base64'),
      ]
    : [
        'sh',
        '-c',
        shellQuote(
          `umask 077; mkdir -p "$HOME/${relative.slice(0, relative.lastIndexOf('/'))}"; set -C; cat > "$HOME/${relative}"`,
        ),
      ]
  const child = spawn(options.ssh, [...sshArgs(options.access), ...command], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  })
  const output = createCommandOutputCapture(4_096)
  child.stderr.on('data', chunk => output.append(chunk))
  const abort = (): void => {
    child.kill()
  }
  const timer = setTimeout(abort, 300_000)
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const exited = new Promise<void>((done, reject) => {
      child.once('error', reject)
      child.once('close', code =>
        code === 0 ? done() : reject(new Error(`SSH artifact transfer failed: ${output.value()}`)),
      )
    })
    if (options.signal?.aborted) {
      abort()
    }
    await Promise.all([pipeline(options.input, child.stdin), exited])
    options.signal?.throwIfAborted()
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    options.input.destroy()
    if (child.exitCode === null) {
      child.kill()
    }
  }
}

/** The caller explicitly selects the build directory; no historical remote checkout discovery. */
export async function resolveManagedSshArtifactName(options: {
  ssh: string
  access: ManagedSshEndpointRuntimeAccess
  windows: boolean
  signal?: AbortSignal
}): Promise<string> {
  const probeCommand = options.windows
    ? [
        'powershell',
        '-NoProfile',
        '-EncodedCommand',
        Buffer.from('"windows " + $env:PROCESSOR_ARCHITECTURE', 'utf16le').toString('base64'),
      ]
    : ['uname -sm']
  const probe = await runCommand(
    options.ssh,
    [...sshArgs(options.access), ...probeCommand],
    process.cwd(),
    { signal: options.signal, timeoutMs: 10_000 },
  )
  const platform = options.windows
    ? 'windows'
    : probe.stdout.includes('Darwin')
      ? 'macos'
      : probe.stdout.includes('Linux')
        ? 'linux'
        : null
  const arch = /aarch64|arm64/i.test(probe.stdout)
    ? 'arm64'
    : /x86_64|amd64/i.test(probe.stdout)
      ? 'x64'
      : null
  if (!platform || !arch) {
    throw new Error(
      '[opencove-bootstrap:platform_unsupported] Unsupported remote platform or architecture.',
    )
  }
  return `opencove-server-${platform}-${arch}.${options.windows ? 'zip' : 'tar.gz'}`
}

export async function transferManagedSshArtifact(options: {
  ssh: string
  access: ManagedSshEndpointRuntimeAccess
  directory: string
  windows: boolean
  operationId: string
  signal?: AbortSignal
}): Promise<string> {
  const assetName = await resolveManagedSshArtifactName(options)
  if (!(await readdir(options.directory)).includes(assetName)) {
    throw new Error(
      `[opencove-bootstrap:installer_unavailable] Build artifact missing: ${assetName}`,
    )
  }
  const checksums = await readFile(join(options.directory, 'SHA256SUMS.txt'), 'utf8')
  const expected = checksums
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts[1]?.replace(/^\*/, '') === assetName)?.[0]
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(options.directory, assetName))) {
    hash.update(chunk)
  }
  if (!expected || hash.digest('hex') !== expected.toLowerCase()) {
    throw new Error('[opencove-bootstrap:checksum_failed] Local artifact checksum mismatch.')
  }
  const remote = `.cache/opencove/incoming/${options.operationId}`
  const installerName = `opencove-install.${options.windows ? 'ps1' : 'sh'}`
  for (const file of [assetName, 'SHA256SUMS.txt', installerName]) {
    await upload({
      ...options,
      relativePath: `${remote}/${basename(file)}`,
      input: createReadStream(join(options.directory, file)),
    })
  }
  await upload({
    ...options,
    relativePath: `${remote}/asset-name`,
    input: Readable.from([assetName]),
  })
  return remote
}
