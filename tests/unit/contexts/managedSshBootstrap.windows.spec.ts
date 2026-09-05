// @vitest-environment node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { buildWindowsBootstrapScript } from '../../../src/app/main/controlSurface/topology/managedSshBootstrapScripts'
import { createManagedSshBootstrapProgressParser } from '../../../src/app/main/controlSurface/topology/managedSshBootstrapProgress'
import { runCommand } from '../../../src/platform/process/runCommand'
import { runtimeBuildFixture } from '../../helpers/runtimeBuild'

const windows = process.platform === 'win32' ? describe : describe.skip
windows('generated managed SSH PowerShell bootstrap', () => {
  it('executes isolated installer and launcher, emitting incremental allowlisted stages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'opencove-ssh-windows-'))
    const fixtureScript = path.join(root, 'runtime-fixture.cjs')
    await writeFile(
      fixtureScript,
      `if (process.argv[3] === 'inspect') console.log(JSON.stringify(${JSON.stringify(runtimeBuildFixture)}));
else { const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8').replace(/^\\uFEFF/, '')); require('node:fs').writeFileSync(process.env.OPENCOVE_SSH_TEST_LAUNCHED, JSON.stringify(input)); console.log('[opencove-bootstrap-progress:v1] waiting_for_runtime'); }`,
    )
    const launcher = `@echo off\r\nrem __OPENCOVE_CLI_WRAPPER__\r\n"${process.execPath}" "${fixtureScript}" %*\r\nexit /b %ERRORLEVEL%\r\n`
    const launched = path.join(root, 'launched.json')
    let downloads = 0
    const server = createServer((request, response) => {
      if (request.url === '/installer.ps1') {
        downloads += 1
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end(`New-Item -ItemType Directory -Path $env:OPENCOVE_BIN_DIR -Force | Out-Null
[IO.File]::WriteAllBytes((Join-Path $env:OPENCOVE_BIN_DIR 'opencove.cmd'), [Convert]::FromBase64String('${Buffer.from(launcher).toString('base64')}'))
[IO.File]::WriteAllText($env:OPENCOVE_SSH_TEST_INSTALLED, 'installed')\n`)
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const script = buildWindowsBootstrapScript(
        {
          endpointId: 'fixture',
          displayName: 'Fixture',
          token: 'fixture-token',
          ssh: {
            host: 'fixture.invalid',
            port: 22,
            username: null,
            remotePort: port,
            remotePlatform: 'windows',
          },
        },
        {
          reinstallRuntime: true,
          runtimeBuild: runtimeBuildFixture,
          installerUrl: `http://127.0.0.1:${port}/installer.ps1`,
        },
      )
      const scriptPath = path.join(root, 'bootstrap.ps1')
      await writeFile(scriptPath, script)
      const phases: string[] = []
      let settled = false
      const parser = createManagedSshBootstrapProgressParser(phase => {
        expect(settled).toBe(false)
        phases.push(phase)
      })
      const result = await runCommand(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        root,
        {
          timeoutMs: 15_000,
          onStdout: parser.push,
          captureMaxBytes: 262_144,
          env: {
            ...process.env,
            LOCALAPPDATA: path.join(root, 'local'),
            APPDATA: path.join(root, 'roaming'),
            OPENCOVE_SSH_TEST_INSTALLED: path.join(root, 'installed'),
            OPENCOVE_SSH_TEST_LAUNCHED: launched,
          },
        },
      )
      settled = true
      parser.finish()
      expect(result.exitCode, result.stderr).toBe(0)
      expect(phases).toEqual([
        'checking_remote_runtime',
        'checking_installation',
        'downloading_installer',
        'installing_runtime',
        'starting_runtime',
        'waiting_for_runtime',
      ])
      expect(downloads).toBe(1)
      expect(await readFile(path.join(root, 'installed'), 'utf8')).toBe('installed')
      expect(JSON.parse(await readFile(launched, 'utf8'))).toMatchObject({
        token: 'fixture-token',
        runtimeBuild: runtimeBuildFixture,
      })
      expect(result.stdout).not.toContain('fixture-token')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      )
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
