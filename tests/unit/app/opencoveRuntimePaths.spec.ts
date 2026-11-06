import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolvePackagedAppRoot,
  resolvePackagedCliScriptPath,
  resolvePackagedWorkerScriptPath,
  resolveWorkerCliScriptPath,
} from '../../../src/shared/runtime/opencoveRuntimePaths'

const createdRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-runtime-paths-'))
  createdRoots.push(root)
  return root
}

describe('opencoveRuntimePaths', () => {
  afterEach(async () => {
    await Promise.all(
      createdRoots.splice(0).map(root => rm(root, { recursive: true, force: true })),
    )
  })

  it('prefers app.asar when packaged resources contain it', async () => {
    const resourcesDir = await createTempRoot()
    await mkdir(resolve(resourcesDir, 'app.asar'))
    await mkdir(resolve(resourcesDir, 'app'))

    expect(basename(resolvePackagedAppRoot(resourcesDir))).toBe('app.asar')
    expect(resolvePackagedCliScriptPath(resourcesDir)).toBe(
      resolve(resourcesDir, 'app.asar', 'out', 'cli', 'opencove.mjs'),
    )
    expect(resolvePackagedWorkerScriptPath(resourcesDir)).toBe(
      resolve(resourcesDir, 'app.asar', 'out', 'main', 'worker.js'),
    )
  })

  it('falls back to app when app.asar is unavailable', async () => {
    const resourcesDir = await createTempRoot()
    await mkdir(resolve(resourcesDir, 'app'))

    expect(resolvePackagedAppRoot(resourcesDir)).toBe(resolve(resourcesDir, 'app'))
    expect(resolvePackagedWorkerScriptPath(resourcesDir)).toBe(
      resolve(resourcesDir, 'app', 'out', 'main', 'worker.js'),
    )
  })
  it('selects the CLI in the hosting build, with an explicit source-bundle fallback', async () => {
    const root = await createTempRoot()
    const workerDirectory = resolve(root, 'out', 'main')
    expect(resolveWorkerCliScriptPath(workerDirectory)).toBe(
      resolve(root, 'src', 'app', 'cli', 'opencove.mjs'),
    )
    await mkdir(resolve(root, 'out', 'cli'), { recursive: true })
    await writeFile(resolve(root, 'out', 'cli', 'opencove.mjs'), '')
    expect(resolveWorkerCliScriptPath(workerDirectory)).toBe(
      resolve(root, 'out', 'cli', 'opencove.mjs'),
    )
  })
})
