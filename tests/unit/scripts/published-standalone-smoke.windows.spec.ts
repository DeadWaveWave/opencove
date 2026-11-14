import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePublishedCommandInvocation } from '../../../scripts/lib/published-standalone-smoke.mjs'

describe('published standalone release smoke contract (Windows)', () => {
  it.runIf(process.platform === 'win32')(
    'executes an installed launcher in a Windows path containing spaces',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'opencove launcher '))
      try {
        const launcher = path.join(root, 'opencove.cmd')
        await writeFile(
          launcher,
          [
            '@echo off',
            'if not "%~1"=="worker" exit /b 21',
            'if not "%~2"=="start" exit /b 22',
            'if not "%~3"=="--help" exit /b 23',
            'echo launcher-ok',
          ].join('\r\n'),
          'utf8',
        )
        const invocation = resolvePublishedCommandInvocation({
          platform: process.platform,
          command: launcher,
          args: ['worker', 'start', '--help'],
          comspec: process.env['ComSpec'],
        })
        const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(invocation.command, invocation.args, {
              windowsHide: true,
              windowsVerbatimArguments: invocation.windowsVerbatimArguments,
            })
            let stdout = ''
            let stderr = ''
            child.stdout.on('data', chunk => (stdout += String(chunk)))
            child.stderr.on('data', chunk => (stderr += String(chunk)))
            child.once('error', reject)
            child.once('exit', code => resolve({ code, stdout, stderr }))
          },
        )
        expect(result).toMatchObject({ code: 0, stderr: '' })
        expect(result.stdout).toContain('launcher-ok')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
