/* eslint-disable no-await-in-loop -- Keep staging I/O and dependency verification bounded. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { archiveManagedRuntimeOverlay } from './managed-runtime-overlay-archive.mjs'

/** Cross-platform dev JS may reuse an explicitly selected, checksummed native distribution. */
export async function createManagedRuntimeDevelopmentOverlay({
  root,
  baseDirectory,
  platform,
  arch,
}) {
  if (!['linux', 'macos', 'windows'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error('Invalid target platform.')
  }
  const bundleName = `opencove-server-${platform}-${arch}`
  const assetName = `${bundleName}.${platform === 'windows' ? 'zip' : 'tar.gz'}`
  const checksums = await readFile(join(baseDirectory, 'SHA256SUMS.txt'), 'utf8')
  const expected = checksums
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts[1]?.replace(/^\*/, '') === assetName)?.[0]
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(baseDirectory, assetName))) {
    hash.update(chunk)
  }
  if (!expected || hash.digest('hex') !== expected.toLowerCase()) {
    throw new Error('Native base checksum mismatch.')
  }
  const stagingRoot = join(root, 'release/managed-runtime-staging')
  await mkdir(stagingRoot, { recursive: true })
  const staging = await mkdtemp(join(stagingRoot, 'overlay-'))
  const checked = args => {
    const result = spawnSync('tar', args, { windowsHide: true, encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(result.stderr)
    }
    return result.stdout
  }
  try {
    const contents = checked(['-tf', join(baseDirectory, assetName)])
      .split(/\r?\n/)
      .filter(Boolean)
    if (
      contents.some(
        path =>
          path.startsWith('/') ||
          path.includes('\\') ||
          path.split('/').includes('..') ||
          (!path.startsWith(`${bundleName}/`) && path !== bundleName),
      )
    ) {
      throw new Error('Invalid native base archive paths.')
    }
    checked(['-xf', join(baseDirectory, assetName), '-C', staging])
    const app = join(staging, bundleName, 'app')
    const current = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const base = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
    if (
      JSON.stringify(Object.entries(current.dependencies).sort()) !==
      JSON.stringify(Object.entries(base.dependencies).sort())
    ) {
      throw new Error(
        'Native base dependencies differ from this checkout; build a new target-platform standalone distribution.',
      )
    }
    for (const module of Object.keys(current.dependencies)) {
      const local = JSON.parse(
        await readFile(join(root, 'node_modules', module, 'package.json'), 'utf8'),
      )
      const remote = JSON.parse(
        await readFile(join(app, 'node_modules', module, 'package.json'), 'utf8'),
      )
      if (local.version !== remote.version) {
        throw new Error(`Native base resolved dependency differs: ${module}`)
      }
    }
    for (const path of ['out', 'src/app/cli']) {
      // Both absolute targets are literal descendants of our newly created staging app.
      const target = resolve(app, path)
      if (!target.startsWith(`${resolve(app)}${process.platform === 'win32' ? '\\' : '/'}`)) {
        throw new Error('Invalid overlay target.')
      }
      await rm(target, { recursive: true, force: true })
      await cp(join(root, path), target, { recursive: true })
    }
    await cp(join(root, 'package.json'), join(app, 'package.json'))
    await mkdir(join(root, 'dist'), { recursive: true })
    if (platform === 'windows') {
      throw new Error(
        'Cross-platform ZIP overlays are not supported; build the Windows bundle on Windows.',
      )
    }
    const archive = join(root, 'dist', assetName)
    archiveManagedRuntimeOverlay({
      base: join(baseDirectory, assetName),
      staging,
      bundleName,
      archive,
    })
    return archive
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
