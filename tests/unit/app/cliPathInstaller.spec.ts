import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<typeof import('node:child_process').execFile>(),
}))

let mockHomeDir = ''
let mockAppPath = ''
let mockIsPackaged = false
let previousResourcesPathDescriptor: PropertyDescriptor | undefined
let originalPlatform: NodeJS.Platform
let originalLocalAppData: string | undefined
let originalPath: string | undefined

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  default: {
    execFile: execFileMock,
  },
}))

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
}

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
    execFileMock.mockReset()
    originalPlatform = process.platform
    originalLocalAppData = process.env.LOCALAPPDATA
    originalPath = process.env.PATH
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
    setPlatform(originalPlatform)
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData
    }
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
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
    setPlatform('linux')
    const { installCliToPath, resolveCliPathStatus } =
      await import('../../../src/app/main/cli/cliPathInstaller')

    const status = await installCliToPath()

    expect(status.installed).toBe(true)
    expect(status.healthy).toBe(true)
    expect(status.path).toMatch(/opencove$/)

    const wrapper = await readFile(status.path ?? '', 'utf8')
    expect(wrapper).toContain('# OPENCOVE_WRAPPER_KIND=runtime')
    expect(wrapper).toContain('# OPENCOVE_INSTALL_OWNER=desktop')
    expect(wrapper).toContain(
      resolve(process.resourcesPath, 'app.asar', 'src', 'app', 'cli', 'opencove.mjs'),
    )

    await expect(resolveCliPathStatus()).resolves.toEqual(status)
  })

  it('marks an owned launcher as unhealthy when the target script is missing', async () => {
    setPlatform('linux')
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

  it('installs a Windows cmd launcher and adds the user bin dir to PATH', async () => {
    setPlatform('win32')
    const localAppData = resolve(mockHomeDir, '..', 'LocalAppData')
    const userBinDir = resolve(localAppData, 'OpenCove', 'bin')
    process.env.LOCALAPPDATA = localAppData
    process.env.PATH = 'C:\\Windows\\System32'
    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(null, '', '')
      return {} as ReturnType<typeof execFileMock>
    })

    const { installCliToPath, resolveCliPathStatus } =
      await import('../../../src/app/main/cli/cliPathInstaller')

    const status = await installCliToPath()

    expect(status.installed).toBe(true)
    expect(status.healthy).toBe(true)
    expect(status.path).toBe(resolve(userBinDir, 'opencove.cmd'))

    const wrapper = await readFile(status.path ?? '', 'utf8')
    expect(wrapper).toContain('rem __OPENCOVE_CLI_WRAPPER__')
    expect(wrapper).toContain('rem OPENCOVE_INSTALL_OWNER=desktop')
    expect(wrapper).toContain('rem OPENCOVE_WRAPPER_KIND=runtime')
    expect(wrapper).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(wrapper).toContain('"%ELECTRON_BIN%" "%CLI_SCRIPT%" %*')
    expect(process.env.PATH).toContain(userBinDir)
    expect(execFileMock).toHaveBeenCalledTimes(1)

    await expect(resolveCliPathStatus()).resolves.toEqual(status)
  })

  it('does not report or uninstall a standalone Windows launcher as Desktop-owned', async () => {
    setPlatform('win32')
    const localAppData = resolve(mockHomeDir, '..', 'LocalAppData')
    const userBinDir = resolve(localAppData, 'OpenCove', 'bin')
    const launcherPath = resolve(userBinDir, 'opencove.cmd')
    const cliPath = resolve(process.resourcesPath, 'app.asar', 'src', 'app', 'cli', 'opencove.mjs')
    process.env.LOCALAPPDATA = localAppData
    process.env.PATH = `${userBinDir};C:\\Windows\\System32`
    await mkdir(userBinDir, { recursive: true })
    await writeFile(
      launcherPath,
      [
        '@echo off',
        'rem __OPENCOVE_CLI_WRAPPER__',
        'rem OPENCOVE_INSTALL_OWNER=standalone',
        'rem OPENCOVE_WRAPPER_KIND=runtime',
        `rem OPENCOVE_ELECTRON_BIN=${process.execPath}`,
        `rem OPENCOVE_CLI_SCRIPT=${cliPath}`,
        '',
      ].join('\r\n'),
      'utf8',
    )

    const { resolveCliPathStatus, uninstallCliFromPath } =
      await import('../../../src/app/main/cli/cliPathInstaller')

    await expect(resolveCliPathStatus()).resolves.toEqual({
      installed: false,
      path: null,
      healthy: false,
    })
    await expect(uninstallCliFromPath()).resolves.toEqual({
      installed: false,
      path: null,
      healthy: false,
    })
    await expect(readFile(launcherPath, 'utf8')).resolves.toContain(
      'OPENCOVE_INSTALL_OWNER=standalone',
    )
  })
})
