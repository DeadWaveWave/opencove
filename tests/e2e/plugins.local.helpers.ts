import { expect, type Frame, type Locator, type Page, type TestInfo } from '@playwright/test'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { seededWorkspaceId } from './workspace-canvas.helpers'

export const pluginId = 'hello-clock'
export const actionBarId = `workspace-canvas-action-bar-new-plugin:${pluginId}`

export async function copyPluginFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'opencove-installed-plugin-'))
  await cp(resolve(__dirname, '../../docs/plugins/examples/hello-clock'), directory, {
    recursive: true,
  })
  return directory
}

export async function pluginCommand(
  page: Page,
  id: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return await page.evaluate(
    async input => {
      try {
        return await window.opencoveApi.controlSurface.invoke({ kind: 'command', ...input })
      } catch (cause) {
        const descriptor =
          cause && typeof cause === 'object'
            ? (cause as { debugMessage?: string; message?: string })
            : null
        throw new Error(descriptor?.debugMessage ?? descriptor?.message ?? String(cause), { cause })
      }
    },
    { id, payload },
  )
}

export async function installPlugin(page: Page, directory: string): Promise<void> {
  await pluginCommand(page, 'plugin.install', { directory })
  await expect(page.getByTestId(actionBarId)).toBeVisible({ timeout: 10_000 })
}

export async function createPluginNode(page: Page): Promise<Locator> {
  await page.getByTestId(actionBarId).click()
  const node = page
    .locator('.workspace-main .react-flow__node')
    .filter({ has: page.getByTestId(`plugin-view-${pluginId}`) })
    .last()
  await expect(node.frameLocator('iframe').locator('#invoke')).toBeEnabled({ timeout: 15_000 })
  const nodeId = await node.getAttribute('data-id')
  return page.locator(`.workspace-main .react-flow__node[data-id="${nodeId}"]`)
}

export async function openLocalDetails(page: Page): Promise<Locator> {
  await page.getByTestId('app-header-settings').click()
  await page.getByTestId('settings-section-nav-plugins').click()
  await page.getByTestId(`settings-plugin-details-${pluginId}`).click()
  const detail = page.getByTestId(`settings-plugin-detail-${pluginId}`)
  await expect(detail).toBeVisible()
  return detail
}

type PointerPoint = { x: number; y: number }

async function toPagePoint(frame: Frame, point: PointerPoint): Promise<PointerPoint> {
  const parent = frame.parentFrame()
  if (!parent) {
    return point
  }
  const iframe = await frame.frameElement()
  try {
    const transformed = await iframe.evaluate((element, local) => {
      const frameElement = element as HTMLIFrameElement
      const bounds = frameElement.getBoundingClientRect()
      return {
        x:
          bounds.x +
          (frameElement.clientLeft + local.x) * (bounds.width / frameElement.offsetWidth),
        y:
          bounds.y +
          (frameElement.clientTop + local.y) * (bounds.height / frameElement.offsetHeight),
      }
    }, point)
    return await toPagePoint(parent, transformed)
  } finally {
    await iframe.dispose()
  }
}

async function scrollFrameIntoView(frame: Frame): Promise<void> {
  const parent = frame.parentFrame()
  if (!parent) {
    return
  }
  // An offscreen OOPIF can suspend its RAF. Bring each containing frame into view
  // from the outside in before asking its child control to wait for stable layout.
  await scrollFrameIntoView(parent)
  const iframe = await frame.frameElement()
  try {
    await iframe.scrollIntoViewIfNeeded({ timeout: 2_000 })
  } finally {
    await iframe.dispose()
  }
}

async function pluginControlPoint(control: Locator): Promise<PointerPoint> {
  const element = await control.elementHandle()
  if (!element) {
    throw new Error('Plugin control is no longer attached')
  }
  try {
    const frame = await element.ownerFrame()
    if (!frame) {
      throw new Error('Plugin control frame is no longer attached')
    }
    await scrollFrameIntoView(frame)
    await control.scrollIntoViewIfNeeded({ timeout: 2_000 })
    const point = await element.evaluate(target => {
      const bounds = target.getBoundingClientRect()
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    })
    return await toPagePoint(frame, point)
  } finally {
    await element.dispose()
  }
}

export async function clickPluginControl(control: Locator): Promise<void> {
  await expect(control).toBeEnabled()
  let point: PointerPoint | undefined
  // Playwright 1.58 adds an OOPIF's origin to child coordinates without its CSS
  // scale. Near the preview edge this can target the host's resize handle. Map
  // the actual child center through each frame's rendered bounds instead.
  // Still require a real child hover before one real click; do not bypass overlays.
  await expect
    .poll(
      async () => {
        point = await pluginControlPoint(control)
        await control.page().mouse.move(0, 0)
        await control.page().mouse.move(point.x, point.y)
        return control.evaluate(element => element.matches(':hover'))
      },
      { message: 'Plugin control receives a real pointer before clicking', timeout: 10_000 },
    )
    .toBe(true)
  await control.page().mouse.click(point!.x, point!.y)
}

export async function invokeClock(node: Locator): Promise<string> {
  const frame = node.frameLocator('iframe')
  await clickPluginControl(frame.locator('#invoke'))
  await expect(frame.locator('#backend-result'))
    .toHaveAttribute('data-startup-id', /.+/)
    .catch(async cause => {
      throw new Error(
        `${String(cause)}\nPlugin status: ${await frame.locator('#status').textContent()}`,
        { cause },
      )
    })
  await expect(frame.locator('#backend-result')).toHaveAttribute(
    'data-platform',
    /darwin|linux|win32/,
  )
  return (await frame.locator('#backend-result').getAttribute('data-startup-id'))!
}

export async function savedPluginNodes(page: Page): Promise<unknown[]> {
  return await page.evaluate(async workspaceId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      workspaces?: Array<{ id: string; nodes: Array<{ kind: string }> }>
    }
    return (
      state.workspaces
        ?.find(workspace => workspace.id === workspaceId)
        ?.nodes.filter(node => node.kind === 'plugin') ?? []
    )
  }, seededWorkspaceId)
}

export async function capturePlugins(page: Page, info: TestInfo, name: string): Promise<void> {
  const screenshot = info.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot })
  await info.attach(name, { path: screenshot, contentType: 'image/png' })
}
