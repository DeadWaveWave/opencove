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
  settleBeforeTriggerMs?: number
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
  const settleBeforeTriggerMs = options.settleBeforeTriggerMs ?? 0
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

    if (settleBeforeTriggerMs > 0) {
      await window.waitForTimeout(settleBeforeTriggerMs)
    }

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
      await window.mouse.move(target.x, target.y)
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
    settleBeforeTriggerMs?: number
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
    settleBeforeTriggerMs: options.settleBeforeTriggerMs,
  })
}

function resolveHeaderDragSurfaceTestId(headerClassName: string): string {
  if (headerClassName.includes('terminal-node__header')) {
    return 'terminal-node-header-drag-surface'
  }

  if (headerClassName.includes('task-node__header')) {
    return 'task-node-header-drag-surface'
  }

  if (headerClassName.includes('note-node__header')) {
    return 'note-node-header-drag-surface'
  }

  throw new Error(`Unsupported header for drag surface: ${headerClassName}`)
}

function resolveHeaderTitleDisplayTestId(headerClassName: string): string {
  if (headerClassName.includes('terminal-node__header')) {
    return 'terminal-node-title-display'
  }

  if (headerClassName.includes('task-node__header')) {
    return 'task-node-title-display'
  }

  if (headerClassName.includes('note-node__header')) {
    return 'note-node-title-display'
  }

  throw new Error(`Unsupported header for title display: ${headerClassName}`)
}

function resolveHeaderRightBoundarySelectors(headerClassName: string): string[] {
  if (headerClassName.includes('terminal-node__header')) {
    return [
      '.terminal-node__header-badges',
      '[data-testid="terminal-node-session-list"]',
      '.terminal-node__action',
      '.terminal-node__close',
    ]
  }

  if (headerClassName.includes('task-node__header')) {
    return ['.task-node__header-actions']
  }

  if (headerClassName.includes('note-node__header')) {
    return ['.note-node__action', '.note-node__close']
  }

  throw new Error(`Unsupported header for drag boundary: ${headerClassName}`)
}

function isTerminalHeaderClassName(headerClassName: string): boolean {
  return headerClassName.includes('terminal-node__header')
}

async function computeHeaderFallbackPosition(
  header: Locator,
  className: string,
): Promise<{ x: number; y: number }> {
  const titleDisplayTestId = resolveHeaderTitleDisplayTestId(className)
  const rightBoundarySelectors = resolveHeaderRightBoundarySelectors(className)
  return await header.evaluate(
    (element, { titleDisplayId, selectors }) => {
      const headerRect = element.getBoundingClientRect()
      const titleDisplay = element.querySelector(`[data-testid="${titleDisplayId}"]`)
      const titleRect = titleDisplay?.getBoundingClientRect() ?? null

      const rightBoundaryRects = selectors
        .map(selector => element.querySelector(selector)?.getBoundingClientRect() ?? null)
        .filter((rect): rect is DOMRect => rect !== null)
      const nearestRightBoundary = rightBoundaryRects
        .map(rect => rect.left - headerRect.left)
        .filter(value => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b)[0]

      const visibleLeft = Math.max(0, -headerRect.left)
      const visibleRight = Math.min(
        headerRect.width,
        headerRect.width - Math.max(0, headerRect.right - window.innerWidth),
      )
      const titleLeft = titleRect ? titleRect.left - headerRect.left : headerRect.width * 0.12
      const titleRight = titleRect ? titleRect.right - headerRect.left : headerRect.width * 0.35

      const rightBlankLeft = Math.max(12, visibleLeft + 12, titleRight + 12)
      const rightBlankRight = Math.min(
        headerRect.width - 12,
        visibleRight - 12,
        nearestRightBoundary ? nearestRightBoundary - 12 : visibleRight - 12,
      )
      if (rightBlankRight > rightBlankLeft) {
        return { x: (rightBlankLeft + rightBlankRight) / 2, y: headerRect.height / 2 }
      }

      const leftBlankLeft = Math.max(12, visibleLeft + 12)
      const leftBlankRight = Math.min(visibleRight - 12, Math.max(12, titleLeft - 12))
      if (leftBlankRight > leftBlankLeft) {
        return { x: (leftBlankLeft + leftBlankRight) / 2, y: headerRect.height / 2 }
      }

      return {
        x: Math.min(headerRect.width - 12, Math.max(12, (visibleLeft + visibleRight) / 2)),
        y: headerRect.height / 2,
      }
    },
    {
      titleDisplayId: titleDisplayTestId,
      selectors: rightBoundarySelectors,
    },
  )
}

async function resolveHeaderDragTarget(header: Locator): Promise<{
  header: Locator
  className: string
  position: { x: number; y: number }
  surface: {
    locator: Locator
    offset: { x: number; y: number }
  } | null
}> {
  const className = String(await header.evaluate(element => element.className))
  const surface = header.getByTestId(resolveHeaderDragSurfaceTestId(className))
  const isTerminalHeader = isTerminalHeaderClassName(className)
  const surfaceMetrics = await surface
    .evaluate(element => {
      const headerElement = element.parentElement
      if (!headerElement) {
        return null
      }
      const headerRect = headerElement.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return {
        x: rect.left - headerRect.left,
        y: rect.top - headerRect.top,
        width: rect.width,
        height: rect.height,
        visibility: style.visibility,
        display: style.display,
      }
    })
    .catch(() => null)
  const canUseSurfacePosition =
    !isTerminalHeader &&
    surfaceMetrics &&
    surfaceMetrics.width > 0 &&
    surfaceMetrics.height > 0 &&
    surfaceMetrics.visibility !== 'hidden' &&
    surfaceMetrics.display !== 'none'

  return {
    header,
    className,
    position: canUseSurfacePosition
      ? {
          x: surfaceMetrics.x + Math.min(12, Math.max(6, Math.round(surfaceMetrics.width * 0.3))),
          y: surfaceMetrics.y + surfaceMetrics.height / 2,
        }
      : await computeHeaderFallbackPosition(header, className),
    surface:
      surfaceMetrics &&
      surfaceMetrics.width > 0 &&
      surfaceMetrics.height > 0 &&
      surfaceMetrics.visibility !== 'hidden' &&
      surfaceMetrics.display !== 'none'
        ? {
            locator: surface,
            offset: {
              x: surfaceMetrics.x,
              y: surfaceMetrics.y,
            },
          }
        : null,
  }
}

async function clickLocatorAtPosition(
  locator: Locator,
  position: { x: number; y: number },
  options?: {
    clickCount?: number
    modifiers?: Array<'Shift'>
    button?: 'left' | 'right' | 'middle'
  },
): Promise<void> {
  const rect = await readLocatorClientRect(locator)
  const window = locator.page()
  const holdsShift = (options?.modifiers ?? []).includes('Shift')
  const x = rect.x + position.x
  const y = rect.y + position.y

  if (holdsShift) {
    await window.keyboard.down('Shift')
  }

  try {
    await window.mouse.move(x, y)
    await window.mouse.click(x, y, {
      button: options?.button,
      clickCount: options?.clickCount,
    })
  } finally {
    if (holdsShift) {
      await window.keyboard.up('Shift').catch(() => undefined)
    }
  }
}

export async function clickHeaderDragSurface(
  header: Locator,
  options?: {
    clickCount?: number
    modifiers?: Array<'Shift'>
    force?: boolean
    button?: 'left' | 'right' | 'middle'
  },
): Promise<void> {
  const target = await resolveHeaderDragTarget(header)

  if (target.surface && !isTerminalHeaderClassName(target.className)) {
    await target.surface.locator.click({
      clickCount: options?.clickCount,
      modifiers: options?.modifiers,
      force: options?.force,
      button: options?.button,
    })
    return
  }

  await clickLocatorAtPosition(target.header, target.position, options)
}

export async function dragHeaderDragSurfaceTo(
  window: Page,
  header: Locator,
  target: Locator,
  options: {
    sourcePosition?: { x: number; y: number }
    targetPosition?: { x: number; y: number }
    steps?: number
  } = {},
): Promise<void> {
  const source = await resolveHeaderDragTarget(header)

  if (source.surface && !isTerminalHeaderClassName(source.className)) {
    await dragLocatorTo(window, source.surface.locator, target, {
      ...options,
      sourcePosition: options.sourcePosition
        ? {
            x: options.sourcePosition.x - source.surface.offset.x,
            y: options.sourcePosition.y - source.surface.offset.y,
          }
        : undefined,
    })
    return
  }
  const translatedSourcePosition = isTerminalHeaderClassName(source.className)
    ? source.position
    : options.sourcePosition

  await dragLocatorTo(window, source.header, target, {
    ...options,
    sourcePosition: translatedSourcePosition ?? source.position,
    settleBeforeTriggerMs: isTerminalHeaderClassName(source.className) ? 48 : undefined,
  })
}
