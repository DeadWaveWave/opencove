import { expect, type Locator, type Page } from '@playwright/test'

interface DragMousePoint {
  x: number
  y: number
}

interface DragMouseOptions {
  start: DragMousePoint
  end: DragMousePoint
  steps?: number
  triggerDistance?: number
  settleAfterPressMs?: number
  settleBeforeReleaseMs?: number
  settleAfterReleaseMs?: number
  modifiers?: Array<'Shift'>
  draft?: Locator
  draftTimeoutMs?: number
}

interface DragMouseMoveOptions {
  steps?: number
  settleAfterMoveMs?: number
  repeatAtTarget?: boolean
}

interface DragMouseSession {
  moveTo(target: DragMousePoint, options?: DragMouseMoveOptions): Promise<void>
  release(): Promise<void>
}

export interface LocatorClientRect {
  x: number
  y: number
  width: number
  height: number
}

async function releaseHeldModifier(window: Page, holdsShift: boolean): Promise<void> {
  if (holdsShift) {
    await window.keyboard.up('Shift').catch(() => undefined)
  }
}

async function moveMouseWithSteps(
  window: Page,
  from: DragMousePoint,
  to: DragMousePoint,
  steps: number,
): Promise<void> {
  // Avoid Playwright's built-in `steps` interpolation, which can hang on CI runners.
  // We still want intermediate mousemove events for drag interactions like snap guides.
  const clampedSteps = Math.max(1, Math.min(Math.floor(steps), 64))

  const step = async (index: number): Promise<void> => {
    const ratio = index / clampedSteps
    const x = from.x + (to.x - from.x) * ratio
    const y = from.y + (to.y - from.y) * ratio

    await window.mouse.move(x, y)

    if (index >= clampedSteps) {
      return
    }

    await step(index + 1)
  }

  await step(1)
}

export async function readLocatorClientRect(locator: Locator): Promise<LocatorClientRect> {
  await expect(locator).toBeVisible()

  const rect = await locator.evaluate(element => {
    const box = element.getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }
  })

  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('locator client rect unavailable')
  }

  return rect
}

export async function beginDragMouse(
  window: Page,
  options: Omit<DragMouseOptions, 'end'> & {
    initialTarget?: DragMousePoint
  },
): Promise<DragMouseSession> {
  const steps = options.steps ?? 16
  const triggerDistance = options.triggerDistance ?? 8
  const settleAfterPressMs = options.settleAfterPressMs ?? 32
  const settleBeforeReleaseMs = options.settleBeforeReleaseMs ?? 48
  const settleAfterReleaseMs = options.settleAfterReleaseMs ?? 32
  const deltaX = (options.initialTarget?.x ?? options.start.x + triggerDistance) - options.start.x
  const deltaY = (options.initialTarget?.y ?? options.start.y) - options.start.y
  const totalDistance = Math.hypot(deltaX, deltaY)
  const triggerRatio =
    totalDistance > 0 ? Math.min(1, triggerDistance / Math.max(totalDistance, 1)) : 0
  const triggerPoint = {
    x: options.start.x + deltaX * triggerRatio,
    y: options.start.y + deltaY * triggerRatio,
  }
  const holdsShift = (options.modifiers ?? []).includes('Shift')
  let cursorPoint = { x: options.start.x, y: options.start.y }
  let released = false

  if (holdsShift) {
    await window.keyboard.down('Shift')
  }

  try {
    await window.mouse.move(options.start.x, options.start.y)
    await window.mouse.down()

    if (triggerRatio > 0) {
      await moveMouseWithSteps(window, cursorPoint, triggerPoint, Math.max(2, Math.min(steps, 4)))
      cursorPoint = triggerPoint
    }

    if (options.draft) {
      await expect(options.draft).toBeVisible({ timeout: options.draftTimeoutMs ?? 5_000 })
    }

    if (settleAfterPressMs > 0) {
      await window.waitForTimeout(settleAfterPressMs)
    }
  } catch (error) {
    await window.mouse.up().catch(() => undefined)
    await releaseHeldModifier(window, holdsShift)
    throw error
  }

  const moveTo = async (
    target: DragMousePoint,
    moveOptions: DragMouseMoveOptions = {},
  ): Promise<void> => {
    const moveSteps = moveOptions.steps ?? steps
    const repeatAtTarget = moveOptions.repeatAtTarget ?? true

    await moveMouseWithSteps(window, cursorPoint, target, moveSteps)
    cursorPoint = target

    // Playwright documents that some drag targets need a second move to
    // reliably receive dragover before release.
    if (repeatAtTarget) {
      await moveMouseWithSteps(window, cursorPoint, target, Math.max(2, Math.min(moveSteps, 4)))
    }

    if ((moveOptions.settleAfterMoveMs ?? 0) > 0) {
      await window.waitForTimeout(moveOptions.settleAfterMoveMs ?? 0)
    }
  }

  const release = async (): Promise<void> => {
    if (released) {
      return
    }

    released = true

    try {
      if (settleBeforeReleaseMs > 0) {
        await window.waitForTimeout(settleBeforeReleaseMs)
      }

      await window.mouse.up()

      if (settleAfterReleaseMs > 0) {
        await window.waitForTimeout(settleAfterReleaseMs)
      }
    } finally {
      await releaseHeldModifier(window, holdsShift)
    }
  }

  return {
    moveTo,
    release,
  }
}

export async function dragMouse(window: Page, options: DragMouseOptions): Promise<void> {
  const drag = await beginDragMouse(window, {
    ...options,
    initialTarget: options.end,
  })
  await drag.moveTo(options.end)
  await drag.release()
}

export async function dragLocatorTo(
  window: Page,
  source: Locator,
  target: Locator,
  options: {
    sourcePosition?: { x: number; y: number }
    targetPosition?: { x: number; y: number }
    steps?: number
  } = {},
): Promise<void> {
  const sourceBox = await readLocatorClientRect(source)
  const targetBox = await readLocatorClientRect(target)

  const startX = sourceBox.x + (options.sourcePosition?.x ?? sourceBox.width / 2)
  const startY = sourceBox.y + (options.sourcePosition?.y ?? sourceBox.height / 2)
  const endX = targetBox.x + (options.targetPosition?.x ?? targetBox.width / 2)
  const endY = targetBox.y + (options.targetPosition?.y ?? targetBox.height / 2)

  await dragMouse(window, {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    steps: options.steps,
  })
}
