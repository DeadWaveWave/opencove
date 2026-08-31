import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

type PersistedTerminalDisplayReference = {
  version: 1
  measurement: {
    fontSize: number
    lineHeight: number
    letterSpacing: number
    cols: number
    rows: number
    cssCellWidth: number
    cssCellHeight: number
    effectiveDpr: number
    measuredAt: string
  }
} | null

const workspaceId = 'workspace-terminal-display-reference'
const nodeId = 'node-terminal-display-reference'

async function seedZoomedWorkspace(
  window: Awaited<ReturnType<typeof launchApp>>['window'],
  initialCompensationEnabled = true,
) {
  const result = await window.evaluate(
    async ({ seededWorkspaceId, seededNodeId, workspacePath, compensationEnabled }) => {
      return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
        raw: JSON.stringify({
          formatVersion: 1,
          activeWorkspaceId: seededWorkspaceId,
          workspaces: [
            {
              id: seededWorkspaceId,
              name: 'terminal display reference',
              path: workspacePath,
              worktreesRoot: `${workspacePath}/.opencove/worktrees`,
              pullRequestBaseBranchOptions: [],
              environmentVariables: {},
              spaceArchiveRecords: [],
              viewport: { x: 0, y: 0, zoom: 1.5 },
              isMinimapVisible: true,
              spaces: [],
              activeSpaceId: null,
              nodes: [
                {
                  id: seededNodeId,
                  title: 'terminal display reference',
                  titlePinnedByUser: false,
                  position: { x: 160, y: 140 },
                  width: 560,
                  height: 340,
                  kind: 'terminal',
                  profileId: null,
                  runtimeKind: 'posix',
                  terminalProviderHint: null,
                  labelColorOverride: null,
                  status: null,
                  startedAt: null,
                  endedAt: null,
                  exitCode: null,
                  lastError: null,
                  scrollback: null,
                  executionDirectory: workspacePath,
                  expectedDirectory: workspacePath,
                  agent: null,
                  task: null,
                },
              ],
            },
          ],
          settings: {
            standardWindowSizeBucket: 'regular',
            terminalFontSize: 13,
            terminalFontFamily: null,
            terminalDisplayAutoReferenceEnabled: true,
            terminalDisplayCalibrationCompensationEnabled: compensationEnabled,
            terminalDisplayReference: null,
          },
        }),
      })
    },
    {
      seededWorkspaceId: workspaceId,
      seededNodeId: nodeId,
      workspacePath: testWorkspacePath,
      compensationEnabled: initialCompensationEnabled,
    },
  )

  if (!result.ok) {
    throw new Error(
      `Failed to seed zoomed workspace state: ${result.reason}: ${result.error.code}${
        result.error.debugMessage ? `: ${result.error.debugMessage}` : ''
      }`,
    )
  }
}

async function readPersistedTerminalDisplayReference(
  window: Awaited<ReturnType<typeof launchApp>>['window'],
): Promise<PersistedTerminalDisplayReference> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        settings?: {
          terminalDisplayReference?: PersistedTerminalDisplayReference
        }
      }
      return parsed.settings?.terminalDisplayReference ?? null
    } catch {
      return null
    }
  })
}

test.describe('Settings - Terminal Display Calibration', () => {
  test('automatic shared reference matches manual capture in a zoomed workspace', async () => {
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await seedZoomedWorkspace(window)
      await window.reload({ waitUntil: 'domcontentloaded' })

      const xterm = window.locator('.terminal-node .xterm').first()
      await expect(xterm).toBeVisible()

      let automaticReference: PersistedTerminalDisplayReference = null
      await expect
        .poll(
          async () => {
            automaticReference = await readPersistedTerminalDisplayReference(window)
            return automaticReference
          },
          { timeout: 15_000 },
        )
        .not.toBeNull()

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click({ noWaitAfter: true })

      const appearanceNav = window.locator('[data-testid="settings-section-nav-appearance"]')
      await expect(appearanceNav).toBeVisible()
      await appearanceNav.click()

      const setReferenceButton = window.locator(
        '[data-testid="settings-terminal-display-set-reference"]',
      )
      await expect(setReferenceButton).toBeVisible()
      await setReferenceButton.click()

      let manualReference: PersistedTerminalDisplayReference = null
      await expect
        .poll(
          async () => {
            manualReference = await readPersistedTerminalDisplayReference(window)
            return manualReference?.measurement.measuredAt ?? null
          },
          { timeout: 15_000 },
        )
        .not.toBe(automaticReference?.measurement.measuredAt ?? null)

      expect(automaticReference).not.toBeNull()
      expect(manualReference).not.toBeNull()
      expect(manualReference?.measurement.fontSize).toBe(automaticReference?.measurement.fontSize)
      expect(manualReference?.measurement.lineHeight).toBe(
        automaticReference?.measurement.lineHeight,
      )
      expect(manualReference?.measurement.letterSpacing).toBe(
        automaticReference?.measurement.letterSpacing,
      )
      expect(manualReference?.measurement.cols).toBe(automaticReference?.measurement.cols)
      expect(manualReference?.measurement.rows).toBe(automaticReference?.measurement.rows)
      expect(manualReference?.measurement.cssCellWidth).toBeCloseTo(
        automaticReference?.measurement.cssCellWidth ?? 0,
        5,
      )
      expect(manualReference?.measurement.cssCellHeight).toBeCloseTo(
        automaticReference?.measurement.cssCellHeight ?? 0,
        5,
      )
      expect(manualReference?.measurement.effectiveDpr).toBeCloseTo(
        automaticReference?.measurement.effectiveDpr ?? 0,
        5,
      )
    } finally {
      await electronApp.close()
    }
  })

  test('automatically calibrates this renderer without remounting its terminal', async () => {
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await seedZoomedWorkspace(window, false)
      await window.reload({ waitUntil: 'domcontentloaded' })
      const terminal = window.locator('.terminal-node').first()
      await expect(terminal.locator('.xterm')).toBeVisible()
      await expect
        .poll(async () => await readPersistedTerminalDisplayReference(window), {
          timeout: 15_000,
        })
        .not.toBeNull()
      expect(
        await window.evaluate(() =>
          window.localStorage.getItem('opencove:terminal-display-calibration:v1'),
        ),
      ).toBeNull()

      await terminal.locator('.xterm').click()
      await window.keyboard.type(
        buildNodeEvalCommand(
          `for (let i = 0; i < 40; i += 1) process.stdout.write((i === 0 ? 'CALIBRATION_HISTORY' : 'CALIBRATION_' + i) + '\\n')`,
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('CALIBRATION_39')
      await window.evaluate(id => {
        const element = document.querySelector('.terminal-node .xterm') as HTMLElement | null
        if (element) {
          element.dataset['calibrationIdentity'] = 'same-terminal'
        }
        window.__opencoveTerminalSelectionTestApi?.scrollToLine(id, 3)
        window.__opencoveTerminalSelectionTestApi?.selectAll(id)
      }, nodeId)
      const before = await window.evaluate(id => {
        const api = window.__opencoveTerminalSelectionTestApi
        const buffer = api?.getBufferText(id, 'CALIBRATION_HISTORY') ?? null
        return {
          timeOrigin: performance.timeOrigin,
          sessionId: api?.getRuntimeSessionId(id) ?? null,
          instanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
          domToken:
            (document.querySelector('.terminal-node .xterm') as HTMLElement | null)?.dataset[
              'calibrationIdentity'
            ] ?? null,
          markerAbsoluteLine: buffer?.markerAbsoluteLine ?? null,
          bufferLength: buffer?.bufferLength ?? null,
          viewportY: api?.getViewportY(id) ?? null,
          selection: api?.getSelection(id) ?? null,
        }
      }, nodeId)

      await window.locator('[data-testid="app-header-settings"]').click()
      await window.locator('[data-testid="settings-section-nav-appearance"]').click()
      const compensation = window.locator('[data-testid="settings-terminal-display-compensation"]')
      await expect(compensation).toHaveJSProperty('checked', false)
      await compensation.click()
      await expect(compensation).toHaveJSProperty('checked', true)

      let calibration: {
        fontSize: number
        lineHeight: number
        letterSpacing: number
        target: { cols: number; rows: number }
        measured?: { cols: number; rows: number }
      } | null = null
      await expect
        .poll(
          async () => {
            calibration = await window.evaluate(() => {
              const raw = window.localStorage.getItem('opencove:terminal-display-calibration:v1')
              return raw ? JSON.parse(raw) : null
            })
            return calibration
          },
          { timeout: 20_000 },
        )
        .not.toBeNull()
      await window.locator('[data-testid="settings-panel-close"]').click()

      const after = await window.evaluate(id => {
        const api = window.__opencoveTerminalSelectionTestApi
        const buffer = api?.getBufferText(id, 'CALIBRATION_HISTORY') ?? null
        return {
          timeOrigin: performance.timeOrigin,
          sessionId: api?.getRuntimeSessionId(id) ?? null,
          instanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
          domToken:
            (document.querySelector('.terminal-node .xterm') as HTMLElement | null)?.dataset[
              'calibrationIdentity'
            ] ?? null,
          markerAbsoluteLine: buffer?.markerAbsoluteLine ?? null,
          bufferLength: buffer?.bufferLength ?? null,
          viewportY: api?.getViewportY(id) ?? null,
          selection: api?.getSelection(id) ?? null,
          fontOptions: api?.getFontOptions(id) ?? null,
          size: api?.getSize(id) ?? null,
        }
      }, nodeId)
      expect(after).toMatchObject({
        ...before,
        bufferLength: expect.any(Number),
        fontOptions: {
          fontSize: calibration?.fontSize,
          lineHeight: calibration?.lineHeight,
          letterSpacing: calibration?.letterSpacing,
        },
        size: expect.any(Object),
      })
      expect(after.bufferLength).toBeGreaterThanOrEqual(before.bufferLength ?? 0)
      expect(calibration?.measured).toMatchObject({
        cols: calibration?.target.cols,
        rows: calibration?.target.rows,
      })
      const snapshot = await window.evaluate(
        async sessionId =>
          sessionId ? await window.opencoveApi.pty.presentationSnapshot({ sessionId }) : null,
        after.sessionId,
      )
      expect(snapshot).toMatchObject({ cols: after.size?.cols, rows: after.size?.rows })
    } finally {
      await electronApp.close()
    }
  })
})
