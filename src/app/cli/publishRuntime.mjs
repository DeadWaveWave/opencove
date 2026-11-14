import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  readdir,
  realpath,
  readlink,
  lstat,
} from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'

function isInside(root, path) {
  const child = relative(root, path)
  return (
    !isAbsolute(child) &&
    child !== '..' &&
    !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
}

export async function verifyRuntimeTree(root) {
  const canonical = await realpath(root)
  const hash = createHash('sha256')
  const visit = async directory => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(directory, entry.name)
      if (path === join(root, 'artifact.json')) {
        continue
      }
      if (!isInside(canonical, await realpath(path))) {
        throw new Error('Runtime archive contains an escaping link.')
      }
      if (entry.isSymbolicLink()) {
        hash.update(JSON.stringify([relative(root, path), await readlink(path)]))
      } else if (entry.isDirectory()) {
        await visit(path)
      } else {
        hash.update(JSON.stringify(relative(root, path).replaceAll('\\', '/')))
        const fileHash = createHash('sha256')
        for await (const chunk of createReadStream(path)) {
          fileHash.update(chunk)
        }
        hash.update(fileHash.digest())
      }
    }
  }
  await visit(root)
  const node = resolve(
    root,
    process.platform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node',
  )
  const probe = spawnSync(node, [resolve(root, 'app/out/main/managedRuntime.js'), 'verify'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  })
  if (probe.error || probe.status !== 0) {
    throw new Error(`Runtime native verification failed: ${probe.stderr || probe.error?.message}`)
  }
  const identity = JSON.parse(probe.stdout)
  if (
    !identity.build?.buildId ||
    identity.platform !== process.platform ||
    identity.arch !== process.arch ||
    identity.engine !== 'node'
  ) {
    throw new Error('Runtime platform or build identity is invalid.')
  }
  return { ...identity, treeDigest: hash.digest('hex') }
}

export async function renameRuntimeDirectory(source, destination) {
  // Like graceful-fs, allow Windows scanners to release newly created files. Keep this
  // local to publication; an existing target belongs to the caller's reuse/repair protocol.
  const deadline = performance.now() + 60_000
  let originalError
  let backoff = 0
  for (;;) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
        throw error
      }
      originalError ??= error
      const missing = await lstat(destination).then(
        () => false,
        statError => statError.code === 'ENOENT',
      )
      if (!missing) {
        throw error
      }
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        throw originalError
      }
      backoff = Math.min(backoff + 10, 100, remaining)
      process.stderr.write(
        `[opencove] Retrying runtime publication rename ${JSON.stringify(source)} -> ${JSON.stringify(destination)} after ${error.code} in ${backoff}ms (60s limit).\n`,
      )
      await new Promise(done => setTimeout(done, backoff))
      if (performance.now() >= deadline) {
        throw originalError
      }
    }
  }
}

export async function publishRuntime(staging, destination, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error('Invalid artifact digest.')
  }
  const identity = await verifyRuntimeTree(staging)
  await writeFile(resolve(staging, 'artifact.json'), JSON.stringify({ digest, ...identity }), {
    mode: 0o600,
  })
  await mkdir(resolve(destination, '..'), { recursive: true })
  try {
    await renameRuntimeDirectory(staging, destination)
    return destination
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) {
      throw error
    }
    try {
      const existing = JSON.parse(await readFile(resolve(destination, 'artifact.json'), 'utf8'))
      if (existing.digest !== digest) {
        throw new Error('Artifact identity conflict.', { cause: error })
      }
      const verified = await verifyRuntimeTree(destination)
      if (
        verified.treeDigest !== identity.treeDigest ||
        JSON.stringify(verified.build) !== JSON.stringify(identity.build)
      ) {
        throw new Error('Cached runtime content has changed.', { cause: error })
      }
      return destination
    } catch {
      // Repair never removes a directory that a running Worker could still be using.
      const repair = `${destination}.repair-${randomUUID()}`
      await renameRuntimeDirectory(staging, repair)
      return repair
    }
  }
}

if (
  process.argv[1] &&
  (await realpath(new URL(import.meta.url))) === (await realpath(process.argv[1]))
) {
  publishRuntime(...process.argv.slice(2)).then(
    path => process.stdout.write(`${path}\n`),
    error => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}
