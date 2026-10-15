import { expect, type Page, type TestInfo } from '@playwright/test'
import type { LabelColor } from '../../src/shared/types/labelColor'
import {
  buildNodeEvalCommand,
  clickHeaderDragSurface,
  selectCoveOption,
} from './workspace-canvas.helpers'
import {
  createMaterialFixture,
  MATERIAL_NODE_KINDS,
  MATERIAL_TERMINAL,
  MATERIAL_WORKSPACE,
  seedMaterialFixture,
} from './workspace-canvas.spatial-pixel.materials.fixture'

export const IDENTITY_COLORS: Record<(typeof MATERIAL_NODE_KINDS)[number], LabelColor> = {
  terminal: 'orange',
  agent: 'purple',
  task: 'green',
  document: 'blue',
  note: 'yellow',
  role: 'red',
  website: 'gray',
  image: 'green',
}
export const nodeSelector = (kind: string) => `.react-flow__node[data-id="pixel-material-${kind}"]`
export const headerSelector = (kind: string) =>
  `.${kind === 'agent' ? 'terminal' : kind}-node__header`

export async function createIdentityFixture() {
  const fixture = await createMaterialFixture()
  for (const node of fixture.nodes) {
    node.labelColorOverride = IDENTITY_COLORS[node.kind as keyof typeof IDENTITY_COLORS]
  }
  return fixture
}

export async function seedIdentityFixture(
  page: Page,
  fixture: Awaited<ReturnType<typeof createMaterialFixture>>,
) {
  await seedMaterialFixture(page, fixture)
  await expect(page.locator(`${nodeSelector('agent')} .terminal-node__title-prefix`)).toHaveCount(0)
  await expect(
    page.locator(`${nodeSelector('agent')} [data-agent-provider="codex"]`).first(),
  ).toBeVisible()
}

export async function clearCanvasSelection(page: Page) {
  const rect = await page.locator('.workspace-canvas').boundingBox()
  if (!rect) {
    throw new Error('Workspace canvas is missing')
  }
  await page.mouse.click(rect.x + rect.width - 8, rect.y + rect.height - 16)
}

export async function selectIdentityTheme(page: Page, theme: string) {
  await page.getByTestId('app-header-settings').click()
  await page.getByTestId('settings-section-nav-appearance').click()
  await selectCoveOption(page, 'settings-ui-theme', theme)
  await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', theme)
  await page.locator('.settings-panel__close').click()
  await clearCanvasSelection(page)
}

export async function changeNodeIdentity(
  page: Page,
  kind: 'terminal' | 'document',
  color: LabelColor | 'none',
) {
  const node = page.locator(nodeSelector(kind))
  const header = node.locator(headerSelector(kind))
  if (kind === 'document') {
    // Document uses its real header surface, without a dedicated drag-surface child.
    await header.click({ position: { x: 12, y: 17 } })
  } else {
    await clickHeaderDragSurface(header)
  }
  await expect(node).toHaveClass(/selected/)
  await header.click({ button: 'right', position: { x: 120, y: 17 } })
  await page.getByTestId('workspace-selection-label-color').click()
  await page.getByTestId(`workspace-selection-label-color-${color}`).click()
  if (color === 'none') {
    await expect(node).not.toHaveAttribute('data-cove-label-color')
  } else {
    await expect(node).toHaveAttribute('data-cove-label-color', color)
  }
  await clearCanvasSelection(page)
}

export async function readNodeIdentity(page: Page) {
  return await page.evaluate(
    kinds => {
      const rgba = (color: string): number[] => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data]
      }
      const luminance = (color: number[]) =>
        color.slice(0, 3).reduce((sum, channel, index) => {
          const value = channel / 255
          return (
            sum +
            (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]
          )
        }, 0)
      const composite = (front: number[], back: number[]) =>
        front
          .slice(0, 3)
          .map((channel, index) => (channel * front[3]) / 255 + back[index] * (1 - front[3] / 255))
      const contrast = (text: number[], surface: number[]) => {
        const ink = luminance(composite(text, surface))
        const background = luminance(surface)
        return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05)
      }
      const bodySelectors: Record<string, string> = {
        terminal: '.terminal-node__terminal',
        agent: '.terminal-node__terminal',
        task: '[data-testid="task-node-inline-requirement-input"]',
        document: '.document-node__body',
        note: '.note-node__textarea',
        role: '.role-node__input',
        website: '.website-node__body',
        image: '.image-node__img',
      }
      return kinds.map(kind => {
        const wrapper = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="pixel-material-${kind}"]`,
        )!
        const frame = wrapper.querySelector<HTMLElement>(
          `.${kind === 'agent' ? 'terminal' : kind}-node`,
        )!
        const header = frame.querySelector<HTMLElement>(
          `.${kind === 'agent' ? 'terminal' : kind}-node__header`,
        )
        const body = frame.querySelector<HTMLElement>(bodySelectors[kind]) ?? frame
        const style = getComputedStyle(frame)
        const headerStyle = getComputedStyle(header ?? frame)
        const bodyStyle = getComputedStyle(body)
        const ribbon = getComputedStyle(header ?? frame, '::before')
        const title =
          header?.querySelector<HTMLElement>(
            '.node-title-editor__display-text, .role-node__title, input',
          ) ??
          header ??
          frame
        const titleColor = getComputedStyle(title).color
        const headerBase =
          headerStyle.getPropertyValue('--cove-node-label-header-base').trim() ||
          headerStyle
            .getPropertyValue(
              kind === 'terminal' || kind === 'agent'
                ? '--cove-terminal-node-header-surface'
                : '--cove-node-header-surface',
            )
            .trim()
        const underlay = rgba(style.getPropertyValue('--cove-app-background').trim())
        const surface = composite(rgba(headerBase), underlay)
        const identityColor = headerStyle.getPropertyValue('--cove-node-identity-color').trim()
        const labelColor = composite(rgba(identityColor), underlay)
        const tint =
          Number.parseFloat(headerStyle.getPropertyValue('--cove-node-label-header-tint')) / 100
        const tintedSurface = surface.map(
          (channel, index) => channel * (1 - tint) + labelColor[index] * tint,
        )
        const text = rgba(titleColor)
        const icon = wrapper.querySelector<SVGElement>('[data-cove-node-kind-icon]')
        const providerIcon = header?.querySelector<HTMLElement>('.cove-node-provider-icon')
        return {
          kind,
          label: wrapper.dataset.coveLabelColor ?? null,
          identity: {
            color: identityColor,
            secondary: headerStyle.getPropertyValue('--cove-node-identity-secondary').trim(),
            tertiary: headerStyle.getPropertyValue('--cove-node-identity-tertiary').trim(),
          },
          themePalette: ['blue', 'cyan', 'mint'].map(color =>
            headerStyle.getPropertyValue(`--cove-pixel-${color}`).trim(),
          ),
          labelColor: headerStyle.getPropertyValue('--cove-label-color').trim(),
          headerImage: header ? headerStyle.backgroundImage : null,
          ribbonImage: ribbon.backgroundImage,
          ribbonHeight: Number.parseFloat(ribbon.height),
          border: style.borderTopColor,
          borderWidth: style.borderTopWidth,
          body: {
            color: bodyStyle.color,
            background: bodyStyle.backgroundColor,
            image: bodyStyle.backgroundImage,
          },
          contrast: Math.min(contrast(text, surface), contrast(text, tintedSurface)),
          contrastSource: { titleColor, headerBase },
          icon: icon
            ? {
                kind: icon.dataset.coveNodeKindIcon,
                fill: icon.getAttribute('fill'),
                stroke: icon.getAttribute('stroke-width'),
                width: Number.parseFloat(getComputedStyle(icon).width),
                tile: icon.parentElement?.matches('[data-cove-part="kind-tile"]')
                  ? Number.parseFloat(getComputedStyle(icon.parentElement).width)
                  : null,
                pointer: getComputedStyle(icon).pointerEvents,
                hidden: icon.getAttribute('aria-hidden'),
                focusable: icon.getAttribute('focusable'),
              }
            : null,
          providerIcon: providerIcon
            ? {
                provider: providerIcon.dataset.agentProvider,
                width: Number.parseFloat(getComputedStyle(providerIcon).width),
                background: getComputedStyle(providerIcon).backgroundColor,
                borderWidth: getComputedStyle(providerIcon).borderTopWidth,
                label: providerIcon.getAttribute('aria-label'),
                svgHidden: providerIcon.querySelector('svg')?.getAttribute('aria-hidden'),
                svg: Boolean(providerIcon.querySelector('svg')),
              }
            : null,
        }
      })
    },
    [...MATERIAL_NODE_KINDS],
  )
}

export async function terminalIdentity(page: Page) {
  return await page.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const body = document.querySelector<HTMLElement>(`[data-id="${id}"] .terminal-node__terminal`)
    return {
      sessionId: api?.getRuntimeSessionId(id),
      instanceId: api?.getRenderMetrics(id)?.instanceId,
      size: api?.getSize(id),
      body: body ? { width: body.clientWidth, height: body.clientHeight } : null,
    }
  }, MATERIAL_TERMINAL)
}

export async function printIdentityMarker(page: Page) {
  const terminal = page.locator(`${nodeSelector('terminal')} .terminal-node`)
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  const stamp = Date.now().toString(36)
  const marker = `COLOR_READY_${stamp}`
  await page.keyboard.type(
    buildNodeEvalCommand(
      `process.stdout.write(['COLOR','READY','${stamp}'].join('_')+String.fromCharCode(10))`,
    ),
  )
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText(marker)
  await clearCanvasSelection(page)
}

export async function persistedLabels(page: Page) {
  return await page.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = raw
      ? (JSON.parse(raw) as {
          workspaces?: Array<{
            id: string
            nodes?: Array<{ id: string; labelColorOverride?: string | null }>
          }>
        })
      : null
    return Object.fromEntries(
      (state?.workspaces?.find(workspace => workspace.id === id)?.nodes ?? []).map(node => [
        node.id,
        node.labelColorOverride ?? null,
      ]),
    )
  }, MATERIAL_WORKSPACE)
}

export async function attachIdentityFrame(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' })
}

export async function readSpaceIdentity(page: Page) {
  return await page.locator('.workspace-space-region').evaluateAll(regions =>
    regions.map(region => {
      const style = getComputedStyle(region)
      const rect = region.getBoundingClientRect()
      const color = (value: string) => {
        const numbers = value.match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
        return { rgb: numbers.slice(0, 3), alpha: numbers[3] ?? 1, css: value }
      }
      const edge = getComputedStyle(region, '::before')
      const zoom = rect.width / Number.parseFloat((region as HTMLElement).style.width)
      const clipPoints = edge.clipPath.startsWith('polygon(')
        ? edge.clipPath
            .slice(8, -1)
            .split(',')
            .map(value => {
              const match = value.trim().match(/^([\d.]+)(px|%)\s+([\d.]+)(px|%)$/)
              if (!match) {
                throw new Error(`Unexpected Space border clip point: ${value}`)
              }
              return {
                x:
                  match[2] === '%'
                    ? (Number(match[1]) / 100) * rect.width
                    : Number(match[1]) * zoom,
                y:
                  match[4] === '%'
                    ? (Number(match[3]) / 100) * rect.height
                    : Number(match[3]) * zoom,
              }
            })
        : []
      const gaps = clipPoints.flatMap((point, index) => {
        const next = clipPoints[index + 1]
        return next &&
          point.y > 0 &&
          point.y < rect.height / 2 &&
          next.y === point.y &&
          next.x > point.x
          ? [{ left: rect.left + point.x, right: rect.left + next.x, depth: point.y }]
          : []
      })
      const captions = [
        ...region.querySelectorAll<HTMLElement>('[data-cove-space-caption]'),
      ].flatMap(caption => {
        const captionRect = caption.getBoundingClientRect()
        const box = {
          left: captionRect.left,
          right: captionRect.right,
          top: captionRect.top,
          bottom: captionRect.bottom,
        }
        for (
          let ancestor: HTMLElement | null = caption;
          ancestor && ancestor !== region;
          ancestor = ancestor.parentElement
        ) {
          const paint = getComputedStyle(ancestor)
          if (
            ancestor.hidden ||
            paint.display === 'none' ||
            paint.visibility === 'hidden' ||
            paint.opacity === '0' ||
            paint.clipPath === 'inset(50%)'
          ) {
            return []
          }
          if (ancestor !== caption) {
            const bounds = ancestor.getBoundingClientRect()
            if (['hidden', 'clip', 'auto', 'scroll'].includes(paint.overflowX)) {
              box.left = Math.max(box.left, bounds.left)
              box.right = Math.min(box.right, bounds.right)
            }
            if (['hidden', 'clip', 'auto', 'scroll'].includes(paint.overflowY)) {
              box.top = Math.max(box.top, bounds.top)
              box.bottom = Math.min(box.bottom, bounds.bottom)
            }
          }
        }
        const regionTop = rect.top
        return box.right > box.left &&
          box.bottom > box.top &&
          box.top <= regionTop + Number.parseFloat(edge.borderTopWidth) * zoom &&
          box.bottom >= regionTop
          ? [{ kind: caption.dataset.coveSpaceCaption, left: box.left, right: box.right }]
          : []
      })
      const label = region.querySelector<HTMLElement>('[data-testid^="workspace-space-label-"]')!
      const branch = region.querySelector<HTMLElement>(
        '[data-testid^="workspace-space-worktree-branch-"]',
      )
      const branchStyle = branch ? getComputedStyle(branch) : null
      return {
        id: label.dataset.testid?.replace('workspace-space-label-', ''),
        label: (region as HTMLElement).dataset.coveLabelColor ?? null,
        identityColor: style.getPropertyValue('--cove-space-identity-color').trim(),
        defaultIdentityColor: style.getPropertyValue('--cove-pixel-cyan').trim(),
        fill: color(style.backgroundColor),
        background: style.backgroundImage,
        blur: style.backdropFilter,
        shadow: style.boxShadow,
        edge: {
          color: color(edge.borderTopColor),
          width: Number.parseFloat(edge.borderTopWidth),
          configuredScale: style.getPropertyValue('--cove-space-stroke-scale').trim(),
          actualScale: rect.width / (region as HTMLElement).offsetWidth,
          dpr: window.devicePixelRatio,
          clip: edge.clipPath,
          clipPoints,
          gaps,
          captions,
          preservesOtherEdges:
            clipPoints.some(
              point =>
                Math.abs(point.x - rect.width) <= 0.001 && Math.abs(point.y - rect.height) <= 0.001,
            ) &&
            clipPoints.some(
              point => Math.abs(point.x) <= 0.001 && Math.abs(point.y - rect.height) <= 0.001,
            ),
        },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        labelScreenFont:
          (Number.parseFloat(getComputedStyle(label).fontSize) *
            label.getBoundingClientRect().height) /
          label.offsetHeight,
        groups: [
          ...region.querySelectorAll<HTMLElement>('.workspace-space-region__label-group'),
        ].map(group => {
          const box = group.getBoundingClientRect()
          return { left: box.left, right: box.right, width: box.width }
        }),
        branch:
          branch && branchStyle
            ? {
                kind: branch.dataset.branchKind,
                value: branch.querySelector('.workspace-space-region__branch-badge-value')
                  ?.textContent,
                fill: color(branchStyle.backgroundColor),
                shadow: branchStyle.boxShadow,
                icon: Boolean(
                  branch.querySelector('.workspace-space-region__branch-icon[aria-hidden="true"]'),
                ),
              }
            : null,
      }
    }),
  )
}

/** Use ordinary mouse-mode pane dragging; restore after overview evidence. */
export async function centerIdentityCanvas(page: Page): Promise<() => Promise<void>> {
  const bounds = await page.locator('.workspace-canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect()
    const regions = [...canvas.querySelectorAll('.workspace-space-region')].map(region =>
      region.getBoundingClientRect(),
    )
    const left = Math.min(...regions.map(region => region.left))
    const right = Math.max(...regions.map(region => region.right))
    const top = Math.min(...regions.map(region => region.top))
    const bottom = Math.max(...regions.map(region => region.bottom))
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      dx: (rect.left + rect.right - left - right) / 2,
      dy: (rect.top + rect.bottom - top - bottom) / 2,
    }
  })
  const pan = async (dx: number, dy: number) => {
    const x = dx > 0 ? bounds.left + 4 : bounds.right - 4
    const y = dy > 0 ? bounds.top + 4 : bounds.bottom - 4
    await page.mouse.move(x, y)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(x + dx, y + dy, { steps: 8 })
    await page.mouse.up({ button: 'left' })
  }
  await pan(bounds.dx, bounds.dy)
  return () => pan(-bounds.dx, -bounds.dy)
}
