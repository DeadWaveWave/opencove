import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Resolve only supported CLI layouts, without filesystem probes (including virtual asar paths). */
export function resolveCliAppRoot(cliDirectory = dirname(fileURLToPath(import.meta.url))) {
  if (basename(cliDirectory) === 'cli' && basename(dirname(cliDirectory)) === 'out') {
    return resolve(cliDirectory, '../..')
  }
  if (
    basename(cliDirectory) === 'cli' &&
    basename(dirname(cliDirectory)) === 'app' &&
    basename(dirname(dirname(cliDirectory))) === 'src'
  ) {
    return resolve(cliDirectory, '../../..')
  }
  throw new Error(`Unsupported CLI directory: ${cliDirectory}`)
}
