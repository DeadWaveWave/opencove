import { readFile } from 'node:fs/promises'
import { expect, test, type JSHandle } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { isSeededWorkspaceNavigationReady } from './workspace-canvas.seed-readiness'
import {
  createRendererRecoveryProbe,
  readRecoveryProcessState,
  withRecoveryDeadline,
} from './runtime-diagnostics.renderer-crash.helpers'

// Verify that close() retained the artifact before removing the app's userData.
test.afterEach(async () => {
  const testInfo = test.info()
  const attachment = testInfo.attachments.find(item => item.name === 'electron-process-diagnostics')
  expect(attachment).toBeDefined()
  expect(attachment?.path).toBeDefined()
  const output = await withRecoveryDeadline(
    'Read retained process diagnostics',
    readFile(attachment!.path!, 'utf8'),
    5_000,
  )
  expect(output).toContain('render-process-gone')
  const record = output
    .split('\n')
    .find(line => line.startsWith('{') && line.includes('"event":"render-process-gone"'))
  expect(record).toBeDefined()
  const { details } = JSON.parse(record!) as { details: { reason: string; exitCode: number } }
  expect(['killed', 'crashed']).toContain(details.reason)
  expect(Number.isInteger(details.exitCode)).toBe(true)
  expect(output).toContain('lastLifecycleEvent')
  expect(output).toContain('processMetricsAtExit')
})

test('recovers the workspace in the same main process after a renderer crash', async () => {
  const launching = launchApp()
  const { electronApp, window } = await withRecoveryDeadline(
    'Launch isolated app',
    launching,
    30_000,
  ).catch(error => {
    // A launch that finishes after the deadline must still release its owned process.
    void launching.then(result => result.electronApp.close()).catch(() => undefined)
    throw error
  })
  const mainPid = electronApp.process().pid!
  let probe: JSHandle<ReturnType<typeof createRendererRecoveryProbe>> | undefined
  let lastSnapshot:
    | ReturnType<ReturnType<typeof createRendererRecoveryProbe>['snapshot']>
    | undefined
  let stage = 'Seed workspace'
  const step = async <T>(
    name: string,
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> => {
    stage = name
    return await test.step(name, () => withRecoveryDeadline(name, operation(), timeoutMs))
  }
  const snapshot = async () => {
    lastSnapshot = await withRecoveryDeadline(
      'Read native recovery state',
      probe!.evaluate(observer => observer.snapshot()),
      5_000,
    )
    return lastSnapshot
  }

  try {
    await step('Seed workspace', () => clearAndSeedWorkspace(window, []), 30_000)
    const browserWindow = await step(
      'Find native window',
      () => electronApp.browserWindow(window),
      5_000,
    )
    probe = await step(
      'Observe renderer lifecycle',
      () => browserWindow.evaluateHandle(createRendererRecoveryProbe),
      5_000,
    )
    const initial = await snapshot()
    expect(initial.mainPid).toBe(mainPid)
    await step(
      'Request one renderer crash',
      () => probe!.evaluate(observer => observer.trigger()),
      5_000,
    )

    await step(
      'Observe renderer death',
      async () => {
        await expect.poll(async () => (await snapshot()).gone, { timeout: 10_000 }).not.toBeNull()
      },
      15_000,
    )

    // Playwright's original Page stays crashed. Query the same native WebContents after
    // its replacement renderer exists, retaining load events as evidence instead of awaiting one.
    await step(
      'Restore workspace in replacement renderer',
      async () => {
        await expect
          .poll(
            async () => {
              const state = await snapshot()
              expect(state.mainPid).toBe(mainPid)
              if (
                state.destroyed ||
                state.crashed ||
                !state.rendererPid ||
                state.rendererPid === initial.rendererPid
              ) {
                return { navigationReady: false, canvasVisible: false }
              }
              return await withRecoveryDeadline(
                'Read restored workspace',
                browserWindow.evaluate(
                  (host, readiness) =>
                    host.webContents.executeJavaScript(`({
                      navigationReady: (${readiness})(1),
                      canvasVisible: (() => {
                        const pane = document.querySelector('.workspace-canvas .react-flow__pane')
                        if (!pane) return false
                        const rect = pane.getBoundingClientRect()
                        return rect.width > 0 && rect.height > 0 && getComputedStyle(pane).visibility === 'visible'
                      })()
                    })`),
                  isSeededWorkspaceNavigationReady.toString(),
                ),
                5_000,
              )
            },
            { timeout: 15_000 },
          )
          .toEqual({ navigationReady: true, canvasVisible: true })
      },
      20_000,
    )
    expect(electronApp.process().exitCode).toBeNull()
    expect(electronApp.process().signalCode).toBeNull()
    expect((await snapshot()).mainPid).toBe(mainPid)
  } catch (error) {
    let observationError: string | undefined
    if (probe) {
      await snapshot().catch(reason => {
        observationError = String(reason)
      })
    }
    const pids = [mainPid, lastSnapshot?.initialRendererPid, lastSnapshot?.rendererPid].filter(
      (pid): pid is number => typeof pid === 'number' && pid > 0,
    )
    const processes = await withRecoveryDeadline(
      'Read process status',
      readRecoveryProcessState(pids),
      3_000,
    ).catch(reason => ({ error: String(reason) }))
    const evidence = {
      stage,
      error: String(error),
      observationError,
      lastSnapshot,
      processes,
      exitCode: electronApp.process().exitCode,
      signal: electronApp.process().signalCode,
    }
    process.stderr.write(`[renderer-recovery] ${JSON.stringify(evidence)}\n`)
    await withRecoveryDeadline(
      'Attach recovery failure',
      test.info().attach('renderer-recovery-state', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      }),
      5_000,
    )
    throw error
  } finally {
    if (probe) {
      await withRecoveryDeadline(
        'Dispose recovery observer',
        probe.evaluate(observer => observer.dispose()),
        3_000,
      ).catch(() => undefined)
    }
    await withRecoveryDeadline(
      'Close isolated app and retain diagnostics',
      electronApp.close(),
      30_000,
    )
  }
})
