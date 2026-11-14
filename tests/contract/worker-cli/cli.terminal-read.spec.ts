import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand } from '../../e2e/workspace-canvas.helpers'
import { jsonOutput, terminalCommand } from './terminal'
import { createOutputTerminal, withOutputWorkspace } from './cli.output.helpers'

function lines(value: Record<string, unknown>): string[] {
  expect(Array.isArray(value.lines)).toBe(true)
  return value.lines as string[]
}

test('plain terminal reads distinguish visible rows from retained history and honor line limits', async () => {
  await withOutputWorkspace([], async (worker, shell) => {
    const output = await createOutputTerminal(worker)
    // Keep the test-owned writer alive and silent after its last line, so shell
    // prompt rendering cannot race later comparisons of this terminal's tail.
    const accepted = await worker.invoke<{ accepted: boolean }>('session.writeNode', {
      ...output,
      data:
        buildNodeEvalCommand(
          'for(let i=0;i<250;i++) console.log("\\x1b[31mHISTORY_"+String(i).padStart(3,"0")+"\\x1b[0m"); process.stdin.resume()',
        ) + '\r',
    })
    expect(accepted.accepted).toBe(true)
    await expect
      .poll(async () => {
        return (await worker.snapshot(output.sessionId)).includes('HISTORY_249')
      })
      .toBe(true)
    const read = async (flags: string, label: string) =>
      jsonOutput(
        await terminalCommand(
          worker,
          shell,
          `opencove agent read --node ${output.nodeId} ${flags} -o json`,
          label,
        ),
      )
    // Reads run in a different terminal so that they cannot overwrite the target screen.
    const screen = lines(await read('--screen --lines 5000', 'SCREEN'))
    expect(screen).not.toContain('HISTORY_000')
    expect(screen).toContain('HISTORY_249')
    const history = lines(await read('--scrollback --lines 5000', 'HISTORY'))
    expect(history).toContain('HISTORY_000')
    expect(history).toContain('HISTORY_249')
    expect(history.join('\n')).not.toContain('\x1b')
    expect(lines(await read('--scrollback', 'DEFAULT_HISTORY'))).toEqual(history.slice(-200))
    expect(lines(await read('--scrollback --lines 8', 'HISTORY_TAIL'))).toEqual(history.slice(-8))
    expect(lines(await read('--screen --lines 3', 'SCREEN_TAIL'))).toEqual(screen.slice(-3))
    const plain = await terminalCommand(
      worker,
      shell,
      `opencove agent read --node ${output.nodeId} --scrollback --lines 8`,
      'HISTORY_TEXT',
    )
    expect(plain).toContain('exit=0')
    expect(plain).toContain(history.slice(-8).join('\n'))
  })
})

test('agent session snapshots retain scrollback and return bounded ANSI-free text', async () => {
  await withOutputWorkspace([], async (worker, shell) => {
    const agent = await createOutputTerminal(worker, 'agent')
    // The existing stdin-echo provider fixture owns this PTY. Its cooked terminal echoes
    // the submitted lines; no real provider or user profile is used.
    // A single large write can overflow the terminal input queue and drop echoed lines, so
    // write in small batches and wait for each batch's echo before sending the next.
    const snapshotText = () => worker.snapshot(agent.sessionId)
    /* eslint-disable no-await-in-loop -- each batch must be echoed before the next is written. */
    for (let first = 0; first < 140; first += 10) {
      const batch = Array.from(
        { length: 10 },
        (_, i) => `AGENT_HISTORY_${String(first + i).padStart(3, '0')}`,
      )
      const accepted = await worker.invoke<{ accepted: boolean }>('session.writeNode', {
        ...agent,
        data: batch.map(line => `${line}\r`).join(''),
      })
      expect(accepted.accepted).toBe(true)
      await expect.poll(async () => (await snapshotText()).includes(batch.at(-1)!)).toBe(true)
    }
    /* eslint-enable no-await-in-loop */
    const command = (flags: string, label: string) =>
      terminalCommand(
        worker,
        shell,
        `opencove agent read --node ${agent.nodeId} ${flags} -o json`,
        label,
      )
    const history = lines(jsonOutput(await command('--scrollback --lines 5000', 'AGENT_HISTORY')))
    expect(history).toContain('AGENT_HISTORY_000')
    expect(history).toContain('AGENT_HISTORY_139')
    expect(history.join('\n')).not.toContain('\x1b')
    const screen = lines(jsonOutput(await command('--screen --lines 5000', 'AGENT_SCREEN')))
    expect(screen).not.toContain('AGENT_HISTORY_000')
    const tail = lines(jsonOutput(await command('--scrollback --lines 8', 'AGENT_TAIL')))
    expect(tail.length).toBeLessThanOrEqual(8)
    expect(tail.length).toBeGreaterThan(0)
  })
})
