import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { TerminalAgentActivityGateway } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentActivityEnvironmentService } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

function runCmd(options: {
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'claude user-arg'], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}

test.describe('terminal Agent shim (Windows)', () => {
  test.skip(process.platform !== 'win32', 'Windows command-shim contract')

  test('skips itself, injects hooks, preserves arguments, and forwards the true exit code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-terminal-agent-windows-'))
    const realBin = join(root, 'real-bin')
    await mkdir(realBin)
    await writeFile(
      join(realBin, 'claude.cmd'),
      [
        '@echo off',
        'echo REAL_ARGS=%*',
        'echo ELECTRON_RUN_AS_NODE=%ELECTRON_RUN_AS_NODE%',
        'exit /b 37',
        '',
      ].join('\r\n'),
    )

    const gateway = new TerminalAgentActivityGateway({
      resolveHookInjection: () => ({
        prepareHookInjection: async () => ({
          args: ['--injected'],
          env: {},
          hookInstallState: 'installed',
        }),
      }),
    })
    const assets = new TerminalAgentTelemetryAssetStore({
      runtimeExecutable: process.execPath,
      platform: process.platform,
    })
    const service = new TerminalAgentActivityEnvironmentService({
      assets,
      gateway,
      inheritedPath: process.env.PATH ?? '',
      inheritedShell: 'cmd.exe',
      platform: process.platform,
    })

    try {
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      env.PATH = `${realBin}${delimiter}${process.env.PATH ?? ''}`
      const prepared = await service.prepare({
        args: [],
        command: 'cmd.exe',
        cwd: root,
        environment: env,
        interactiveShell: true,
      })
      prepared.commit('pty-windows')
      const published = await assets.ensure()
      prepared.environment.PATH = [
        published.shimDirectory,
        published.shimDirectory,
        realBin,
        process.env.PATH ?? '',
      ].join(delimiter)

      const result = await runCmd({ cwd: root, env: prepared.environment })

      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('REAL_ARGS=--injected user-arg')
      expect(result.stdout).toContain('ELECTRON_RUN_AS_NODE=')
      expect(result.code).toBe(37)
      await prepared.dispose()
    } finally {
      await gateway.dispose()
      await assets.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
