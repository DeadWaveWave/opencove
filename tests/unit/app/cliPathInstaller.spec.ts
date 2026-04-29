import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockHomeDir = ''
let mockAppPath = ''
let mockIsPackaged = false
let previousResourcesPathDescriptor: PropertyDescriptor | undefined

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') {
        return mockHomeDir
      }

      return mockAppPath
    },
    getAppPath: () => mockAppPath,
    get isPackaged() {
      return mockIsPackaged
    },
  },
}))

async function createPackagedCli(resourcesDir: string): Promise<string> {
  const cliPath = resolve(resourcesDir, 'app.asar', 'src', 'app', 'cli', 'opencove.mjs')
  await mkdir(resolve(resourcesDir, 'app.asar', 'src', 'app', 'cli'), { recursive: true })
  await writeFile(cliPath, '#!/usr/bin/env node\n', 'utf8')
  return cliPath
}

describe('cliPathInstaller', () => {
  beforeEach(async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'opencove-cli-installer-'))
    mockHomeDir = resolve(tempRoot, 'home')
    mockAppPath = resolve(tempRoot, 'app')
    mockIsPackaged = true
    const resourcesDir = resolve(tempRoot, 'resources')
    previousResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: resourcesDir,
    })
    await createPackagedCli(resourcesDir)
  })

  afterEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()

    if (previousResourcesPathDescriptor) {
      Object.defineProperty(process, 'resourcesPath', previousResourcesPathDescriptor)
    } else {
      delete process.resourcesPath
    }

    const rootDir = mockHomeDir ? resolve(mockHomeDir, '..') : null
    mockHomeDir = ''
    mockAppPath = ''
    mockIsPackaged = false
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('installs from packaged resources and reports a healthy launcher', async () => {
    const { installCliToPath, resolveCliPathStatus } =
      await import('../../../src/app/main/cli/cliPathInstaller')

    const status = await installCliToPath()

    expect(status.installed).toBe(true)
    expect(status.healthy).toBe(true)
    expect(status.path).toMatch(/opencove$/)

    const wrapper = await readFile(status.path ?? '', 'utf8')
    expect(wrapper).toContain('# OPENCOVE_WRAPPER_KIND=runtime')
    expect(wrapper).toContain(
      resolve(process.resourcesPath, 'app.asar', 'src', 'app', 'cli', 'opencove.mjs'),
    )

    await expect(resolveCliPathStatus()).resolves.toEqual(status)
  })

  it('marks an owned launcher as unhealthy when the target script is missing', async () => {
    const { installCliToPath, resolveCliPathStatus } =
      await import('../../../src/app/main/cli/cliPathInstaller')

    const installed = await installCliToPath()
    await unlink(resolve(process.resourcesPath, 'app.asar', 'src', 'app', 'cli', 'opencove.mjs'))

    await expect(resolveCliPathStatus()).resolves.toEqual({
      installed: true,
      path: installed.path,
      healthy: false,
    })
  })
})
