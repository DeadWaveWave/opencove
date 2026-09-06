import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { RuntimeBuildIdentity } from '../../src/shared/contracts/runtimeBuild'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../src/shared/contracts/controlSurface'
import { DB_SCHEMA_VERSION } from '../../src/platform/persistence/sqlite/constants'

export function fingerprintRuntimeSources(files: Array<[string, string]>): string {
  const hash = createHash('sha256')
  for (const [name, source] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const content = source.replace(/\r\n/g, '\n')
    hash.update(JSON.stringify([name.replaceAll('\\', '/'), content]))
  }
  return hash.digest('hex')
}

export function createRuntimeBuildIdentity(
  root: string,
  development: boolean,
): RuntimeBuildIdentity {
  const paths = ['package.json', 'pnpm-lock.yaml', 'electron.vite.config.ts']
  const collect = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        collect(path)
      } else if (/\.(?:[cm]?[jt]sx?|json|css|html|sh|ps1|patch)$/.test(entry.name)) {
        paths.push(path)
      }
    }
  }
  for (const directory of ['src', 'scripts', 'patches']) {
    collect(directory)
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  return {
    schemaVersion: 1,
    buildId: fingerprintRuntimeSources(
      paths.map(path => [
        relative(root, join(root, path)).replaceAll('\\', '/'),
        readFileSync(join(root, path), 'utf8'),
      ]),
    ),
    appVersion: pkg.version,
    channel: development ? 'dev' : pkg.version.includes('-nightly.') ? 'nightly' : 'stable',
    protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
    ptyProtocolVersion: 1,
    launchContractVersion: 1,
    dataSchemaVersion: DB_SCHEMA_VERSION,
  }
}
