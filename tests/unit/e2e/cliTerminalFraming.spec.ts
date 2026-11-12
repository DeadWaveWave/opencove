// @vitest-environment node
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { expect, it, vi } from 'vitest'
import { terminalCommand } from '../../e2e/cli.terminal.helpers'

it.skipIf(process.platform === 'win32').each([0, 11])(
  'frames output without a trailing newline and preserves exit %s',
  async exitCode => {
    let data = ''
    const page = {
      evaluate: vi.fn(async (_fn: unknown, payload: unknown) => {
        if (typeof payload === 'string') {
          return data
        }
        const { input } = payload as { input: string }
        // Execute the actual generated POSIX frame; model only the PTY boundary, not its formatting.
        data = execFileSync('/bin/sh', ['-c', input], { encoding: 'utf8' })
        return { accepted: true }
      }),
    } as unknown as Page
    const output = await terminalCommand(
      page,
      { nodeId: 'n', sessionId: 's' },
      `printf null; (exit ${exitCode})`,
      'BARE',
    )
    expect(output).toContain('null\n')
    expect(output).toMatch(/\bexit=\d+\b/)
    expect(output).toContain(`exit=${exitCode}`)
  },
)
