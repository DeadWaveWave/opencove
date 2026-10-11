import { expect, type Page } from '@playwright/test'
import { seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import {
  EXPANSION_PROJECT,
  EXPANSION_TERMINAL,
  readTerminalIdentity,
  type NodeFrame,
} from './workspace-canvas.collapse-expansion.helpers'

interface IdentityFrame {
  glyph: NodeFrame
  text: NodeFrame
  visibleText: { x: number; width: number }
  textContent: string
  colors: Record<'glyph' | 'text', { css: string; rgba: number[] }>
  captionBackground: number[]
}

interface EndpointProbe {
  animations: Animation[]
  originalAnimate: typeof Element.prototype.animate
}

type EndpointWindow = Window & { __opencoveCollapseEndpoint?: EndpointProbe }

export async function seedIdentityEndpointFixture(
  page: Page,
  kind: 'terminal' | 'agent',
  fontScale: number,
) {
  await seedWorkspaceState(page, {
    activeWorkspaceId: EXPANSION_PROJECT,
    settings: {
      uiTheme: 'pixel',
      uiFontSize: 16 * fontScale,
      // Use short localized placeholder copy to measure actual text centering,
      // rather than a Range extending beyond the compact caption's ellipsis.
      language: kind === 'agent' ? 'zh-CN' : 'en',
      canvasInputMode: 'mouse',
      focusNodeOnClick: false,
      standbyBannerEnabled: false,
      nodeCreationPixelEffectEnabled: false,
    },
    workspaces: [
      {
        id: EXPANSION_PROJECT,
        name: 'Disclosure endpoints',
        path: testWorkspacePath,
        nodes: [
          {
            id: EXPANSION_TERMINAL,
            kind,
            title: kind === 'agent' ? 'codex · Review' : 'Shell',
            position: { x: 72, y: 80 },
            width: 640,
            height: 520,
            executionDirectory: testWorkspacePath,
            ...(kind === 'agent'
              ? {
                  status: 'running',
                  startedAt: new Date().toISOString(),
                  agent: {
                    provider: 'codex',
                    prompt: 'Review the workspace changes.',
                    model: null,
                    effectiveModel: null,
                    launchMode: 'new',
                    resumeSessionId: 'collapse-endpoint-review',
                    resumeSessionIdVerified: true,
                    executionDirectory: testWorkspacePath,
                    directoryMode: 'workspace',
                    customDirectory: null,
                    shouldCreateDirectory: false,
                  },
                }
              : {}),
          },
        ],
      },
    ],
  })
  await expect(page.locator(`[data-id="${EXPANSION_TERMINAL}"] .xterm`)).toBeVisible()
  await expect.poll(() => readTerminalIdentity(page)).toMatchObject({ ready: true })
  await page.locator('.react-flow__controls-fitview').click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}

/** Freeze real browser animations before their first frame; no production timing overrides. */
export async function pauseCollapseAnimations(page: Page, nodeId: string) {
  await pausePresentationAnimations(
    page,
    `.react-flow__node[data-id="${nodeId}"] .cove-node-presentation`,
  )
}

export async function pausePresentationAnimations(page: Page, selector: string) {
  await page.evaluate(targetSelector => {
    const originalAnimate = Element.prototype.animate
    const probe: EndpointProbe = { animations: [], originalAnimate }
    ;(window as EndpointWindow).__opencoveCollapseEndpoint = probe
    Element.prototype.animate = function (keyframes, options) {
      const animation = originalAnimate.call(this, keyframes, options)
      if (this.closest(targetSelector)) {
        animation.pause()
        animation.currentTime = 0
        probe.animations.push(animation)
      }
      return animation
    }
  }, selector)
}

export async function seekCollapseEndpoint(page: Page) {
  return seekCollapseProgress(page, 1)
}

/** Seek the actual WAAPI effects, including host easing, without changing their keyframes. */
export async function seekCollapseProgress(
  page: Page,
  progress: number,
  phase: 'timeline' | 'active' = 'timeline',
) {
  return page.evaluate(
    ({ fraction, phase: targetPhase }) => {
      const probe = (window as EndpointWindow).__opencoveCollapseEndpoint
      if (!probe?.animations.length) {
        throw new Error('The real disclosure action did not start any animations')
      }
      Element.prototype.animate = probe.originalAnimate
      for (const animation of probe.animations) {
        const timing = animation.effect?.getComputedTiming()
        const end = Number(timing?.endTime)
        const start = targetPhase === 'active' ? Number(timing?.delay) : 0
        if (!Number.isFinite(end) || end <= start) {
          throw new Error('Disclosure animation must have a finite positive end time')
        }
        animation.currentTime = fraction === 1 ? end - 0.01 : start + (end - start) * fraction
      }
      return probe.animations.length
    },
    { fraction: progress, phase },
  )
}

/** Let the real clock deliver finish events and production cleanup after controlled sampling. */
export async function resumePresentationAnimations(page: Page) {
  await page.evaluate(async () => {
    const host = window as EndpointWindow
    const probe = host.__opencoveCollapseEndpoint
    if (!probe?.animations.length) {
      throw new Error('Missing presentation animations')
    }
    Element.prototype.animate = probe.originalAnimate
    const completed = Promise.all(probe.animations.map(animation => animation.finished))
    for (const animation of probe.animations) {
      animation.play()
    }
    await completed
    delete host.__opencoveCollapseEndpoint
  })
}

export async function finishCollapseAnimations(page: Page, nodeId: string) {
  await page.evaluate(() => {
    const host = window as EndpointWindow
    const probe = host.__opencoveCollapseEndpoint
    if (!probe) {
      throw new Error('Missing disclosure animations')
    }
    Element.prototype.animate = probe.originalAnimate
    for (const animation of probe.animations) {
      animation.finish()
    }
    delete host.__opencoveCollapseEndpoint
  })
  await expect(
    page.locator(`.react-flow__node[data-id="${nodeId}"] .cove-node-presentation`),
  ).not.toHaveAttribute('data-cove-collapse-motion', /.+/)
}

/** Measure painted glyph and the leading text, not flex containers or whole header boxes. */
export async function readIdentityFrame(
  page: Page,
  nodeId: string,
  presentation: 'compact' | 'header',
): Promise<IdentityFrame> {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`).evaluate((node, mode) => {
    const root = node.querySelector(
      mode === 'compact' ? '.cove-collapsed-window' : '.cove-node-presentation__runtime',
    )!
    const glyph = root.querySelector(
      mode === 'compact'
        ? '.cove-collapsed-window__icon > svg, .cove-collapsed-window__icon .agent-provider-icon > svg'
        : '.cove-node-kind-icon, .cove-node-provider-icon > svg',
    )
    const title = root.querySelector(
      mode === 'compact'
        ? '.cove-collapsed-window__title'
        : '.node-title-editor__display, .document-node__title-text',
    )
    if (!glyph || !title) {
      throw new Error(`Missing ${mode} glyph or title`)
    }
    const viewport = node.closest('.react-flow__viewport')!
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
    const origin = node.getBoundingClientRect()
    const frame = (rect: DOMRect): NodeFrame => ({
      x: (rect.x - origin.x) / zoom,
      y: (rect.y - origin.y) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    })
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    while (text && !text.textContent?.trim()) {
      text = walker.nextNode()
    }
    if (!text) {
      throw new Error('Disclosure title has no rendered text')
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')!
    const color = (element: Element, property: 'color' | 'backgroundColor' = 'color') => {
      const css = getComputedStyle(element)[property]
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = css
      context.fillRect(0, 0, 1, 1)
      return { css, rgba: Array.from(context.getImageData(0, 0, 1, 1).data) }
    }
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(4, text.textContent!.length))
    const textFrame = frame(range.getBoundingClientRect())
    range.selectNodeContents(title)
    const allText = range.getBoundingClientRect()
    let visibleLeft = allText.left
    let visibleRight = allText.right
    // Range geometry includes overflowed text. Intersect actual clipping boxes
    // so a last-frame loss of ellipsis/clipping cannot masquerade as continuity.
    for (let ancestor: Element | null = title; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).overflowX !== 'visible') {
        const rect = ancestor.getBoundingClientRect()
        visibleLeft = Math.max(visibleLeft, rect.left)
        visibleRight = Math.min(visibleRight, rect.right)
      }
      if (ancestor === node) {
        break
      }
    }
    return {
      glyph: frame(glyph.getBoundingClientRect()),
      text: textFrame,
      visibleText: {
        x: (visibleLeft - origin.x) / zoom,
        width: Math.max(0, visibleRight - visibleLeft) / zoom,
      },
      textContent: title.textContent?.trim() ?? '',
      colors: { glyph: color(glyph), text: color(text.parentElement!) },
      captionBackground: color(title, 'backgroundColor').rgba,
    }
  }, presentation)
}

export function expectIdentityEndpointContinuous(before: IdentityFrame, after: IdentityFrame) {
  expect(before.textContent).toBe(after.textContent)
  before.captionBackground.forEach((channel, index) => {
    expect
      .soft(
        Math.abs(channel - after.captionBackground[index]!),
        `Caption background channel ${index} must not flash at disclosure boundaries`,
      )
      .toBeLessThanOrEqual(1)
  })
  for (const part of ['glyph', 'text'] as const) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect
        .soft(
          Math.abs(before[part][dimension] - after[part][dimension]),
          `${part}.${dimension} must not jump when the animation hands off to the settled DOM`,
        )
        .toBeLessThanOrEqual(0.75)
    }
    before.colors[part].rgba.forEach((channel, index) => {
      expect
        .soft(
          Math.abs(channel - after.colors[part].rgba[index]!),
          `${part} color channel ${index} must not flash at the identity handoff`,
        )
        .toBeLessThanOrEqual(1)
    })
  }
  for (const dimension of ['x', 'width'] as const) {
    expect
      .soft(
        Math.abs(before.visibleText[dimension] - after.visibleText[dimension]),
        `Visible title ${dimension} must not jump when temporary clipping is removed`,
      )
      .toBeLessThanOrEqual(0.75)
  }
}
