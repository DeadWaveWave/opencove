import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export function resolvePnpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function assertSpawnSucceeded(result) {
  if (result.error) {
    throw result.error
  }

  return result
}

export function runStandaloneAssetBuild({
  spawnSyncImpl = spawnSync,
  platform = process.platform,
  env = process.env,
  cwd = process.cwd(),
  stdio = 'inherit',
  rootDir = resolve(import.meta.dirname, '..', '..'),
} = {}) {
  const electronBuilderResult = assertSpawnSucceeded(
    spawnSyncImpl(
      resolvePnpmCommand(platform),
      ['exec', 'electron-builder', '--dir', '--publish', 'never'],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...env,
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        },
        shell: platform === 'win32',
        stdio,
      },
    ),
  )

  if ((electronBuilderResult.status ?? 1) !== 0) {
    return electronBuilderResult
  }

  return assertSpawnSucceeded(
    spawnSyncImpl(
      process.execPath,
      [resolve(rootDir, 'scripts/create-standalone-server-bundle.mjs')],
      {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
        stdio,
      },
    ),
  )
}
