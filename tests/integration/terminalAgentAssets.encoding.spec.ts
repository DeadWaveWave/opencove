import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

const roots: string[] = []
const stores: TerminalAgentTelemetryAssetStore[] = []
const utf8Signature = Buffer.from([0xef, 0xbb, 0xbf])
const runtimeExecutable = "C:\\Program Files\\应用 O'Cove 🌊\\OpenCove.exe"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "opencove-assets 用户's 路径 🌊 "))
  roots.push(root)
  const diagnostic = vi.fn()
  const store = new TerminalAgentTelemetryAssetStore({
    parentDirectory: root,
    platform: 'win32',
    runtimeExecutable,
    diagnostic,
  })
  stores.push(store)
  return { store, diagnostic, assets: await store.ensure() }
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('terminal Agent script encoding', () => {
  it.each(['claude', 'codex', 'pi'])(
    '%s PowerShell source explicitly identifies UTF-8 and quotes Unicode paths',
    async provider => {
      const { assets } = await fixture()
      const bytes = await readFile(join(assets.shimDirectory, `${provider}.ps1`))
      expect(bytes.subarray(0, 3)).toEqual(utf8Signature)
      const source = bytes.subarray(3).toString('utf8')
      expect(source).toContain(`'${runtimeExecutable.replaceAll("'", "''")}'`)
      expect(source).toContain(`'${assets.launcherPath.replaceAll("'", "''")}'`)
      expect(source).toContain(`$planDirectory = '${assets.planDirectory.replaceAll("'", "''")}'`)
      expect(source).toContain(`--prepare-windows ${provider} $planPath @args`)
      expect(source).toContain('exit $providerExitCode\r\n')
    },
  )

  it.each(['claude', 'codex', 'pi'])(
    '%s CMD source stays ASCII and resolves its colocated PowerShell script at runtime',
    async provider => {
      const { assets } = await fixture()
      const bytes = await readFile(join(assets.shimDirectory, `${provider}.cmd`))
      expect(bytes.every(byte => byte <= 0x7f)).toBe(true)
      const source = bytes.toString('utf8')
      expect(source).toContain('-File "%~dpn0.ps1" %*\r\n')
      expect(source).not.toContain(assets.rootDirectory)
      expect(source).not.toContain('chcp')
      expect(source).toContain('exit /b %ERRORLEVEL%\r\n')
    },
  )

  it('validates BOM bytes without rewriting healthy scripts and repairs a missing BOM', async () => {
    const { store, diagnostic, assets } = await fixture()
    const scriptPath = join(assets.shimDirectory, 'codex.ps1')
    const original = await readFile(scriptPath)
    expect(original.subarray(0, 3)).toEqual(utf8Signature)
    const before = await stat(scriptPath)
    await store.ensure()
    const after = await stat(scriptPath)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(diagnostic).not.toHaveBeenCalled()

    await writeFile(scriptPath, original.subarray(3))
    expect(await store.ensure()).toEqual(assets)
    expect(await readFile(scriptPath)).toEqual(original)
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith({ type: 'assets-repaired', count: 1 })
    await store.ensure()
    expect(diagnostic).toHaveBeenCalledTimes(1)
  })

  it('keeps POSIX shebangs and JavaScript free of the PowerShell-only BOM', async () => {
    const { assets } = await fixture()
    const scripts = await Promise.all(
      [
        assets.shellLauncherPath,
        ...['claude', 'codex', 'pi'].map(provider => join(assets.shimDirectory, provider)),
      ].map(path => readFile(path)),
    )
    for (const script of scripts) {
      expect(script.subarray(0, 2).toString('utf8')).toBe('#!')
    }
    const launcher = await readFile(assets.launcherPath)
    expect(launcher.subarray(0, 3)).not.toEqual(utf8Signature)
  })
})
