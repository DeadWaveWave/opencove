// @vitest-environment node
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import { afterEach, expect, it, vi } from 'vitest'
import { terminalCommand } from '../../e2e/cli.terminal.helpers'

// Reuse the real framing/bridge helper with Vitest's equivalent assertions, without Electron.
vi.mock('@playwright/test', async () => ({ expect: (await import('vitest')).expect }))
afterEach(() => vi.unstubAllGlobals())

it.each([0, 7])('frames unterminated output independently of exit status %s', async exitCode => {
  let output = ''
  const executable = `'${process.execPath.replaceAll("'", process.platform === 'win32' ? "''" : `'"'"'`)}'`
  const command = `${process.platform === 'win32' ? '& ' : ''}${executable} -e "process.stdout.write('null');process.exit(${exitCode})"`
  const write = vi.fn(async ({ payload }: { payload: { data: string } }) => {
    const script = payload.data.replace(/\r$/, '')
    output =
      process.platform === 'win32'
        ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8',
            timeout: 10000,
          })
        : execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 10000 })
    return { accepted: true }
  })
  vi.stubGlobal('window', {
    opencoveApi: {
      controlSurface: { invoke: write },
      pty: { snapshot: async () => ({ data: output }) },
    },
  })
  const page = {
    evaluate: async (fn: (input: unknown) => unknown, input: unknown) => fn(input),
  } as unknown as Page
  const framed = await terminalCommand(
    page,
    { nodeId: 'node', sessionId: 'session' },
    command,
    'NO_NEWLINE',
  )
  expect(framed).toBe(`null\nexit=${exitCode}`)
  expect(framed).toMatch(new RegExp(`\\bexit=${exitCode}\\b`))
  expect(write).toHaveBeenCalledOnce()
})
