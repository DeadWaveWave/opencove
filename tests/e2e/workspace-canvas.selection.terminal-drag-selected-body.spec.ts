import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, storageKey } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Selection (Terminal Drag)', () => {
  test('drags a selected terminal from its body after header selection', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mouse-selected-body-drag-node',
            title: 'terminal-mouse-selected-body-drag',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
        },
      )

      const terminal = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-mouse-selected-body-drag' })
        .first()
      const header = terminal.locator('.terminal-node__header')
      const terminalBody = terminal.locator('.terminal-node__terminal')
      await expect(header).toBeVisible()
      await expect(terminalBody).toBeVisible()

      await header.click({ position: { x: 40, y: 20 } })
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
      await expect(window.locator('.react-flow__nodesselection-rect')).toHaveCount(1)

      const borderBefore = await terminal.evaluate(
        element => window.getComputedStyle(element).borderColor,
      )
      const shadowBefore = await terminal.evaluate(
        element => window.getComputedStyle(element).boxShadow,
      )
      const membraneBefore = await terminal.evaluate(element => {
        const after = window.getComputedStyle(element, '::after')
        return {
          content: after.content,
          cursor: after.cursor,
        }
      })
      if (!membraneBefore.content || membraneBefore.content === 'none') {
        throw new Error(
          `expected membrane ::after before drag, got content=${membraneBefore.content}`,
        )
      }

      const startDragSurfaceSampler = async (): Promise<void> => {
        await window.evaluate(
          ({ title, expectedBorder, expectedShadow }) => {
            const terminalNodes = Array.from(document.querySelectorAll('.terminal-node'))
            const terminalNode =
              terminalNodes.find(node => node.textContent?.includes(title)) ?? null
            if (!terminalNode) {
              throw new Error(`[e2e] terminal node not found for sampler: ${title}`)
            }

            const wrapper = terminalNode.closest('.react-flow__node') as HTMLElement | null
            const samples: Array<{
              timestamp: number
              wrapperSelected: boolean
              wrapperDragging: boolean
              terminalSelectedSurface: boolean
              selectionRectCount: number
              borderColor: string
              boxShadow: string
              membraneContent: string
            }> = []

            const sampler = {
              running: true,
              stop: () => {
                sampler.running = false
              },
              samples,
              expectedBorder,
              expectedShadow,
            }

            ;(window as unknown as Record<string, unknown>)['__coveSelectedDragSurfaceSampler'] =
              sampler

            const tick = () => {
              if (!sampler.running) {
                return
              }

              const computed = window.getComputedStyle(terminalNode)
              const after = window.getComputedStyle(terminalNode, '::after')
              const selectionRectCount = document.querySelectorAll(
                '.react-flow__nodesselection-rect',
              ).length

              samples.push({
                timestamp: window.performance.now(),
                wrapperSelected: wrapper?.classList.contains('selected') ?? false,
                wrapperDragging: wrapper?.classList.contains('dragging') ?? false,
                terminalSelectedSurface: (terminalNode as HTMLElement).classList.contains(
                  'terminal-node--selected-surface',
                ),
                selectionRectCount,
                borderColor: computed.borderColor,
                boxShadow: computed.boxShadow,
                membraneContent: after.content,
              })

              window.requestAnimationFrame(tick)
            }

            window.requestAnimationFrame(tick)
          },
          {
            title: 'terminal-mouse-selected-body-drag',
            expectedBorder: borderBefore,
            expectedShadow: shadowBefore,
          },
        )
      }

      const stopDragSurfaceSampler = async (): Promise<
        Array<{
          timestamp: number
          wrapperSelected: boolean
          wrapperDragging: boolean
          terminalSelectedSurface: boolean
          selectionRectCount: number
          borderColor: string
          boxShadow: string
          membraneContent: string
        }>
      > => {
        return await window.evaluate(() => {
          const sampler = (window as unknown as Record<string, unknown>)[
            '__coveSelectedDragSurfaceSampler'
          ] as
            | {
                stop: () => void
                samples: Array<{
                  timestamp: number
                  wrapperSelected: boolean
                  wrapperDragging: boolean
                  terminalSelectedSurface: boolean
                  selectionRectCount: number
                  borderColor: string
                  boxShadow: string
                  membraneContent: string
                }>
              }
            | undefined

          if (!sampler) {
            return []
          }

          sampler.stop()
          const samples = sampler.samples
          delete (window as unknown as Record<string, unknown>)['__coveSelectedDragSurfaceSampler']
          return samples
        })
      }

      const readNodePosition = async (): Promise<{ x: number; y: number } | null> => {
        return await window.evaluate(async key => {
          void key

          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          if (!raw) {
            return null
          }

          const state = JSON.parse(raw) as {
            workspaces?: Array<{
              nodes?: Array<{
                id: string
                position?: { x?: number; y?: number }
              }>
            }>
          }

          const node = state.workspaces?.[0]?.nodes?.find(
            entry => entry.id === 'mouse-selected-body-drag-node',
          )

          if (
            !node?.position ||
            typeof node.position.x !== 'number' ||
            typeof node.position.y !== 'number'
          ) {
            return null
          }

          return {
            x: node.position.x,
            y: node.position.y,
          }
        }, storageKey)
      }

      const beforeDrag = await readNodePosition()
      if (!beforeDrag) {
        throw new Error('node position unavailable before selected body drag')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      const bodyBox = await terminalBody.boundingBox()
      if (!paneBox || !bodyBox) {
        throw new Error('pane/body bounding box unavailable for selected body drag')
      }

      const startX = bodyBox.x + bodyBox.width * 0.4
      const startY = bodyBox.y + bodyBox.height * 0.4
      const endX = Math.min(paneBox.x + paneBox.width - 60, startX + 260)
      const endY = Math.min(paneBox.y + paneBox.height - 60, startY + 220)

      await startDragSurfaceSampler()

      await window.mouse.move(startX, startY)
      await window.mouse.down()
      await window.waitForTimeout(48)
      const borderAfterDown = await terminal.evaluate(
        element => window.getComputedStyle(element).borderColor,
      )
      expect(borderAfterDown).toBe(borderBefore)
      const shadowAfterDown = await terminal.evaluate(
        element => window.getComputedStyle(element).boxShadow,
      )
      expect(shadowAfterDown).toBe(shadowBefore)
      const membraneAfterDown = await terminal.evaluate(
        element => window.getComputedStyle(element, '::after').content,
      )
      if (!membraneAfterDown || membraneAfterDown === 'none') {
        throw new Error(`expected membrane ::after after down, got content=${membraneAfterDown}`)
      }

      await window.mouse.move(endX, endY, { steps: 36 })
      await window.waitForTimeout(220)
      await expect(terminal).toHaveClass(/terminal-node--selected-surface/)
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      await window.mouse.up()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)

      const dragSurfaceSamples = await stopDragSurfaceSampler()
      const dragSurfaceViolations = dragSurfaceSamples.filter(sample => {
        if (sample.selectionRectCount !== 1) {
          return true
        }

        if (!sample.membraneContent || sample.membraneContent === 'none') {
          return true
        }

        if (sample.borderColor !== borderBefore) {
          return true
        }

        if (sample.boxShadow !== shadowBefore) {
          return true
        }

        return false
      })
      if (dragSurfaceViolations.length > 0) {
        throw new Error(
          `expected terminal selection membrane to remain visible during drag, violations=${JSON.stringify(dragSurfaceViolations.slice(0, 5))}`,
        )
      }

      const afterDrag = await readNodePosition()
      if (!afterDrag) {
        throw new Error('node position unavailable after selected body drag')
      }

      expect(afterDrag.x).toBeGreaterThan(beforeDrag.x + 120)
      expect(afterDrag.y).toBeGreaterThan(beforeDrag.y + 120)
    } finally {
      await electronApp.close()
    }
  })
})
