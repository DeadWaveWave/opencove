import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mkdir, mkdtemp, readFile, rm, unlink, writeFile } =
  await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<typeof import('node:child_process').execFile>(),
}))

let mockRootDir = ''
let mockHomeDir = ''
let mockAppPath = ''
let mockIsPackaged = false
let previousResourcesPathDescriptor: PropertyDescriptor | undefined
let originalPlatform: NodeJS.Platform
let originalLocalAppData: string | undefined
let originalPath: string | undefined

// The installer intentionally probes system bins, even with a mocked home. Keep
// every filesystem operation inside the fixture, including existing wrappers.
function resolveFixturePath(filePath: string): string {
  if (!mockRootDir) {
    throw new Error('CLI installer fixture is not initialized')
  }

  const normalized = resolve(filePath)
  const relativePath = relative(mockRootDir, normalized)
  if (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)) {
    return normalized
  }

  if (normalized === resolve(process.execPath)) {
    return join(mockRootDir, 'electron')
  }

  for (const [index, binDir] of ['/opt/homebrew/bin', '/usr/local/bin'].entries()) {
    const relativeBinPath = relative(resolve(binDir), normalized)
    if (relativeBinPath === '' || relativeBinPath === 'opencove') {
      return join(mockRootDir, 'system-bins', String(index), relativeBinPath)
    }
  }

  throw new Error(`CLI installer attempted filesystem access outside its fixture: ${filePath}`)
}

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  // Deliberately do not spread fs: new installer IO must be isolated explicitly.
  const sandboxedFs = {
    access: (path: string, mode?: number) => fs.access(resolveFixturePath(path), mode),
    mkdir: (path: string, options?: Parameters<typeof fs.mkdir>[1]) =>
      fs.mkdir(resolveFixturePath(path), options),
    readFile: (path: string, options?: Parameters<typeof fs.readFile>[1]) =>
      fs.readFile(resolveFixturePath(path), options),
    rm: (path: string, options?: Parameters<typeof fs.rm>[1]) =>
      fs.rm(resolveFixturePath(path), options),
    writeFile: (path: string, data: string, options?: Parameters<typeof fs.writeFile>[2]) =>
      fs.writeFile(resolveFixturePath(path), data, options),
  }
  return { ...sandboxedFs, default: sandboxedFs }
})

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
    mockRootDir = await mkdtemp(join(tmpdir(), 'opencove-cli-installer-'))
    mockHomeDir = resolve(mockRootDir, 'home')
    mockAppPath = resolve(mockRootDir, 'app')
    mockIsPackaged = true
    const resourcesDir = resolve(mockRootDir, 'resources')
    previousResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: resourcesDir,
    })
    await writeFile(resolveFixturePath(process.execPath), '', { mode: 0o755 })
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

    const rootDir = mockRootDir
    mockRootDir = ''
    mockHomeDir = ''
    mockAppPath = ''
    mockIsPackaged = false
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it.each(['darwin', 'linux'] as const)(
    'installs from packaged resources in the user bin when system bins are unavailable on %s',
    async platform => {
      setPlatform(platform)
      const { installCliToPath, resolveCliPathStatus } =
        await import('../../../src/app/main/cli/cliPathInstaller')

      const status = await installCliToPath()

      expect(status.installed).toBe(true)
      expect(status.healthy).toBe(true)
      expect(status.path).toBe(resolve(mockHomeDir, '.local', 'bin', 'opencove'))

      const wrapper = await readFile(status.path ?? '', 'utf8')
      expect(wrapper).toContain('# OPENCOVE_WRAPPER_KIND=runtime')
      expect(wrapper).toContain('# OPENCOVE_INSTALL_OWNER=desktop')
      expect(wrapper).toContain(
        resolve(process.resourcesPath, 'app.asar', 'src', 'app', 'cli', 'opencove.mjs'),
      )

      await expect(resolveCliPathStatus()).resolves.toEqual(status)
    },
  )

  it.each([
    ['darwin', '/opt/homebrew/bin'],
    ['linux', '/usr/local/bin'],
  ] as const)(
    'installs, updates, and uninstalls a system launcher on %s inside the fixture',
    async (platform, binDir) => {
      setPlatform(platform)
      const launcherPath = join(binDir, 'opencove')
      const fixtureLauncherPath = resolveFixturePath(launcherPath)
      await mkdir(resolveFixturePath(binDir), { recursive: true })
      const { installCliToPath, resolveCliPathStatus, uninstallCliFromPath } =
        await import('../../../src/app/main/cli/cliPathInstaller')

      await expect(installCliToPath()).resolves.toEqual({
        installed: true,
        path: launcherPath,
        healthy: true,
      })
      await expect(readFile(fixtureLauncherPath, 'utf8')).resolves.toContain(
        'OPENCOVE_INSTALL_OWNER=desktop',
      )

      await writeFile(
        fixtureLauncherPath,
        '# __OPENCOVE_CLI_WRAPPER__\n# OPENCOVE_INSTALL_OWNER=desktop\n',
      )
      await expect(resolveCliPathStatus()).resolves.toEqual({
        installed: true,
        path: launcherPath,
        healthy: false,
      })
      await expect(installCliToPath()).resolves.toEqual({
        installed: true,
        path: launcherPath,
        healthy: true,
      })
      await expect(resolveCliPathStatus()).resolves.toEqual({
        installed: true,
        path: launcherPath,
        healthy: true,
      })
      await expect(uninstallCliFromPath()).resolves.toEqual({
        installed: false,
        path: null,
        healthy: false,
      })
      await expect(readFile(fixtureLauncherPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

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
