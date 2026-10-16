import { expect, test, type Page } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const nodeId = 'terminal-transparency'

async function runInTerminal(page: Page, source: string): Promise<void> {
  const terminal = page.locator('.terminal-node').first()
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type(buildNodeEvalCommand(source))
  await page.keyboard.press('Enter')
}

async function readMarkedValue(page: Page, marker: string, source: string): Promise<string> {
  await runInTerminal(page, source)
  const terminal = page.locator('.terminal-node').first()
  await expect(terminal).toContainText(`${marker}=`, { timeout: 15_000 })
  const text = (await terminal.textContent()) ?? ''
  // xterm's text runs rows together, so values end with `;`.
  const match = text.match(new RegExp(`${marker}=([\\w:/]+);`))
  if (!match) {
    throw new Error(`Missing terminal marker ${marker}`)
  }
  return match[1]!
}

async function readShellPid(page: Page, marker: string): Promise<string> {
  return await readMarkedValue(
    page,
    marker,
    `process.stdout.write(${JSON.stringify(marker)} + '=' + String(process.ppid) + ';\\n')`,
  )
}

async function readBackground(page: Page) {
  const xterm = await page.evaluate(
    id => window.__opencoveTerminalSelectionTestApi?.getBackground(id) ?? null,
    nodeId,
  )
  const dom = await page
    .locator('.terminal-node')
    .first()
    .evaluate(node => {
      const body = node.querySelector<HTMLElement>('.terminal-node__body')!
      return {
        mode: body.dataset.coveTerminalBackground,
        terminal: getComputedStyle(node.querySelector('.terminal-node__terminal')!).backgroundColor,
        plate: getComputedStyle(body).backgroundImage,
        token: getComputedStyle(node).getPropertyValue('--cove-terminal-background').trim(),
      }
    })
  return { ...dom, xterm }
}

test('terminal text sits on the reading plate and switching keeps the shell', async () => {
  const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })
  try {
    // CI's macOS virtual machines run with Reduce Transparency switched on.
    const session = await window.context().newCDPSession(window)
    const emulateTransparency = (value: 'no-preference' | 'reduce') =>
      session.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-transparency', value }],
      })
    await emulateTransparency('no-preference')

    await clearAndSeedWorkspace(
      window,
      [{ id: nodeId, title: nodeId, position: { x: 120, y: 120 }, width: 560, height: 320 }],
      { settings: { terminalBackground: 'transparent' } },
    )
    await expect(window.locator('.terminal-node')).toHaveCount(1)

    await expect.poll(async () => (await readBackground(window)).mode).toBe('transparent')
    const transparent = await readBackground(window)
    expect(transparent.terminal).toBe('rgba(0, 0, 0, 0)')
    expect(transparent.plate).toContain('linear-gradient')
    expect(transparent.xterm?.allowTransparency).toBe(true)
    expect(transparent.xterm?.background).toMatch(/^rgba\(\d+, \d+, \d+, 0\)$/)

    // TUI programs asking for the background hear the colour the text sits on.
    const reply = await readMarkedValue(
      window,
      'OSC11',
      [
        'process.stdin.setRawMode(true)',
        "process.stdin.once('data', d => { const m = d.toString().match(/rgb:[0-9a-f/]+/i); process.stdout.write('OSC11=' + (m ? m[0] : 'none') + ';\\n'); process.exit(0) })",
        "setTimeout(() => { process.stdout.write('OSC11=none;\\n'); process.exit(0) }, 3000)",
        "process.stdout.write('\\x1b]11;?\\x07')",
      ].join(';'),
    )
    const hex = transparent.token.replace('#', '')
    expect(reply.toLowerCase()).toBe(
      `rgb:${hex.slice(0, 2)}${hex.slice(0, 2)}/${hex.slice(2, 4)}${hex.slice(2, 4)}/${hex.slice(4, 6)}${hex.slice(4, 6)}`,
    )

    const shellBefore = await readShellPid(window, 'SHELL_BEFORE')
    await runInTerminal(window, "process.stdout.write('KEEP_' + 'THIS_LINE\\n')")
    await expect(window.locator('.terminal-node')).toContainText('KEEP_THIS_LINE')

    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-terminal').click()
    await window.getByTestId('settings-terminal-background-opaque').click()
    await window.locator('.settings-panel__close').click()

    await expect.poll(async () => (await readBackground(window)).mode).toBe('opaque')
    const opaque = await readBackground(window)
    expect(opaque.terminal).not.toBe('rgba(0, 0, 0, 0)')
    expect(opaque.xterm?.allowTransparency).toBe(false)
    expect(opaque.xterm?.background).toBe(opaque.token)
    await expect(window.locator('.terminal-node')).toContainText('KEEP_THIS_LINE')
    expect(await readShellPid(window, 'SHELL_AFTER')).toBe(shellBefore)

    // Back to transparent; the system preference then covers the plate without recreating xterm.
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-terminal').click()
    await window.getByTestId('settings-terminal-background-transparent').click()
    await window.locator('.settings-panel__close').click()
    await expect.poll(async () => (await readBackground(window)).mode).toBe('transparent')
    const shellTransparent = await readShellPid(window, 'SHELL_TRANSPARENT')
    const instance = (await readBackground(window)).xterm?.instanceId
    expect(instance).toEqual(expect.any(Number))
    await emulateTransparency('reduce')
    await expect
      .poll(async () => (await readBackground(window)).terminal)
      .not.toBe('rgba(0, 0, 0, 0)')
    const reduced = await readBackground(window)
    expect(reduced.mode).toBe('transparent')
    expect(reduced.xterm?.allowTransparency).toBe(true)
    expect(reduced.xterm?.instanceId).toBe(instance)
    expect(await readShellPid(window, 'SHELL_REDUCED')).toBe(shellTransparent)
    await expect(window.locator('.terminal-node')).toContainText('KEEP_THIS_LINE')
  } finally {
    await electronApp.close()
  }
})
