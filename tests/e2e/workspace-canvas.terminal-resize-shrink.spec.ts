import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readLocatorClientRect,
} from './workspace-canvas.helpers'

type TerminalGeometry = { cols: number; rows: number }

type AuthoritativeGeometry = {
  renderer: TerminalGeometry
  worker: TerminalGeometry
  shell: TerminalGeometry
}

async function dragResizerBy(
  window: Page,
  resizer: Locator,
  delta: { x?: number; y?: number },
): Promise<void> {
  const rect = await readLocatorClientRect(resizer)
  const start = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
  const end = {
    x: start.x + (delta.x ?? 0),
    y: start.y + (delta.y ?? 0),
  }

  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  await window.mouse.move(end.x, end.y, { steps: 16 })
  await window.mouse.move(end.x, end.y)
  await window.mouse.up()
}

async function readRuntimeSessionId(window: Page, nodeId: string): Promise<string | null> {
  return await window.evaluate(id => {
    return window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null
  }, nodeId)
}

async function assertAuthoritativeTerminalGeometry(options: {
  window: Page
  nodeId: string
  sessionId: string
  expected: TerminalGeometry
  phase: string
}): Promise<AuthoritativeGeometry> {
  const marker = `OCSZ_${options.phase}_${Date.now().toString(36)}`
  const command = buildNodeEvalCommand(
    [
      "const {execFileSync}=require('node:child_process');",
      "const [rows,cols]=execFileSync('stty',['size'],{encoding:'utf8',stdio:['inherit','pipe','pipe']}).trim().split(/\\s+/);",
      `process.stdout.write(${JSON.stringify(marker)}+':'+rows+'x'+cols+'\\n');`,
    ].join(''),
  )
  const baselineAppliedSeq = await options.window.evaluate(
    async payload => {
      const baseline = await window.opencoveApi.pty.presentationSnapshot({
        sessionId: payload.sessionId,
      })
      await window.opencoveApi.pty.write({
        sessionId: payload.sessionId,
        data: `${payload.command}\r`,
      })
      return baseline.appliedSeq
    },
    { sessionId: options.sessionId, command },
  )

  let observed: AuthoritativeGeometry | null = null
  await expect
    .poll(
      async () => {
        observed = await options.window.evaluate(
          async payload => {
            const renderer =
              window.__opencoveTerminalSelectionTestApi?.getSize(payload.nodeId) ?? null
            const worker = await window.opencoveApi.pty
              .presentationSnapshot({ sessionId: payload.sessionId })
              .catch(() => null)
            if (!renderer || !worker || worker.appliedSeq <= payload.baselineAppliedSeq) {
              return null
            }
            const markerMatch = worker.serializedScreen.match(
              new RegExp(`${payload.marker}:(\\d+)x(\\d+)`),
            )
            const shellRows = Number(markerMatch?.[1])
            const shellCols = Number(markerMatch?.[2])
            if (!markerMatch || !Number.isFinite(shellRows) || !Number.isFinite(shellCols)) {
              return null
            }
            return {
              renderer,
              worker: { cols: worker.cols, rows: worker.rows },
              shell: { cols: shellCols, rows: shellRows },
            }
          },
          {
            nodeId: options.nodeId,
            sessionId: options.sessionId,
            marker,
            baselineAppliedSeq,
          },
        )
        return observed
      },
      { timeout: 15_000, intervals: [20, 50, 100, 250] },
    )
    .toEqual({
      renderer: options.expected,
      worker: options.expected,
      shell: options.expected,
    })

  if (!observed) {
    throw new Error(`Missing authoritative terminal geometry for ${options.phase}`)
  }
  return observed
}

async function readPersistedNodeFrame(
  window: Page,
  nodeId: string,
): Promise<{ width: number; height: number } | null> {
  return await window.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        workspaces?: Array<{
          nodes?: Array<{
            id?: string
            width?: number
            height?: number
          }>
        }>
      }
      const node = parsed.workspaces?.[0]?.nodes?.find(item => item.id === id)
      if (typeof node?.width !== 'number' || typeof node.height !== 'number') {
        return null
      }

      return {
        width: node.width,
        height: node.height,
      }
    } catch {
      return null
    }
  }, nodeId)
}

async function shrinkRowsUntilLessThan(
  window: Page,
  resizer: Locator,
  readRows: () => Promise<number>,
  targetRows: number,
  readNodeHeight: () => Promise<number>,
  offsets: number[],
): Promise<{ rows: number; nodeHeight: number }> {
  const tryOffset = async (index: number): Promise<{ rows: number; nodeHeight: number }> => {
    if (index >= offsets.length) {
      return {
        rows: await readRows(),
        nodeHeight: await readNodeHeight(),
      }
    }

    await dragResizerBy(window, resizer, { y: offsets[index] })

    try {
      await expect
        .poll(
          async () => {
            return (await readRows()) < targetRows
          },
          { timeout: 3_000 },
        )
        .toBe(true)
      return {
        rows: await readRows(),
        nodeHeight: await readNodeHeight(),
      }
    } catch {
      return await tryOffset(index + 1)
    }
  }

  return await tryOffset(0)
}

test.describe('Workspace Canvas - Terminal resize shrink', () => {
  test.skip(process.platform === 'win32', 'Authoritative PTY geometry requires POSIX stty.')

  test('reflows terminal when resizing smaller after expanding', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const nodeId = 'terminal-resize-shrink'

      await clearAndSeedWorkspace(window, [
        {
          id: nodeId,
          title: nodeId,
          position: { x: 160, y: 140 },
          width: 680,
          height: 360,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      const readSize = async () => {
        return await window.evaluate(id => {
          return window.__opencoveTerminalSelectionTestApi?.getSize?.(id) ?? null
        }, nodeId)
      }
      const readNodeHeight = async () => (await readPersistedNodeFrame(window, nodeId))?.height ?? 0

      await expect.poll(readSize).toBeTruthy()
      const initialSize = (await readSize())!
      await expect
        .poll(() => readRuntimeSessionId(window, nodeId), { timeout: 15_000 })
        .toBeTruthy()
      const sessionId = await readRuntimeSessionId(window, nodeId)
      expect(sessionId).not.toBeNull()

      await electronApp.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0]
        if (!mainWindow) {
          throw new Error('Missing main window')
        }
        const [windowWidth, windowHeight] = mainWindow.getSize()
        mainWindow.setSize(windowWidth + 120, windowHeight + 80)
      })
      await expect.poll(readSize).toEqual(initialSize)

      const rightResizer = terminal.locator('[data-testid="terminal-resizer-right"]')
      await expect(rightResizer).toBeVisible()
      await dragResizerBy(window, rightResizer, { x: 240 })

      await expect.poll(async () => (await readSize())?.cols ?? 0).toBeGreaterThan(initialSize.cols)
      const expandedWidthSize = (await readSize())!

      await dragResizerBy(window, rightResizer, { x: -320 })

      await expect
        .poll(async () => (await readSize())?.cols ?? Number.POSITIVE_INFINITY)
        .toBeLessThan(expandedWidthSize.cols)

      const bottomResizer = terminal.locator('[data-testid="terminal-resizer-bottom"]')
      await expect(bottomResizer).toBeVisible()

      const beforeHeightSize = (await readSize())!
      const viewportHeight = await window.evaluate(() => window.innerHeight)
      const bottomResizerRect = await readLocatorClientRect(bottomResizer)
      const maxVisibleExpandDelta = Math.floor(viewportHeight - bottomResizerRect.y - 24)
      expect(
        maxVisibleExpandDelta,
        `Expected terminal bottom resizer to have visible room before vertical expansion, but only ${maxVisibleExpandDelta}px remained`,
      ).toBeGreaterThan(48)
      await dragResizerBy(window, bottomResizer, { y: Math.min(160, maxVisibleExpandDelta) })

      await expect
        .poll(async () => (await readSize())?.rows ?? 0)
        .toBeGreaterThan(beforeHeightSize.rows)
      const expandedHeightSize = (await readSize())!
      const expandedNodeHeight = await readNodeHeight()
      const expandedAuthority = await assertAuthoritativeTerminalGeometry({
        window,
        nodeId,
        sessionId: sessionId!,
        expected: expandedHeightSize,
        phase: 'expanded',
      })

      const shrinkResult = await shrinkRowsUntilLessThan(
        window,
        bottomResizer,
        async () => (await readSize())?.rows ?? Number.POSITIVE_INFINITY,
        expandedHeightSize.rows,
        readNodeHeight,
        [-220, -320, -420],
      )

      expect(
        shrinkResult.nodeHeight,
        `Expected terminal node height to shrink after resizing smaller, but sampled height was ${shrinkResult.nodeHeight} and expanded height was ${expandedNodeHeight}`,
      ).toBeLessThan(expandedNodeHeight)
      expect(shrinkResult.rows).toBeLessThan(expandedHeightSize.rows)
      const shrunkSize = (await readSize())!
      const shrunkAuthority = await assertAuthoritativeTerminalGeometry({
        window,
        nodeId,
        sessionId: sessionId!,
        expected: shrunkSize,
        phase: 'shrunk',
      })
      expect(shrunkAuthority.renderer.rows).toBeLessThan(expandedAuthority.renderer.rows)
      expect(shrunkAuthority.worker.rows).toBeLessThan(expandedAuthority.worker.rows)
      expect(shrunkAuthority.shell.rows).toBeLessThan(expandedAuthority.shell.rows)
    } finally {
      await electronApp.close()
    }
  })
})
