import { describe, expect, it } from 'vitest'
import { buildElectronViteDevEnv } from '../../../scripts/run-electron-vite-dev.mjs'

describe('run-electron-vite-dev', () => {
  it('removes Electron-as-Node control env before launching the desktop app', () => {
    const env = buildElectronViteDevEnv({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--trace-warnings',
      PATH: '/usr/bin',
    })

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBe('--trace-warnings')
    expect(env.PATH).toBe('/usr/bin')
  })
})
