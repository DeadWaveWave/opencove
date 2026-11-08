import { expect, test } from '@playwright/test'
import { launchFrameSignals, setFrameMotion } from './workspace-canvas.frame-signals.helpers'
import { setMotionSignals } from './workspace-canvas.pixel-effects.helpers'

test('waiting frames pulse only opacity and retain static status with motion or signals off', async () => {
  const { window, node, send, close } = await launchFrameSignals()
  try {
    await send('<test-hook-initial-working>')
    await expect(node.locator('.terminal-node__status')).toContainText('Working')
    const workingRow = window.locator(
      '.workspace-agent-item--sidebar .workspace-agent-item__status--working',
    )
    await expect(workingRow).toContainText('Working')
    await expect(workingRow.locator('svg')).toHaveCount(0)
    const textColour = await workingRow.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--cove-accent-text)'
      el.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    await expect(workingRow).toHaveCSS('color', textColour)
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
    await setMotionSignals(window, false)
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

type FrameRecord = {
  signal: string
  transform: string
  color: string
  animations: Array<{ name: string; duration: number | string; frames: PropertyIndexedKeyframes[] }>
}
type ProbeWindow = Window & { __frameSignals?: FrameRecord[] }

for (const mode of ['animated', 'reduced', 'off'] as const) {
  test(`completion and failure retain their frame evidence (${mode})`, async ({
    browserName: _,
  }, testInfo) => {
    const { window, node, id, send, close } = await launchFrameSignals()
    try {
      await setFrameMotion(window, mode === 'reduced')
      if (mode === 'off') {
        await setMotionSignals(window, false)
      }
      await send('<test-hook-initial-working>')
      await expect(node.locator('.terminal-node')).toHaveAttribute(
        'data-agent-state-source',
        'claude_hook',
      )
      const transform = await node.evaluate(el => getComputedStyle(el).transform)
      await window.evaluate(nodeId => {
        const target = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)!
        const probe = window as ProbeWindow
        probe.__frameSignals = []
        new MutationObserver(() => {
          const signal = target.getAttribute('data-cove-signal')
          if (!signal) {
            return
          }
          probe.__frameSignals!.push({
            signal,
            transform: getComputedStyle(target).transform,
            color: getComputedStyle(target).getPropertyValue('--cove-signal-color').trim(),
            animations: target
              .getAnimations({ subtree: true })
              .filter(a => a instanceof CSSAnimation && a.animationName.startsWith('cove-signal-'))
              .map(a => ({
                name: (a as CSSAnimation).animationName,
                duration: a.effect!.getTiming().duration,
                frames: (a.effect as KeyframeEffect).getKeyframes(),
              })),
          })
        }).observe(target, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ['data-cove-signal'],
        })
      }, id)
      const records = () => window.evaluate(() => (window as ProbeWindow).__frameSignals ?? [])
      await send('<test-hook-done>')
      await expect(node.locator('.terminal-node__status')).toContainText('Standby')
      if (mode !== 'off') {
        const name = mode === 'reduced' ? 'cove-signal-complete-static' : 'cove-signal-complete'
        await expect
          .poll(async () => (await records()).flatMap(r => r.animations).map(a => a.name))
          .toContain(name)
        const glyph = await node.evaluate(el =>
          getComputedStyle(el).getPropertyValue('--cove-kind-ai-glyph').trim(),
        )
        expect((await records()).find(r => r.signal === 'complete')?.color).toBe(glyph)
        const flash = (await records()).flatMap(r => r.animations).find(a => a.name === name)!
        expect(flash.duration).toBe(mode === 'reduced' ? 600 : 1000)
        expect(flash.frames.map(f => f.opacity)).toEqual(
          mode === 'reduced' ? ['0.9', '0'] : ['1', '0'],
        )
      }
      await expect(node).not.toHaveAttribute('data-cove-signal')
      await expect(node.locator('.cove-window-flash')).toHaveCount(0)
      await send('<test-frame-fail>')
      await expect(node).toHaveAttribute('data-cove-window-status', 'failed')
      if (mode === 'animated') {
        await expect
          .poll(async () => (await records()).flatMap(r => r.animations).map(a => a.name))
          .toContain('cove-signal-fail')
        const glitch = (await records())
          .flatMap(r => r.animations)
          .find(a => a.name === 'cove-signal-fail')!
        expect(glitch.duration).toBe(280)
        expect(glitch.frames.map(f => f.translate)).toEqual([
          '-5px',
          '4px',
          '-3px',
          '3px',
          '-2px',
          'none',
        ])
        expect(glitch.frames.map(f => f.clipPath)).toEqual([
          'inset(8% 0px 58%)',
          'inset(48% 0px 22%)',
          'inset(0px 0px 72%)',
          'inset(70% 0px 4%)',
          'inset(30% 0px 40%)',
          'inset(0px)',
        ])
      } else if (mode === 'off') {
        expect(await records()).toEqual([])
      } else {
        await expect.poll(async () => (await records()).map(r => r.signal)).toContain('fail')
        expect(
          (await records()).filter(r => r.signal === 'fail').flatMap(r => r.animations),
        ).toEqual([])
      }
      expect((await records()).every(r => r.transform === transform)).toBe(true)
      await expect(node).not.toHaveAttribute('data-cove-signal')
      await expect(node).toHaveAttribute('data-cove-window-status', 'failed')
    } finally {
      await testInfo.attach('frame-signals', {
        body: JSON.stringify(
          await window.evaluate(() => (window as ProbeWindow).__frameSignals ?? []),
        ),
        contentType: 'application/json',
      })
      await close()
    }
  })
}
