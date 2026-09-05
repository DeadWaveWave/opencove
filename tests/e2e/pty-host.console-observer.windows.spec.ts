import { expect, test } from '@playwright/test'
import { spawn as spawnProcess } from 'node:child_process'
import path from 'node:path'
import { spawn } from 'node-pty'
import { WindowsConsoleGeometryObserver } from '../../src/platform/process/ptyHost/windowsConsoleObserver'
import { WindowsPtyResizeOwner } from '../../src/platform/process/ptyHost/windowsPtyResizeOwner'

test.describe('native Windows Console observer', () => {
  test.skip(process.platform !== 'win32', 'Windows native query capability')

  test('confirms two quiet consoles, preserves input, recovers the observer and cleans up', async () => {
    const children: ReturnType<typeof spawnProcess>[] = []
    const observer = new WindowsConsoleGeometryObserver(() => {
      const child = spawnProcess(
        process.execPath,
        [path.resolve('out/main/windowsConsoleObserver.js')],
        {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          windowsHide: true,
        },
      )
      children.push(child)
      return child
    })
    const signal = new AbortController().signal
    const sessions = Array.from({ length: 2 }, () => {
      const pty = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          'Write-Output READY; while ($null -ne ($line = [Console]::ReadLine())) { if ($line -eq "exit") { break }; Write-Output ("INPUT_" + $line) }',
        ],
        {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: process.cwd(),
          env: process.env,
        },
      )
      const owner = new WindowsPtyResizeOwner(pty, observer)
      const session = { pty, owner, output: '', exited: false }
      pty.onData(data => {
        owner.markReady()
        session.output += data
      })
      pty.onExit(() => {
        session.exited = true
        owner.dispose()
      })
      return session
    })
    try {
      await Promise.all(
        sessions.map(session => expect.poll(() => session.output.includes('READY')).toBe(true)),
      )
      for (const [cols, rows] of [
        [120, 40],
        [60, 18],
        [93, 24],
        [93, 24],
      ]) {
        // Each stage resizes the same consoles after the preceding stage was confirmed.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(
          sessions.map(async (session, index) => {
            const size = { cols: cols + index, rows: rows + index }
            await expect(session.owner.resize(size.cols, size.rows)).resolves.toEqual({
              status: 'applied_verified',
              ...size,
            })
            await expect(observer.read(session.pty.pid, signal)).resolves.toEqual(size)
          }),
        )
      }
      expect(children).toHaveLength(1)
      const firstChildExited = new Promise(resolve => children[0].once('exit', resolve))
      children[0].kill()
      await firstChildExited
      await expect(sessions[0].owner.resize(81, 23)).resolves.toMatchObject({ cols: 81, rows: 23 })
      expect(children).toHaveLength(2)
      // Resizing may redraw; wait until the readback and its output have both reached this process.
      await expect.poll(() => sessions[0].output.length).toBeGreaterThan(0)
      const outputBeforeQueries = sessions.map(session => session.output)
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => observer.read(sessions[i % 2].pty.pid, signal)),
      )
      expect(sessions.map(session => session.output)).toEqual(outputBeforeQueries)
      sessions[0].pty.write('still-usable\r')
      await expect.poll(() => sessions[0].output.includes('INPUT_still-usable')).toBe(true)
      for (const session of sessions) {
        session.pty.write('exit\r')
      }
      await expect.poll(() => sessions.every(session => session.exited)).toBe(true)
      await expect(observer.read(sessions[0].pty.pid, signal)).rejects.toThrow()
      await expect(sessions[0].owner.resize(80, 24)).rejects.toThrow(/closed/)
    } finally {
      for (const session of sessions) {
        session.owner.dispose()
        if (!session.exited) {
          session.pty.kill()
        }
      }
      observer.dispose()
      await expect
        .poll(() => children.every(child => child.exitCode !== null || child.signalCode !== null))
        .toBe(true)
    }
  })
})
