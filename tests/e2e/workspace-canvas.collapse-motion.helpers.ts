import { expect, test, type Page } from '@playwright/test'
import { seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import {
  pausePresentationAnimations,
  resumePresentationAnimations,
  seekCollapseProgress,
} from './workspace-canvas.collapse-motion-endpoints.helpers'
import {
  EXPANSION_PEER,
  EXPANSION_PROJECT,
  EXPANSION_TERMINAL,
  readTerminalIdentity,
  type NodeFrame,
} from './workspace-canvas.collapse-expansion.helpers'

export const MOTION_SPACE = 'collapse-motion-space'
export const terminalSelector = `.react-flow__node[data-id="${EXPANSION_TERMINAL}"]`
export const presentationSelector = `${terminalSelector} .cove-node-presentation`
export const spaceSelector = `.workspace-space-region:has([data-testid="workspace-space-drag-${MOTION_SPACE}-top"])`

interface PresentationSample {
  t: number
  shell: NodeFrame
  runtime: { width: number; height: number } | null
  instanceId: unknown
  size: { cols: number; rows: number } | null
}

interface MotionSampleResult {
  samples: PresentationSample[]
  error: string | null
  diagnostics: {
    actionCompletedAt: number | null
    sampledUntil: number
    currentFrame: PresentationSample | null
    activeShellAnimations: string[]
  }
}

type MotionWindow = Window & {
  __opencoveCollapseMotion?: {
    result: Promise<MotionSampleResult>
    completeAction: () => void
    stop: () => void
    snapshot: () => MotionSampleResult
  }
}

export async function seedCollapseMotionFixture(page: Page, withSpace: boolean | 'nested' = false) {
  await seedWorkspaceState(page, {
    activeWorkspaceId: EXPANSION_PROJECT,
    settings: {
      uiTheme: 'pixel',
      language: 'en',
      canvasInputMode: 'mouse',
      focusNodeOnClick: false,
      standbyBannerEnabled: false,
      nodeCreationPixelEffectEnabled: false,
    },
    workspaces: [
      {
        id: EXPANSION_PROJECT,
        name: 'Collapse motion',
        path: testWorkspacePath,
        nodes: [
          {
            id: EXPANSION_TERMINAL,
            title: 'Live terminal',
            kind: 'terminal',
            executionDirectory: testWorkspacePath,
            position: { x: 72, y: 100 },
            width: 560,
            height: 320,
          },
          {
            id: EXPANSION_PEER,
            title: 'Working notes',
            kind: 'note',
            task: { text: 'Keep this content and its editor alive.' },
            position: { x: 760, y: 100 },
            width: 340,
            height: 260,
          },
        ],
        ...(withSpace
          ? {
              spaces: [
                ...(withSpace === 'nested'
                  ? [
                      {
                        id: 'collapse-motion-parent',
                        name: 'Parent Space',
                        directoryPath: testWorkspacePath,
                        nodeIds: [],
                        rect: { x: 0, y: 0, width: 1180, height: 570 },
                      },
                    ]
                  : []),
                {
                  id: MOTION_SPACE,
                  name: 'Development',
                  directoryPath: testWorkspacePath,
                  ...(withSpace === 'nested' ? { parentSpaceId: 'collapse-motion-parent' } : {}),
                  nodeIds: [EXPANSION_TERMINAL, EXPANSION_PEER],
                  rect: { x: 40, y: 50, width: 1100, height: 440 },
                },
              ],
              activeSpaceId: null,
            }
          : {}),
      },
    ],
  })
  await expect(page.locator(`${terminalSelector} .xterm`)).toBeVisible()
  await expect.poll(() => readTerminalIdentity(page)).toMatchObject({ ready: true })
  await page.locator('.react-flow__controls-fitview').click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}

export async function readPresentationFrame(page: Page, selector = presentationSelector) {
  return page.locator(selector).evaluate(element => {
    const viewport = document.querySelector('.react-flow__viewport')!
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x / zoom,
      y: rect.y / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    }
  })
}

/** Sample real WAAPI frames deterministically, then let their own clock finish and clean up. */
export async function sampleAnimatedPresentation(
  page: Page,
  action: () => Promise<unknown>,
  {
    selector = presentationSelector,
    phase = 'timeline',
  }: {
    selector?: string
    phase?: 'timeline' | 'active'
  } = {},
): Promise<PresentationSample[]> {
  await pausePresentationAnimations(page, selector)
  return samplePresentation(
    page,
    async () => {
      await action()
      // Slow native RAF can skip most of a short transition. Preserve the production
      // keyframes/easing, but paint each selected phase before moving to the next one.
      /* eslint-disable no-await-in-loop -- Each animation phase must be painted before advancing. */
      for (const progress of [0, 0.08, 0.16, 0.26, 0.4, 0.65, 0.9]) {
        await seekCollapseProgress(page, progress, phase)
        await page.evaluate(
          () =>
            new Promise<void>(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
      }
      /* eslint-enable no-await-in-loop */
      await resumePresentationAnimations(page)
    },
    selector,
  )
}

export async function samplePresentation(
  page: Page,
  action: () => Promise<unknown>,
  selector = presentationSelector,
  duration = 1200,
): Promise<PresentationSample[]> {
  await page.evaluate(
    ({ selector: targetSelector, duration: sampleDuration, terminalId }) => {
      const samples: PresentationSample[] = []
      const startedAt = performance.now()
      let actionCompletedAt: number | null = null
      let error: string | null = null
      let finished = false
      let frameId = 0
      let deadlineId = 0
      let quietFrames = 0
      const shellAnimations = () =>
        document
          .querySelector(targetSelector)
          ?.getAnimations()
          .filter(
            animation => animation.pending || ['running', 'paused'].includes(animation.playState),
          ) ?? []
      const read = (time: number) => {
        const shell = document.querySelector<HTMLElement>(targetSelector)
        const runtime = document.querySelector<HTMLElement>(
          `[data-id="${terminalId}"] .terminal-node__terminal`,
        )
        const viewport = document.querySelector('.react-flow__viewport')
        const api = window.__opencoveTerminalSelectionTestApi
        if (!shell || !viewport) {
          throw new Error('Collapse motion shell or viewport is missing')
        }
        const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
        const rect = shell.getBoundingClientRect()
        const sample: PresentationSample = {
          t: time - startedAt,
          shell: {
            x: rect.x / zoom,
            y: rect.y / zoom,
            width: rect.width / zoom,
            height: rect.height / zoom,
          },
          runtime: runtime ? { width: runtime.clientWidth, height: runtime.clientHeight } : null,
          instanceId: api?.getRenderMetrics(terminalId)?.instanceId ?? null,
          size: api?.getSize(terminalId) ?? null,
        }
        return sample
      }
      const currentFrame = () => {
        try {
          return read(performance.now())
        } catch {
          return null
        }
      }
      const snapshot = (): MotionSampleResult => ({
        samples,
        error,
        diagnostics: {
          actionCompletedAt,
          sampledUntil: samples.at(-1)?.t ?? 0,
          currentFrame: currentFrame(),
          activeShellAnimations: shellAnimations().map(animation => animation.playState),
        },
      })
      let resolveResult!: (result: MotionSampleResult) => void
      const result = new Promise<MotionSampleResult>(resolve => {
        resolveResult = resolve
      })
      const finish = (reason: string | null = null) => {
        if (finished) {
          return
        }
        finished = true
        error = reason
        cancelAnimationFrame(frameId)
        clearTimeout(deadlineId)
        resolveResult(snapshot())
      }
      const tick = (time: number) => {
        if (finished) {
          return
        }
        try {
          samples.push(read(time))
          // Only this shell's motion matters; descendant activity may animate forever.
          quietFrames =
            actionCompletedAt !== null && shellAnimations().length === 0 ? quietFrames + 1 : 0
          if (time - startedAt >= sampleDuration && quietFrames >= 2) {
            finish()
          } else {
            frameId = requestAnimationFrame(tick)
          }
        } catch (cause) {
          finish(String(cause))
        }
      }
      samples.push(read(startedAt))
      ;(window as MotionWindow).__opencoveCollapseMotion = {
        result,
        completeAction: () => {
          actionCompletedAt = performance.now() - startedAt
        },
        stop: () => finish('Collapse motion sampling cancelled'),
        snapshot,
      }
      // Bound both delayed input and an animation that never settles.
      deadlineId = window.setTimeout(
        () => finish(`Collapse motion did not settle within ${sampleDuration + 5_000}ms`),
        sampleDuration + 5_000,
      )
      frameId = requestAnimationFrame(tick)
    },
    { selector, duration, terminalId: EXPANSION_TERMINAL },
  )
  try {
    const sampling = page
      .evaluate(async () => {
        const state = (window as MotionWindow).__opencoveCollapseMotion
        if (!state) {
          throw new Error('Collapse motion samples are missing')
        }
        return state.result
      })
      .then(result => {
        if (result.error) {
          throw new Error(`${result.error}\n${JSON.stringify(result.diagnostics)}`)
        }
        return result
      })
    const [result] = await Promise.all([
      sampling,
      Promise.resolve()
        .then(action)
        .then(() =>
          page.evaluate(() => {
            ;(window as MotionWindow).__opencoveCollapseMotion?.completeAction()
          }),
        ),
    ])
    return result.samples
  } finally {
    const diagnostics = await page
      .evaluate(() => {
        const state = (window as MotionWindow).__opencoveCollapseMotion
        if (!state) {
          return null
        }
        const snapshot = state.snapshot()
        state.stop()
        delete (window as MotionWindow).__opencoveCollapseMotion
        return snapshot
      })
      .catch(cause => ({ error: String(cause) }))
    await test.info().attach('collapse-motion-sampling', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    })
  }
}

export function expectContinuousSizeChange(
  samples: PresentationSample[],
  start: Pick<NodeFrame, 'width' | 'height'>,
  end: Pick<NodeFrame, 'width' | 'height'>,
) {
  const minWidth = Math.min(start.width, end.width)
  const maxWidth = Math.max(start.width, end.width)
  const intermediate = samples.filter(
    sample => sample.shell.width > minWidth + 2 && sample.shell.width < maxWidth - 2,
  )
  expect(
    new Set(intermediate.map(sample => sample.shell.width.toFixed(1))).size,
    'The visible shell passes through multiple distinct widths instead of snapping',
  ).toBeGreaterThanOrEqual(3)
  for (const sample of samples) {
    expect(sample.shell.width).toBeGreaterThanOrEqual(minWidth - 1)
    expect(sample.shell.width).toBeLessThanOrEqual(maxWidth + 1)
  }
  expect(samples.at(-1)?.shell.width).toBeCloseTo(end.width, 0)
  expect(samples.at(-1)?.shell.height).toBeCloseTo(end.height, 0)
}

export function expectRuntimeUnchanged(
  samples: PresentationSample[],
  identity: Awaited<ReturnType<typeof readTerminalIdentity>>,
) {
  expect(samples.length).toBeGreaterThanOrEqual(5)
  expect(samples.every(sample => sample.instanceId === identity.instanceId)).toBe(true)
  expect(
    samples.every(
      sample =>
        sample.runtime?.width === identity.body?.width &&
        sample.runtime?.height === identity.body?.height &&
        sample.size?.cols === identity.size?.cols &&
        sample.size?.rows === identity.size?.rows,
    ),
    'PTY geometry and the mounted terminal body stay fixed throughout every presentation frame',
  ).toBe(true)
}
