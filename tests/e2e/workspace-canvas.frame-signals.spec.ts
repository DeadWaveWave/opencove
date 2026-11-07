import { expect, test } from '@playwright/test'
import { launchFrameSignals, setFrameMotion } from './workspace-canvas.frame-signals.helpers'

test('waiting frames pulse only opacity and retain static status with motion or signals off', async () => {
  const { window, node, send, close } = await launchFrameSignals()
  try {
    await send('<test-hook-initial-working>')
    await expect(node.locator('.terminal-node__status')).toContainText('Working')
    await expect(node.locator('.cove-window-halo')).toHaveCount(0)
    await send('<test-hook-waiting>')
    await expect(node).toHaveAttribute('data-cove-window-status', 'waiting')
    const halo = node.locator('.cove-window-halo')
    await expect(halo).toHaveCSS('animation-name', 'cove-waiting-halo')
    await expect(halo).toHaveCSS('animation-duration', '1.3s')
    await expect(halo).toHaveCSS('pointer-events', 'none')
    const border = await node.locator('.terminal-node').evaluate(el => {
      const probe = document.createElement('span')
      probe.style.color =
        'color-mix(in srgb, var(--cove-status-waiting, var(--cove-warning)) 70%, var(--cove-node-border))'
      el.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    await expect(node.locator('.terminal-node')).toHaveCSS('border-color', border)
    await setFrameMotion(window, true)
    await expect(halo).toHaveCSS('animation-name', 'none')
    await expect(halo).toHaveCSS('opacity', '0.8')
    await setFrameMotion(window, false)
    await window.getByTestId('app-header-control-center').click()
    await window.getByTestId('control-center-toggle-motion-signals').uncheck()
    await window.keyboard.press('Escape')
    await expect(halo).toHaveCSS('animation-name', 'none')
    await expect(halo).toHaveCSS('opacity', '0.8')
    await expect(node.locator('.terminal-node')).toHaveCSS('border-color', border)
    await send('<test-frame-fail>')
    await expect(node).toHaveAttribute('data-cove-window-status', 'failed')
    await expect(halo).toHaveCount(0)
    await expect(node).not.toHaveAttribute('data-cove-signal')
    const failed = await node.locator('.terminal-node').evaluate(el => {
      const style = getComputedStyle(el)
      const probe = document.createElement('span')
      probe.style.color = 'var(--cove-status-failed, var(--cove-danger))'
      el.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return { border: style.borderColor, color }
    })
    await expect(node.locator('.terminal-node')).toHaveCSS('border-color', failed.color)
  } finally {
    await close()
  }
})
