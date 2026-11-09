import { expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'

// Construct markers in the shell: neither complete marker occurs in the echoed input.
function printMarker(suffix: string): string {
  return process.platform === 'win32'
    ? `Write-Output ('OC_CLI_' + '${suffix}')`
    : `printf '\n%s%s\n' 'OC_CLI_' '${suffix}'`
}

export async function terminalCommand(
  page: Page,
  binding: { nodeId: string; sessionId: string },
  command: string,
  label: string,
): Promise<string> {
  const nonce = randomUUID().replaceAll('-', '')
  const begin = `${label}_BEGIN_${nonce}`
  const end = `${label}_END_${nonce}`
  // Capture the CLI process status immediately, before printing the end marker.
  const status =
    process.platform === 'win32'
      ? 'Write-Output ("`nexit=" + $LASTEXITCODE)'
      : `printf '\\nexit=%s\\n' "$?"`
  const input = [printMarker(begin), command, status, printMarker(end)].join('; ')
  const accepted = await page.evaluate(
    async payload => {
      return await window.opencoveApi.controlSurface.invoke<{ accepted: boolean }>({
        kind: 'command',
        id: 'session.writeNode',
        payload: { ...payload.binding, data: payload.input + '\r' },
      })
    },
    { binding, input },
  )
  expect(accepted.accepted, `${label}: session.writeNode must accept the live binding`).toBe(true)

  let output = ''
  await expect
    .poll(
      async () => {
        const raw = await page.evaluate(async sessionId => {
          return (await window.opencoveApi.pty.snapshot({ sessionId })).data
        }, binding.sessionId)
        output = stripVTControlCharacters(raw).replaceAll('\r', '')
        const start = output.lastIndexOf(`OC_CLI_${begin}`)
        return start >= 0 && output.indexOf(`OC_CLI_${end}`, start) > start
      },
      {
        timeout: 20_000,
        intervals: [100, 250, 500],
        message: `${label}: CLI output must complete between shell-assembled markers (not command echo)`,
      },
    )
    .toBe(true)
  const start = output.lastIndexOf(`OC_CLI_${begin}`) + `OC_CLI_${begin}`.length
  return output.slice(start, output.indexOf(`OC_CLI_${end}`, start)).trim()
}

export function jsonOutput(output: string): Record<string, unknown> {
  expect(output, 'Read-only CLI command must exit successfully').toMatch(/\bexit=0\b/)
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  expect(start, `Expected CLI JSON in framed terminal output: ${output}`).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  // ConPTY may wrap a compact JSON value across physical console rows.
  return JSON.parse(output.slice(start, end + 1).replaceAll('\n', '')) as Record<string, unknown>
}
