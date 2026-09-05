#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- Publish the small installer set after the archive finishes. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { runStandaloneAssetBuild } from './lib/standalone-asset-build.mjs'
import { parseArgs } from 'node:util'
import { createManagedRuntimeDevelopmentOverlay } from './lib/managed-runtime-development-overlay.mjs'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    'base-directory': { type: 'string' },
    platform: { type: 'string' },
    arch: { type: 'string' },
  },
})
const platform =
  values.platform ?? { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]
const arch = values.arch ?? process.arch
const env = { ...process.env, OPENCOVE_BUILD_CHANNEL: 'dev' }
const build = spawnSync(process.execPath, [join(root, 'scripts/run-electron-vite-build.mjs')], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
})
if (build.error || build.status !== 0) {
  throw build.error ?? new Error('Runtime build failed.')
}
const manifest = spawnSync(
  process.execPath,
  [join(root, 'scripts/generate-release-manifest.mjs')],
  {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
)
if (manifest.error || manifest.status !== 0) {
  throw manifest.error ?? new Error('Release manifest build failed.')
}
if (values['base-directory']) {
  await createManagedRuntimeDevelopmentOverlay({
    root,
    baseDirectory: resolve(values['base-directory']),
    platform,
    arch,
  })
} else {
  const packed = runStandaloneAssetBuild({ cwd: root, env })
  if (packed.status !== 0) {
    throw new Error('Standalone packaging failed.')
  }
}
const identity = JSON.parse(await readFile(join(root, 'out/main/runtime-build.json'), 'utf8'))
const name = `opencove-server-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}`
const destination = resolve(
  process.env.OPENCOVE_MANAGED_SSH_ARTIFACT_DIR ??
    join(root, 'release/managed-ssh', identity.buildId),
)
await mkdir(destination, { recursive: true })
await copyFile(join(root, 'dist', name), join(destination, name))
for (const ext of ['sh', 'ps1']) {
  await copyFile(
    join(root, `scripts/release-assets/opencove-install.${ext}`),
    join(destination, `opencove-install.${ext}`),
  )
}
const hash = createHash('sha256')
for await (const chunk of createReadStream(join(destination, name))) {
  hash.update(chunk)
}
await writeFile(join(destination, 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${name}\n`)
await writeFile(join(destination, 'runtime-build.json'), JSON.stringify(identity))
process.stdout.write(`Managed SSH artifact directory: ${destination}\n`)
