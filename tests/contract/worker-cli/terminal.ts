import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { expect } from '@playwright/test'
import { terminalExitStatus } from '../../support/cliTerminalCommand'
import type { Binding, WorkerFixture } from './fixture'
export { jsonOutput } from '../../e2e/cli.terminal.helpers'

/** Real shell + production CLI shim: credentials come from the Worker's session grant. */
export async function terminalCommand(
  worker: WorkerFixture,
  binding: Binding,
  command: string,
  label: string,
): Promise<string> {
  const nonce = randomUUID().replaceAll('-', '')
  const begin = `${label}_BEGIN_${nonce}`
  const end = `${label}_END_${nonce}`
  const marker = (suffix: string) => `printf '\\n%s%s\\n' 'OC_CLI_' '${suffix}'`
  const input = [marker(begin), command, terminalExitStatus(process.platform), marker(end)].join(
    '; ',
  )
  const accepted = await worker.invoke<{ accepted: boolean }>('session.writeNode', {
    ...binding,
    data: input + '\r',
  })
  expect(accepted.accepted, `${label}: session.writeNode must accept the live binding`).toBe(true)
  let output = ''
  await expect
    .poll(
      async () => {
        output = stripVTControlCharacters(await worker.snapshot(binding.sessionId)).replaceAll(
          '\r',
          '',
        )
        const start = output.lastIndexOf(`OC_CLI_${begin}`)
        return start >= 0 && output.indexOf(`OC_CLI_${end}`, start) > start
      },
      {
        timeout: 20_000,
        intervals: [100, 250, 500],
        message: `${label}: real CLI must complete between shell-assembled markers`,
      },
    )
    .toBe(true)
  const start = output.lastIndexOf(`OC_CLI_${begin}`) + `OC_CLI_${begin}`.length
  return output.slice(start, output.indexOf(`OC_CLI_${end}`, start)).trim()
}
