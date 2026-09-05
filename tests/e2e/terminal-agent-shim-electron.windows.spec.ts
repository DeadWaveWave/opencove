import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { spawn, type IPty } from 'node-pty'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

test('Windows interactive shim waits for the Electron GUI executable to publish and clean its plan', async () => {
  test.skip(process.platform !== 'win32', 'Windows PowerShell GUI process semantics')
  const root = await mkdtemp(join(tmpdir(), 'opencove-shim-electron-'))
  const realBin = join(root, 'provider 路径 with spaces')
  await mkdir(realBin)
  await writeFile(
    join(realBin, 'provider.cjs'),
    `process.stdout.write('PROVIDER_ARGS=' + JSON.stringify(process.argv.slice(2)) + '\\n'); process.exitCode = 37;`,
  )
  await writeFile(
    join(realBin, 'codex.cmd'),
    `@echo off\r\n"${process.execPath}" "%~dp0provider.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  )
  const assets = new TerminalAgentTelemetryAssetStore({
    platform: 'win32',
    runtimeExecutable: createRequire(__filename)('electron') as string,
  })
  let pty: IPty | null = null
  let exited = false
  let output = ''
  try {
    const published = await assets.ensure()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      PATH: [published.shimDirectory, realBin, process.env.PATH ?? ''].join(delimiter),
      OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY: published.shimDirectory,
    }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.OPENCOVE_TERMINAL_AGENT_ENDPOINT
    delete env.OPENCOVE_TERMINAL_AGENT_TOKEN
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'path' && key !== 'PATH') {
        delete env[key]
      }
    }
    pty = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'], {
      cwd: root,
      env,
      cols: 160,
      rows: 30,
    })
    pty.onData(data => (output += data))
    pty.onExit(() => {
      exited = true
    })
    pty.write(`codex 'argument with spaces'; Write-Output ('PROVIDER_EXIT=' + $LASTEXITCODE)\r`)
    await expect
      .poll(() => output, { timeout: 15_000 })
      .toContain('PROVIDER_ARGS=["argument with spaces"]')
    await expect.poll(() => output, { timeout: 15_000 }).toContain('PROVIDER_EXIT=37')
    await expect.poll(() => readdir(published.planDirectory)).toEqual([])
    expect(output).not.toContain('ItemNotFoundException')
    pty.write("Write-Output ('SHELL_'+'REUSED')\r")
    await expect.poll(() => output).toContain('SHELL_REUSED')
    pty.write('exit\r')
    await expect.poll(() => exited).toBe(true)
  } finally {
    if (!exited) {
      pty?.kill()
    }
    await test.info().attach('interactive-electron-shim-output', {
      body: Buffer.from(output),
      contentType: 'text/plain',
    })
    await assets.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
