import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadConfigFromFile } from 'electron-vite'
import { createServer, normalizePath, type ViteDevServer } from 'vite'
import { createRuntimeBuildIdentity } from '../../scripts/lib/runtime-build-identity'
import { launchApp } from './workspace-canvas.app'

test('loads the Windows desktop through the Vite development server with an embedded build', async () => {
  test.skip(process.platform !== 'win32', 'Windows development path regression')
  test.setTimeout(120_000)
  const root = resolve(__dirname, '../..')
  const cacheDir = await mkdtemp(join(tmpdir(), 'opencove-vite-runtime-build-'))
  let server: ViteDevServer | undefined
  let app: ElectronApplication | undefined
  try {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      resolve(root, 'electron.vite.config.ts'),
    )
    server = await createServer({
      ...loaded.config.renderer,
      configFile: false,
      cacheDir,
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing Vite TCP address')
    }
    const origin = `http://127.0.0.1:${address.port}`
    const launched = await launchApp({ env: { ELECTRON_RENDERER_URL: origin } })
    app = launched.electronApp
    const window = launched.window
    const pageErrors: string[] = []
    window.on('pageerror', error => pageErrors.push(error.message))
    await expect(window.locator('[data-testid="app-header-settings"]')).toBeVisible({
      timeout: 60_000,
    })
    expect(new URL(window.url()).origin).toBe(origin)
    const identityUrl = `/@fs/${normalizePath(resolve(root, 'src/shared/runtime/runtimeBuildIdentity.ts'))}`
    const identity = await window.evaluate(async url => {
      const module = await import(url)
      return module.getRuntimeBuildIdentity()
    }, identityUrl)
    expect(identity).toEqual(createRuntimeBuildIdentity(root, true))
    await window.reload()
    await expect(window.locator('.workspace-main')).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await app?.close()
    await server?.close()
    await rm(cacheDir, { recursive: true, force: true })
  }
})
