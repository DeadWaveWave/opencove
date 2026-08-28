import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestInfo } from '@playwright/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportWindowsShimFailure } from '../../e2e/terminal-agent-shim.windows.diagnostics'

let root: string | null = null

afterEach(async () => {
  vi.restoreAllMocks()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = null
})

describe('Windows terminal Agent shim failure diagnostics', () => {
  it('logs bounded process evidence and lists plan names without reading plan contents', async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-shim-diagnostics-'))
    const shimDirectory = join(root, 'bin')
    const planDirectory = join(root, 'plans')
    await Promise.all([mkdir(shimDirectory), mkdir(planDirectory)])
    await Promise.all([
      writeFile(join(shimDirectory, 'claude.cmd'), '@echo off\r\nexit /b 1\r\n'),
      writeFile(join(shimDirectory, 'claude.ps1'), 'Write-Error "shim failed"\r\n'),
      writeFile(join(planDirectory, 'pending.json'), 'plan-content-must-not-appear'),
    ])

    let attachmentBody: Buffer | string | undefined
    const attach = vi.fn(async (_name: string, options: { body: Buffer | string }) => {
      attachmentBody = options.body
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await reportWindowsShimFailure({ attach } as unknown as TestInfo, {
      command: {
        executable: 'cmd.exe',
        args: ['/d', '/s', '/c', 'claude diagnostic'],
        cwd: root,
      },
      exitCode: 1,
      launcherPath: join(root, 'launcher.mjs'),
      planDirectory,
      providerCommand: 'claude',
      shimDirectory,
      stderr: 'PowerShell failure\r\n',
      stdout: `provider output\r\n${'x'.repeat(9_000)}`,
    })

    const loggedText = consoleError.mock.calls.flat().join('\n')
    const attachedText = Buffer.isBuffer(attachmentBody)
      ? attachmentBody.toString('utf8')
      : String(attachmentBody)
    for (const text of [loggedText, attachedText]) {
      expect(text).toContain('command.executable="cmd.exe"')
      expect(text).toContain('exitCode=1')
      expect(text).toContain('normalizedStdout="provider output\\n')
      expect(text).toContain('<truncated ')
      expect(text.length).toBeLessThan(20_000)
      expect(text).toContain('normalizedStderr="PowerShell failure\\n"')
      expect(text).toContain('generatedCmdShim.content="@echo off\\r\\nexit /b 1\\r\\n"')
      expect(text).toContain(
        'generatedPowerShellShim.content="Write-Error \\"shim failed\\"\\r\\n"',
      )
      expect(text).toContain('pending.json')
      expect(text).not.toContain('plan-content-must-not-appear')
    }
  })
})
