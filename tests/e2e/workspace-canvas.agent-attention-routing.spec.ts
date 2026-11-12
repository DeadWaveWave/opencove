import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  expectOverlayStubReady,
} from './workspace-canvas.terminal-agent-overlay.helpers'

type RecordedSystemNotification = { id: string | null; title: string; silent: boolean }

// Main's E2E harness (`systemNotifications.ts`) and the renderer's sound log (`notificationSound.ts`).
const HARNESS = '__opencoveSystemNotificationTestState'
const SOUND_LOG = '__opencoveNotificationSoundTestLog'

async function pretendForeground(electronApp: ElectronApplication, foreground: boolean) {
  await electronApp.evaluate(
    (_electron, { value, read }) => {
      const scope = globalThis as unknown as Record<string, { foreground: boolean | null }>
      scope[read].foreground = value
    },
    { value: foreground, read: HARNESS },
  )
}

async function readShown(electronApp: ElectronApplication): Promise<RecordedSystemNotification[]> {
  return await electronApp.evaluate(
    (_electron, read) =>
      (globalThis as unknown as Record<string, { shown: RecordedSystemNotification[] }>)[read]
        .shown,
    HARNESS,
  )
}

async function readSounds(window: Page): Promise<unknown[]> {
  return await window.evaluate(
    read => (window as unknown as Record<string, unknown[] | undefined>)[read] ?? [],
    SOUND_LOG,
  )
}

test.describe('Agent attention routing', () => {
  test.skip(process.platform === 'win32', 'POSIX terminal shim fixture')

  for (const foreground of [true, false]) {
    test(`an Agent that needs you ${foreground ? 'in front' : 'behind'}: card, one sound, ${
      foreground ? 'no' : 'one silent'
    } system notification`, async () => {
      const commandDirectory = await createAgentCommandPath()
      const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'attention-'))
      const { electronApp, window } = await launchApp({
        env: {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        },
      })
      try {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'attention-terminal',
              kind: 'terminal',
              title: 'Agent terminal',
              position: { x: 180, y: 160 },
              width: 520,
              height: 400,
              executionDirectory,
            },
          ],
          {
            settings: {
              standbyBannerEnabled: true,
              standbyBannerShowBranch: false,
              standbyBannerShowPullRequest: false,
              systemNotificationsEnabled: true,
              notificationSoundEnabled: true,
              notificationSound: 'bit',
              notificationSoundVolume: 40,
            },
          },
        )
        await pretendForeground(electronApp, foreground)

        const terminal = window.locator('[data-id="attention-terminal"] .terminal-node')
        const cards = window.locator('.app-notification')
        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.type('codex')
        await window.keyboard.press('Enter')
        await expectOverlayStubReady(terminal, 'codex')
        await expect(terminal.locator('.terminal-node__status')).toHaveText('Working')

        await window.keyboard.type('<test-overlay-advance>')
        await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
        await expect(cards).toHaveCount(1)
        await expect.poll(() => readSounds(window)).toEqual([{ sound: 'bit', volume: 40 }])

        if (foreground) {
          // Main drops it while OpenCove is in front, even with the switch on.
          await expect.poll(() => readShown(electronApp)).toEqual([])
          return
        }

        await expect.poll(async () => (await readShown(electronApp)).length).toBe(1)
        const [shown] = await readShown(electronApp)
        expect(shown).toMatchObject({ title: 'codex', silent: true })
        expect(shown.id).toBeTruthy()

        // Clicking it jumps to the Agent exactly as clicking its card does.
        await window.locator('.react-flow__controls-zoomout').click()
        const beforeClick = await readCanvasViewport(window)
        const clicked = await electronApp.evaluate(
          (_electron, { id, read }) =>
            (globalThis as unknown as Record<string, { click: (id: string) => boolean }>)[
              read
            ].click(id),
          { id: shown.id!, read: HARNESS },
        )
        expect(clicked).toBe(true)
        await expect(cards).toHaveCount(0)
        await expect.poll(() => readCanvasViewport(window)).not.toEqual(beforeClick)
        expect(await readSounds(window)).toHaveLength(1)
      } finally {
        await electronApp.close()
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
      }
    })
  }
})
