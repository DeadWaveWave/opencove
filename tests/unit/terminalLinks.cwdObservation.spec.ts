import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installTerminalCwdObservation,
  resetTerminalCwdObservation,
  suspendTerminalCwdObservation,
} from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/terminalCwdObservation'
import { hydrateTerminalFromSnapshot } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'

const terminals: Terminal[] = []
function createTerminal() {
  const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 4, scrollback: 20 })
  terminals.push(terminal)
  return terminal
}
const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const osc7 = (path: string) => `\u001b]7;${path}\u0007`
afterEach(() => {
  terminals.splice(0).forEach(terminal => terminal.dispose())
})

describe('terminal output CWD observation', () => {
  it.each(['endpoint', 'mount', 'session'] as const)(
    'discards cwd when the source %s changes on a reused terminal with the same hostname',
    async changed => {
      const terminal = createTerminal()
      const source = { endpoint: 'endpoint-a', mount: 'mount-a', session: 'session-a' }
      const observation = installTerminalCwdObservation(terminal, () => ({
        platform: 'posix',
        hostname: 'worker',
        sourceKey: JSON.stringify(source),
      }))
      await write(terminal, `${osc7('file://worker/old-source')}old.ts`)
      expect(observation.getContextAt(1)).toMatchObject({ cwd: '/old-source' })
      source[changed] = `${changed}-b`
      expect(observation.getContextAt(1)).toBeUndefined()
      expect(terminal.markers).toHaveLength(0)
      await write(terminal, `\r\n${osc7('file://worker/new-source')}new.ts`)
      expect(observation.getContextAt(1)).toBeUndefined()
      expect(observation.getContextAt(2)).toMatchObject({ cwd: '/new-source' })
    },
  )

  it('waits for source hostname discovery and invalidates observations when source identity changes', async () => {
    const terminal = createTerminal()
    let hostname: string | undefined
    const observation = installTerminalCwdObservation(terminal, () => ({ hostname }))
    await write(terminal, `${osc7('file://worker/repo')}a.ts`)
    expect(observation.getContextAt(1)).toBeUndefined()
    hostname = 'worker'
    await write(terminal, `\r\n${osc7('file://worker/repo')}b.ts`)
    expect(observation.getContextAt(2)).toMatchObject({ cwd: '/repo' })
    hostname = 'other-worker'
    expect(observation.getContextAt(2)).toBeUndefined()
  })

  it('handles Windows source drive paths without using the viewer platform', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal, {
      platform: 'windows',
      hostname: 'worker',
    })
    await write(terminal, `${osc7('file://worker/C:/repo/a%20b')}file.ts`)
    expect(observation.getContextAt(1)).toEqual({ cwd: 'C:/repo/a b', cwdSource: 'observed' })
  })

  it('bounds retained cwd transitions independently of scrollback', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal)
    await write(
      terminal,
      Array.from({ length: 140 }, (_, index) => osc7(`file:///repo/${index}`)).join(''),
    )
    expect(terminal.markers).toHaveLength(128)
    expect(observation.getContextAt(1)).toMatchObject({ cwd: '/repo/139' })
    observation.dispose()
    expect(terminal.markers).toHaveLength(0)
  })

  it('keeps hydrated transcript cwd unknown until a new live observation', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal)
    await hydrateTerminalFromSnapshot({
      attachPromise: Promise.resolve(undefined),
      sessionId: 'session',
      terminal,
      kind: 'terminal',
      cachedScreenState: null,
      persistedSnapshot: `${osc7('file:///old-runtime')}old.ts`,
      useLivePtySnapshotDuringHydration: false,
      takePtySnapshot: async () => ({ data: '' }),
      isDisposed: () => false,
      onHydratedWriteCommitted() {},
      finalizeHydration() {},
    })
    expect(observation.getContextAt(1)).toBeUndefined()
    await write(terminal, `\r\n${osc7('file:///new-runtime')}new.ts`)
    expect(observation.getContextAt(2)).toMatchObject({ cwd: '/new-runtime' })
  })

  it('never promotes historical OSC 7 replay into a current observed cwd', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal)
    const suspended = suspendTerminalCwdObservation(terminal)
    await write(terminal, `${osc7('file:///old-runtime')}a.ts\r\n`)
    expect(observation.getContextAt(1)).toBeUndefined()
    suspended.dispose()
    suspended.dispose()
    expect(observation.getContextAt(1)).toBeUndefined()
    await write(terminal, `${osc7('file:///live-runtime')}b.ts`)
    expect(observation.getContextAt(2)).toMatchObject({ cwd: '/live-runtime' })
    resetTerminalCwdObservation(terminal)
    expect(observation.getContextAt(2)).toBeUndefined()
  })

  it('resolves the directory associated with each output row rather than the latest cwd', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal, { platform: 'posix' })
    await write(
      terminal,
      `old output\r\n${osc7('file:///repo/one')}a.ts\r\n${osc7('file:///repo/two')}b.ts`,
    )
    expect(observation.getContextAt(1)).toBeUndefined()
    expect(observation.getContextAt(2)).toEqual({ cwd: '/repo/one', cwdSource: 'observed' })
    expect(observation.getContextAt(3)).toEqual({ cwd: '/repo/two', cwdSource: 'observed' })
    observation.dispose()
  })

  it('does not assign a mid-row CWD change to links earlier on that row', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal)
    await write(
      terminal,
      `${osc7('file:///repo/one')}old.ts${osc7('file:///repo/two')}new.ts\r\nnext.ts`,
    )
    expect(observation.getContextAt(1)).toBeUndefined()
    expect(observation.getContextAt(2)).toEqual({ cwd: '/repo/two', cwdSource: 'observed' })
  })

  it('accepts only source-local file URI authorities', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal, { hostname: 'source-worker' })
    await write(terminal, `${osc7('file://source-worker/repo/a%20b')}a.ts`)
    expect(observation.getContextAt(1)).toEqual({ cwd: '/repo/a b', cwdSource: 'observed' })
    await write(terminal, `\r\n${osc7('file://foreign-worker/other')}a.ts`)
    expect(observation.getContextAt(2)).toBeUndefined()
    await write(terminal, `\r\n${osc7('file://localhost/repo/local')}a.ts`)
    expect(observation.getContextAt(3)).toEqual({ cwd: '/repo/local', cwdSource: 'observed' })
  })

  it.each(['\u001bc', '\u001b[2J', '\u001b[!p'])(
    'forgets observations when the terminal stream is reset by %j',
    async resetSequence => {
      const terminal = createTerminal()
      const observation = installTerminalCwdObservation(terminal)
      await write(terminal, `${osc7('file:///repo')}a.ts`)
      await write(terminal, resetSequence)
      expect(observation.getContextAt(1)).toBeUndefined()
    },
  )

  it('invalidates reflow, alternate-buffer transitions and explicit snapshot resets', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal)
    await write(terminal, `${osc7('file:///repo')}a.ts`)
    terminal.resize(30, 4)
    expect(observation.getContextAt(1)).toBeUndefined()
    await write(terminal, `\r${osc7('file:///repo')}a.ts\u001b[?1049h${osc7('file:///wrong')}x`)
    expect(observation.getContextAt(1)).toBeUndefined()
    await write(terminal, '\u001b[?1049l')
    expect(observation.getContextAt(1)).toBeUndefined()
    await write(terminal, `\r${osc7('file:///repo')}a.ts`)
    observation.reset()
    expect(observation.getContextAt(1)).toBeUndefined()
    expect(terminal.markers).toHaveLength(0)
  })

  it('tracks marker movement under scrollback trimming and owns cleanup', async () => {
    const terminal = createTerminal()
    const observation = installTerminalCwdObservation(terminal)
    await write(terminal, `${'line\r\n'.repeat(20)}${osc7('file:///repo')}a.ts\r\n`)
    expect(observation.getContextAt(21)).toMatchObject({ cwd: '/repo' })
    await write(terminal, 'line\r\n'.repeat(8))
    const markerRow = terminal.markers[0]?.line
    expect(markerRow).toBeLessThan(20)
    expect(observation.getContextAt((markerRow ?? 0) + 1)).toMatchObject({ cwd: '/repo' })
    observation.dispose()
    expect(terminal.markers).toHaveLength(0)
    await write(terminal, `${osc7('file:///ignored')}a.ts`)
    expect(observation.getContextAt(terminal.buffer.active.baseY + 1)).toBeUndefined()
  })
})
