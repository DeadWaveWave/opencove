import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

const workspaceId = 'workspace-menu-swatches'
const spaceId = 'space-menu-swatches'
const agentId = 'agent-menu-swatches'

test.describe('Primary Sidebar Context Menu - label colours', () => {
  test('rings the chosen colour in its own colour, with no tick or pressed outline', async () => {
    const { electronApp, window } = await launchApp()

    try {
      for (const uiTheme of ['dark', 'light'] as const) {
        await seedWorkspaceState(window, {
          activeWorkspaceId: workspaceId,
          workspaces: [
            {
              id: workspaceId,
              name: 'Swatches',
              path: testWorkspacePath,
              nodes: [
                createRailAgent(
                  agentId,
                  'Swatch agent',
                  0,
                  'Pick a colour',
                  '2026-07-11T10:00:00Z',
                ),
              ],
              spaces: [
                {
                  id: spaceId,
                  name: 'Swatch space',
                  directoryPath: testWorkspacePath,
                  labelColor: 'blue',
                  nodeIds: [agentId],
                },
              ],
              activeSpaceId: spaceId,
            },
          ],
          settings: { uiTheme },
        })
        await expect
          .poll(() => window.evaluate(() => document.documentElement.dataset.coveTheme ?? null))
          .toBe(uiTheme)

        await window
          .getByTestId(`workspace-space-item-${workspaceId}-${spaceId}`)
          .click({ button: 'right' })
        const menu = window.locator('.workspace-project-context-menu')
        await expect(menu).toBeVisible()
        await window.mouse.move(900, 500)

        const swatches = menu.locator('.workspace-project-context-menu__color-button')
        expect(await swatches.count()).toBeGreaterThan(2)
        const looks = await swatches.evaluateAll(buttons =>
          buttons.map(button => {
            const dot = button.querySelector<HTMLElement>('.workspace-label-color-menu__dot')!
            const buttonStyle = getComputedStyle(button)
            const dotStyle = getComputedStyle(dot)
            return {
              id: button.getAttribute('data-testid')!.split('-').pop(),
              pressed: button.getAttribute('aria-pressed') === 'true',
              tick: button.querySelector('svg') !== null,
              round: buttonStyle.borderTopLeftRadius === '999px',
              buttonOutline: buttonStyle.outlineStyle,
              tile: buttonStyle.backgroundColor,
              ring: dotStyle.outlineStyle,
              ringColor: dotStyle.outlineColor,
              dotColor: dotStyle.backgroundColor,
            }
          }),
        )

        const chosen = looks.filter(look => look.pressed)
        expect(
          chosen.map(look => look.id),
          uiTheme,
        ).toEqual(['blue'])
        const [blue] = chosen
        expect(blue, uiTheme).toMatchObject({ tick: false, buttonOutline: 'none', ring: 'solid' })
        expect(blue!.ringColor, uiTheme).toBe(blue!.dotColor)
        for (const look of looks) {
          expect(look.round, `${uiTheme} ${look.id}`).toBe(true)
          expect(look.tick, `${uiTheme} ${look.id}`).toBe(false)
          // Only the ring marks the choice: the chosen swatch sits on the same ground as the rest.
          expect(look.tile, `${uiTheme} ${look.id}`).toBe(looks[0]!.tile)
          if (!look.pressed) {
            expect(look.ring, `${uiTheme} ${look.id}`).toBe('none')
          }
        }

        // The name field heads the menu at a row's height and focus only firms its edge.
        const field = menu.locator('.workspace-project-context-menu__space-editor input')
        await field.focus()
        const fieldLook = await field.evaluate(element => {
          const row = element
            .closest('.workspace-project-context-menu')!
            .querySelector('.cove-menu-item')!
            .getBoundingClientRect()
          return {
            glow: getComputedStyle(element).boxShadow,
            height: element.getBoundingClientRect().height,
            row: row.height,
          }
        })
        expect(fieldLook.glow, uiTheme).toBe('none')
        expect(Math.abs(fieldLook.height - fieldLook.row), uiTheme).toBeLessThanOrEqual(1)

        await window.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)

        // An agent following its Space has no colour of its own: the dashed "auto" dot is ringed
        // in muted ink.
        await window
          .getByTestId(`workspace-agent-item-${workspaceId}-${agentId}`)
          .click({ button: 'right' })
        await expect(menu).toBeVisible()
        const auto = menu.getByTestId('workspace-project-context-menu-label-color-auto')
        await expect(auto).toHaveAttribute('aria-pressed', 'true')
        const autoRing = await auto.locator('.workspace-label-color-menu__dot').evaluate(dot => {
          const probe = document.createElement('span')
          probe.style.color = 'var(--cove-text-muted)'
          dot.closest('.workspace-project-context-menu')!.append(probe)
          const muted = getComputedStyle(probe).color
          probe.remove()
          const style = getComputedStyle(dot)
          return { ring: style.outlineStyle, color: style.outlineColor === muted }
        })
        expect(autoRing, uiTheme).toEqual({ ring: 'solid', color: true })
        await window.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
    } finally {
      await electronApp.close()
    }
  })
})
