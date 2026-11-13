import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'
import { removePathWithRetry } from './workspace-canvas.testUtils'

const execute = promisify(execFile)

for (const shell of ['cmd', 'powershell'] as const) {
  test(`${shell} shim preserves Unicode profile, runtime executable and argument paths`, async () => {
    test.skip(process.platform !== 'win32', 'Native Windows script decoding and path expansion')
    // Win32_Process reports long executable paths even when TEMP uses a RUNNER~1 alias.
    const root = await realpath(await mkdtemp(join(tmpdir(), "opencove-shim 用户's 路径 🌊 ")))
    const runtimeDirectory = join(root, "应用's runtime")
    const runtime = join(runtimeDirectory, 'node.exe')
    const providerDirectory = join(root, 'provider bin')
    const providerScript = join(root, 'provider.cjs')
    const store = new TerminalAgentTelemetryAssetStore({
      parentDirectory: join(root, 'profile 目录'),
      runtimeExecutable: runtime,
      platform: 'win32',
    })
    try {
      await Promise.all([mkdir(runtimeDirectory), mkdir(providerDirectory)])
      // Node's Windows executable is self-contained. Copies exercise real Unicode executable
      // paths without requiring symlink privileges or launching an installed Agent CLI.
      await Promise.all([
        copyFile(process.execPath, runtime),
        copyFile(process.execPath, join(providerDirectory, 'codex.exe')),
      ])
      await writeFile(
        providerScript,
        `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null }))`,
      )
      const assets = await store.ensure()
      const env = { ...process.env }
      for (const key of Object.keys(env)) {
        if (key.toLowerCase() === 'path') {
          delete env[key]
        }
      }
      env.PATH = [assets.shimDirectory, providerDirectory, process.env.PATH ?? ''].join(delimiter)
      env.OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY = assets.shimDirectory
      delete env.ELECTRON_RUN_AS_NODE
      delete env.OPENCOVE_TERMINAL_AGENT_ENDPOINT
      delete env.OPENCOVE_TERMINAL_AGENT_TOKEN
      const userArgs = ['argument with spaces', '参数-🌊', "single'quote"]
      const invocation =
        shell === 'cmd'
          ? {
              command: 'cmd.exe',
              args: [
                '/d',
                '/s',
                '/c',
                `codex ${[providerScript, ...userArgs].map(arg => `"${arg}"`).join(' ')}`,
              ],
            }
          : {
              command: 'powershell.exe',
              args: [
                '-NoLogo',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                join(assets.shimDirectory, 'codex.ps1'),
                providerScript,
                ...userArgs,
              ],
            }
      const { stdout, stderr } = await execute(invocation.command, invocation.args, {
        cwd: root,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
      })
      expect(stderr).toBe('')
      expect(JSON.parse(stdout)).toEqual({ args: userArgs, electronRunAsNode: null })
      expect(await readdir(assets.planDirectory)).toEqual([])
      // execFile has observed shell close, and the PowerShell shim awaits both Node helpers.
      // Prove that cleanup retries cannot conceal a surviving fixture process.
      const processes = await execute(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:OPENCOVE_SHIM_TEST_ROOT, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId, ParentProcessId, ExecutablePath | ConvertTo-Json -Compress',
        ],
        { env: { ...process.env, OPENCOVE_SHIM_TEST_ROOT: root }, windowsHide: true },
      )
      expect(processes.stderr).toBe('')
      expect(processes.stdout.trim(), 'Fixture executables must exit before cleanup').toBe('')
    } finally {
      await store.dispose()
      // Windows may retain an image/file handle briefly after exit (including scanner handles).
      await removePathWithRetry(root)
      await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
}
