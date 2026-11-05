import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTerminalBufferTextForTest } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { recoveredTerminalHasFreshOutput } from '../../e2e/terminal-binding-recovery.helpers'

const input = {
  nodeId: 'recovered-node',
  sessionId: 'recovered-session',
  marker: 'RECOVERED_fixture',
}
const output = `${input.marker}_INPUT_OK`
const command = `PS> Write-Output ('${input.marker}' + '_INPUT_OK')\r\n`

describe('recovered terminal fresh-output predicate', () => {
  let terminal: Terminal
  let presentation: TerminalPresentationSession
  const grid = { cols: 80, rows: 6 }
  let proposed: typeof grid

  beforeEach(() => {
    terminal = new Terminal({ allowProposedApi: true, ...grid })
    presentation = new TerminalPresentationSession({ sessionId: input.sessionId, ...grid })
    proposed = { ...grid }
    vi.stubGlobal('window', {
      __opencoveTerminalSelectionTestApi: {
        getBufferText: (_nodeId: string, marker: string) =>
          readTerminalBufferTextForTest(terminal, marker),
        getSize: () => ({ cols: terminal.cols, rows: terminal.rows }),
        getProposedGeometry: () => proposed,
      },
      opencoveApi: { pty: { presentationSnapshot: () => presentation.snapshot() } },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    terminal.dispose()
    presentation.dispose()
  })

  async function write(rendererOutput: string, workerOutput = rendererOutput) {
    await Promise.all([
      new Promise<void>(resolve => terminal.write(rendererOutput, resolve)),
      presentation.applyOutput(1, workerOutput),
    ])
  }

  it('accepts the shell-assembled output in both screens', async () => {
    await write(`${command}${output}\r\nPS> `)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(true)
  })

  it('accepts fresh output when a redraw leaves trailing ConPTY cells', async () => {
    await write(`${command}${' '.repeat(output.length)}Wr\r${output}\r\nPS> `)

    expect(readTerminalBufferTextForTest(terminal, output)?.viewportLines).toContain(`${output}Wr`)
    const snapshot = await presentation.snapshot()
    expect(snapshot.appliedSeq).toBe(1)
    expect(snapshot.serializedScreen).toContain(`${output}Wr`)
    expect(await recoveredTerminalHasFreshOutput(input)).toBe(true)
  })

  it('accepts the output token across a soft wrap with trailing stale cells', async () => {
    await write(`${command}${' '.repeat(grid.cols - 10)}${output}Wr\r\nPS> `)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(true)
  })

  it('does not accept the echoed PowerShell expression', async () => {
    await write(command)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it('does not accept an incomplete output token', async () => {
    await write(`${command}${output.slice(0, -1)}\r\n`)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it('does not accept output from an earlier input', async () => {
    await write('RECOVERED_previous_INPUT_OK\r\n')

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it('requires the worker snapshot to contain the fresh output', async () => {
    await write(`${command}${output}\r\n`, command)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it('requires the renderer to contain the fresh output', async () => {
    await write(command, `${command}${output}\r\n`)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it('does not accept an unavailable renderer buffer', async () => {
    await write(`${output}\r\n`)
    vi.spyOn(window.__opencoveTerminalSelectionTestApi!, 'getBufferText').mockReturnValue(null)

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it.each(['cols', 'rows'] as const)('rejects mismatched snapshot %s', async dimension => {
    await write(`${output}\r\n`)
    presentation.resize(
      grid.cols + Number(dimension === 'cols'),
      grid.rows + Number(dimension === 'rows'),
    )

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })

  it.each(['cols', 'rows'] as const)('rejects unsettled proposed %s', async dimension => {
    await write(`${output}\r\n`)
    proposed[dimension] += 1

    expect(await recoveredTerminalHasFreshOutput(input)).toBe(false)
  })
})
