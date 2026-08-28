import { readFile, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalAgentTelemetryAssetStore } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

const stores: TerminalAgentTelemetryAssetStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async store => await store.dispose()))
})

describe('terminal Agent private telemetry assets', () => {
  it('places Windows invocation plans under the private asset root with finally-owned cleanup', async () => {
    const store = new TerminalAgentTelemetryAssetStore({
      runtimeExecutable: 'C:\\Program Files\\OpenCove\\OpenCove.exe',
      platform: 'win32',
    })
    stores.push(store)
    const assets = await store.ensure()
    const script = await readFile(`${assets.shimDirectory}/codex.ps1`, 'utf8')

    expect(relative(assets.rootDirectory, assets.planDirectory)).not.toMatch(/^\.\./u)
    expect((await stat(assets.planDirectory)).mode & 0o777).toBe(0o700)
    expect(script).toContain(assets.planDirectory)
    expect(script).not.toContain('GetTempFileName')
    expect(script).toContain('try {')
    expect(script).toContain('finally {')
    expect(script.indexOf('if ($null -eq $originalElectronRunAsNode)')).toBeLessThan(
      script.indexOf('foreach ($property in $plan.env.PSObject.Properties)'),
    )
    expect(script.indexOf('foreach ($property in $plan.env.PSObject.Properties)')).toBeLessThan(
      script.indexOf('& $plan.executable'),
    )
    expect(script.indexOf('--complete-windows')).toBeGreaterThan(script.indexOf('finally {'))
  })
})
