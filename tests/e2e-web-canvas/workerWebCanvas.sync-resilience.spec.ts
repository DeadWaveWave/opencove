import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  buildAppState,
  createWorkspaceDir,
  fileUri,
  invokeValue,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
  writeTextFile,
} from './helpers'

async function clickHeaderDragSurfaceByTestId(
  page: import('@playwright/test').Page,
  testId: string,
): Promise<void> {
  await page.getByTestId(testId).first().click()
}

test.describe('Worker web canvas sync resilience', () => {
  test('does not rollback note edits when a sync update lands mid-typing', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('note-no-rollback-mid-typing')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 80, y: 80 },
            width: 240,
            height: 180,
            text: '',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const textarea = page.locator('[data-testid="note-node-textarea"]').first()
    await expect(textarea).toBeVisible()
    await textarea.click()

    const localDraft = `local-${randomUUID()}-${'x'.repeat(1200)}`

    const typing = page.keyboard.type(localDraft, { delay: 2 })
    await page.waitForTimeout(80)

    await invokeValue(page.request, 'command', 'note.create', {
      spaceId: 'space-1',
      text: 'external refresh note',
      x: 520,
      y: 180,
    })

    await typing

    await expect(textarea).toHaveValue(localDraft)

    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="note-node-textarea"]')
          .evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))
      })
      .toContain('external refresh note')
  })

  test('keeps node selection stable after a sync refresh', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('selection-stable-after-refresh')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 40, y: 40 },
            width: 240,
            height: 180,
            text: 'anchor',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 560, y: 420 } })
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    const terminalNode = page.locator('.terminal-node').first()
    await expect(terminalNode).toBeVisible()

    await clickHeaderDragSurfaceByTestId(page, 'terminal-node-header-drag-surface')
    await expect(page.locator('.workspace-canvas')).toHaveAttribute('data-selected-node-count', '1')

    await invokeValue(page.request, 'command', 'note.create', {
      spaceId: 'space-1',
      text: 'external refresh note',
      x: 520,
      y: 180,
    })

    await expect
      .poll(async () => {
        const count = await page
          .locator('.workspace-canvas')
          .getAttribute('data-selected-node-count')
        return count ?? ''
      })
      .toBe('1')
  })

  test('keeps hover cursor stable while applying frequent sync refreshes', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('cursor-stable')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 40, y: 40 },
            width: 240,
            height: 180,
            text: 'anchor',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 560, y: 420 } })
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    const terminalHeader = page.locator('.terminal-node__header').first()
    await expect(terminalHeader).toBeVisible()
    await page.waitForTimeout(260)
    const headerBox = await terminalHeader.boundingBox()
    expect(headerBox).toBeTruthy()

    const hoverX = headerBox!.x + headerBox!.width / 2
    const hoverY = headerBox!.y + headerBox!.height / 2
    await page.mouse.move(hoverX, hoverY)

    const refreshStorm = (async () => {
      const createNotes = async (index: number): Promise<void> => {
        if (index >= 18) {
          return
        }

        await invokeValue(page.request, 'command', 'note.create', {
          spaceId: 'space-1',
          text: `external-${index}`,
          x: 3200 + index * 80,
          y: 3200,
        })
        await page.waitForTimeout(45)
        await createNotes(index + 1)
      }

      await createNotes(0)
    })()

    const cursorSamples = await page.evaluate(
      async ({ x, y }) => {
        const samples: Array<{ cursor: string; headerTop: number }> = []
        const resolveSample = (): { cursor: string; headerTop: number } => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null
          const cursor = el ? window.getComputedStyle(el).cursor : 'none'
          const header = document.querySelector('.terminal-node__header') as HTMLElement | null
          const headerTop = header ? header.getBoundingClientRect().top : NaN
          return { cursor, headerTop }
        }

        const collectSamples = async (remaining: number): Promise<void> => {
          if (remaining <= 0) {
            return
          }

          samples.push(resolveSample())
          await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
          await collectSamples(remaining - 1)
        }

        await collectSamples(90)

        return samples
      },
      { x: hoverX, y: hoverY },
    )

    await refreshStorm

    const headerTops = cursorSamples
      .map(sample => sample.headerTop)
      .filter(value => Number.isFinite(value))
    const minTop = Math.min(...headerTops)
    const maxTop = Math.max(...headerTops)
    expect(maxTop - minTop).toBeLessThanOrEqual(0.5)

    const uniqueCursors = [...new Set(cursorSamples.map(sample => sample.cursor))]
    expect(uniqueCursors).toEqual(['grab'])
  })

  test('keeps hover targets stable during noop sync writes', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('hover-stable-during-noop-sync-write')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 60, y: 60 },
            width: 320,
            height: 220,
            text: 'anchor',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const textarea = page.locator('[data-testid="note-node-textarea"]').first()
    await expect(textarea).toBeVisible()
    const textareaBox = await textarea.boundingBox()
    expect(textareaBox).toBeTruthy()

    const hoverX = textareaBox!.x + textareaBox!.width / 2
    const hoverY = textareaBox!.y + textareaBox!.height / 2
    await page.mouse.move(hoverX, hoverY)

    const refreshStorm = (async () => {
      const writeNoopState = async (index: number): Promise<void> => {
        if (index >= 16) {
          return
        }

        const { revision, state } = await invokeValue<{ revision: number; state: unknown }>(
          page.request,
          'query',
          'sync.state',
          null,
        )

        await invokeValue<{ revision: number }>(page.request, 'command', 'sync.writeState', {
          state,
          baseRevision: revision,
        })
        await page.waitForTimeout(45)
        await writeNoopState(index + 1)
      }

      await writeNoopState(0)
    })()

    const samples = await page.evaluate(
      async ({ x, y }) => {
        const anchor = document.elementFromPoint(x, y) as HTMLElement | null
        const anchorCursor = anchor ? window.getComputedStyle(anchor).cursor : 'none'

        const frames: Array<{ cursor: string; sameElement: boolean }> = []
        const collectSamples = async (remaining: number): Promise<void> => {
          if (remaining <= 0) {
            return
          }

          const el = document.elementFromPoint(x, y) as HTMLElement | null
          frames.push({
            cursor: el ? window.getComputedStyle(el).cursor : 'none',
            sameElement: anchor ? el === anchor : el === null,
          })
          await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
          await collectSamples(remaining - 1)
        }

        await collectSamples(90)

        return {
          anchorCursor,
          frames,
        }
      },
      { x: hoverX, y: hoverY },
    )

    await refreshStorm

    expect([...new Set(samples.frames.map(sample => sample.cursor))]).toEqual([
      samples.anchorCursor,
    ])
    expect(samples.frames.some(sample => !sample.sameElement)).toBe(false)
  })

  test('keeps closed terminal nodes closed after a sync refresh', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('terminal-close-sync')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 40, y: 40 },
            width: 240,
            height: 180,
            text: 'anchor note',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 600, y: 600 } })
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    const terminal = page.locator('.terminal-node').first()
    await expect(terminal).toBeVisible()
    await expect(terminal.locator('.xterm')).toBeVisible()

    await terminal.locator('.terminal-node__close').click()
    await expect(page.locator('.terminal-node')).toHaveCount(0)

    await invokeValue(page.request, 'command', 'note.create', {
      spaceId: 'space-1',
      text: 'external note after close',
      x: 520,
      y: 180,
    })

    await expect(page.locator('.terminal-node')).toHaveCount(0)

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        const nodes = shared.state?.workspaces[0]?.nodes ?? []
        return nodes.some(node => node.kind === 'terminal')
      })
      .toBe(false)
  })

  test('keeps closed document nodes closed after a sync refresh', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('document-close-refresh')
    const documentPath = `${workspacePath}/readme.md`
    await writeTextFile(documentPath, '# doc\n')

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1', 'doc-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 40, y: 40 },
            width: 240,
            height: 180,
            text: 'anchor',
          },
          {
            id: 'doc-1',
            title: 'readme.md',
            kind: 'document',
            position: { x: 220, y: 160 },
            width: 420,
            height: 320,
            uri: fileUri(documentPath),
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const documentNode = page.locator('.document-node').first()
    await expect(documentNode).toBeVisible()
    await expect(documentNode.locator('[data-testid="document-node-textarea"]')).toBeVisible()

    await documentNode.locator('.document-node__close').click()
    await expect(page.locator('.document-node')).toHaveCount(0)

    await invokeValue(page.request, 'command', 'note.create', {
      spaceId: 'space-1',
      text: 'external note after doc close',
      x: 520,
      y: 180,
    })

    await expect(page.locator('.document-node')).toHaveCount(0)

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        const nodes = shared.state?.workspaces[0]?.nodes ?? []
        return nodes.some(node => node.kind === 'document')
      })
      .toBe(false)
  })
})
