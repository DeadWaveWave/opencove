import { expect, type Page } from '@playwright/test'
import type { PixelEffectSettings } from '../../src/contexts/settings/domain/agentSettings'

export const PIXEL_EFFECTS_ENABLED: PixelEffectSettings = {
  agentWorkingPixelEffectEnabled: true,
  nodeCreationPixelEffectEnabled: true,
  nodeClosePixelEffectEnabled: true,
  canvasPixelBackgroundEnabled: true,
}
export const PIXEL_EFFECTS_DISABLED: PixelEffectSettings = {
  agentWorkingPixelEffectEnabled: false,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
  canvasPixelBackgroundEnabled: false,
}
export const EFFECT_CONTROL_IDS: Record<keyof PixelEffectSettings, string> = {
  agentWorkingPixelEffectEnabled: 'settings-agent-working-pixel-effect',
  nodeCreationPixelEffectEnabled: 'settings-node-creation-pixel-effect',
  nodeClosePixelEffectEnabled: 'settings-node-close-pixel-effect',
  canvasPixelBackgroundEnabled: 'settings-canvas-pixel-background',
}

export async function openPixelAppearance(page: Page) {
  await page.getByTestId('app-header-settings').click({ noWaitAfter: true })
  await page.getByTestId('settings-section-nav-appearance').click()
}

export async function setPixelEffect(page: Page, key: keyof PixelEffectSettings, enabled: boolean) {
  const control = page.getByTestId(EFFECT_CONTROL_IDS[key])
  await control.scrollIntoViewIfNeeded()
  await control.setChecked(enabled)
  await expect(control).toHaveJSProperty('checked', enabled)
}

export async function setPixelEffects(page: Page, effects: PixelEffectSettings) {
  await setPixelEffect(
    page,
    'agentWorkingPixelEffectEnabled',
    effects.agentWorkingPixelEffectEnabled,
  )
  await setPixelEffect(
    page,
    'nodeCreationPixelEffectEnabled',
    effects.nodeCreationPixelEffectEnabled,
  )
  await setPixelEffect(page, 'nodeClosePixelEffectEnabled', effects.nodeClosePixelEffectEnabled)
  await setPixelEffect(page, 'canvasPixelBackgroundEnabled', effects.canvasPixelBackgroundEnabled)
}

export async function readPixelEffects(page: Page) {
  return await page.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = raw ? (JSON.parse(raw) as { settings?: Partial<PixelEffectSettings> }) : null
    return {
      agentWorkingPixelEffectEnabled: state?.settings?.agentWorkingPixelEffectEnabled,
      nodeCreationPixelEffectEnabled: state?.settings?.nodeCreationPixelEffectEnabled,
      nodeClosePixelEffectEnabled: state?.settings?.nodeClosePixelEffectEnabled,
      canvasPixelBackgroundEnabled: state?.settings?.canvasPixelBackgroundEnabled,
    }
  })
}

type EffectObservation = { kind: string; focused: boolean; masked: boolean; rim: boolean }
type ProbeWindow = Window & {
  __pixelEffectProbe?: {
    created: Record<string, EffectObservation>
    bursts: string[]
    stop: () => void
  }
}

/** Read-only RAF observation catches the brief real rim without delaying product time. */
export async function installPixelEffectProbe(page: Page) {
  await page.evaluate(() => {
    const target = window as ProbeWindow
    const original = new Set(
      Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).map(
        node => node.dataset.id,
      ),
    )
    let frame = 0
    const probe = {
      created: {} as Record<string, EffectObservation>,
      bursts: [] as string[],
      stop: () => cancelAnimationFrame(frame),
    }
    target.__pixelEffectProbe = probe
    const observe = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="workspace-pixel-assembly"]',
      )
      const context = canvas?.getContext('2d')
      const canvasRect = canvas?.getBoundingClientRect()
      for (const node of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = node.dataset.id
        if (!id || original.has(id)) {
          continue
        }
        const kind = node.querySelector('.terminal-node')
          ? 'terminal'
          : node.querySelector('.note-node')
            ? 'note'
            : 'other'
        const record = (probe.created[id] ??= { kind, focused: false, masked: false, rim: false })
        record.focused ||= node.contains(document.activeElement)
        const style = getComputedStyle(node)
        const front = Number.parseFloat(style.getPropertyValue('--cove-pixel-reveal-front'))
        record.masked ||= style.maskImage !== 'none'
        if (
          record.rim ||
          !canvas ||
          !context ||
          !canvasRect?.width ||
          front <= 0.1 ||
          front >= 0.9 ||
          !Number.isFinite(front)
        ) {
          continue
        }
        const rect = node.getBoundingClientRect()
        const scale = canvas.width / canvasRect.width
        const x = Math.floor((rect.x - canvasRect.x - 5) * scale)
        const y = Math.max(0, Math.floor((rect.y - canvasRect.y + 12) * scale))
        const width = Math.ceil(5 * scale)
        const height = Math.min(canvas.height - y, Math.floor((rect.height - 24) * scale))
        if (x >= 0 && x + width <= canvas.width && height > 0) {
          record.rim = context
            .getImageData(x, y, width, height)
            .data.some((value, index) => index % 4 === 3 && value > 8)
        }
      }
      if (canvas?.dataset.covePixelBurst === 'bursting') {
        for (const id of (canvas.dataset.covePixelBurstNodeIds ?? '').split(',')) {
          if (
            id &&
            !probe.bursts.includes(id) &&
            !document.querySelector(`.react-flow__node[data-id="${id}"]`)
          ) {
            probe.bursts.push(id)
          }
        }
      }
      frame = requestAnimationFrame(observe)
    }
    frame = requestAnimationFrame(observe)
  })
}

export async function readPixelEffectProbe(page: Page) {
  return await page.evaluate(() => {
    const probe = (window as ProbeWindow).__pixelEffectProbe
    return { created: probe?.created ?? {}, bursts: probe?.bursts ?? [] }
  })
}

export async function stopPixelEffectProbe(page: Page) {
  await page.evaluate(() => (window as ProbeWindow).__pixelEffectProbe?.stop())
}
