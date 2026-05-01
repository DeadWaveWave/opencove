import { expect, test } from '@playwright/test'
import { launchApp, testWorkspacePath } from './workspace-canvas.helpers'

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

async function seedZoomedWorkspace(window: Awaited<ReturnType<typeof launchApp>>['window']) {
  const result = await window.evaluate(
    async ({ seededWorkspaceId, seededNodeId, workspacePath }) => {
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
            terminalDisplayCalibrationCompensationEnabled: true,
            terminalDisplayReference: null,
          },
        }),
      })
    },
    {
      seededWorkspaceId: workspaceId,
      seededNodeId: nodeId,
      workspacePath: testWorkspacePath,
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

      const generalNav = window.locator('[data-testid="settings-section-nav-general"]')
      await expect(generalNav).toBeVisible()
      await generalNav.click()

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
})
