import { expect, it } from 'vitest'
import { reviveRendererAppError } from '@shared/errors/rendererAppError'
import { pluginErrorMessage } from '@contexts/plugins/presentation/renderer/pluginErrorMessage'
it.each([
  'Plugin requires OpenCove >=999.0.0',
  'Deliberate invalid candidate',
  'Preview cannot access filesystem operations.',
])('preserves plugin author diagnostics through revival: %s', debugMessage => {
  const error = reviveRendererAppError({ code: 'plugin.operation_failed', debugMessage })
  expect(pluginErrorMessage(error)).toBe(debugMessage)
  expect((error as { debugMessage?: string }).debugMessage).toBe(debugMessage)
})
it('bounds diagnostics and falls back to the catalog for absent or unrecognized errors', () => {
  expect(
    pluginErrorMessage(
      reviveRendererAppError({ code: 'plugin.operation_failed', debugMessage: 'x'.repeat(3000) }),
    ),
  ).toHaveLength(2000)
  expect(pluginErrorMessage(reviveRendererAppError({ code: 'plugin.operation_failed' }))).toBe(
    'Plugin operation failed.',
  )
  expect(pluginErrorMessage({ debugMessage: 'SECRET' })).toBe('Plugin operation failed.')
})
it('never restores OpenCove internal debug text', () => {
  const error = reviveRendererAppError({ code: 'worker.unavailable', debugMessage: 'SECRET' })
  expect(pluginErrorMessage(error)).toBe('Worker is unavailable.')
  expect(JSON.stringify(error)).not.toContain('SECRET')
})
it('rejects a credential-bearing Git source before a subprocess can echo it in plugin diagnostics', async () => {
  const { gitInstallInput } =
    await import('@shared/contracts/controlSurface/operations/pluginDistributionInput')
  expect(() =>
    gitInstallInput({ repository: 'ssh://git:PRIVATE_SSH_PASSWORD@example.test/repo.git' }),
  ).toThrow('do not embed credentials')
  expect(gitInstallInput({ repository: 'ssh://git@example.test/repo.git' }).repository).toBe(
    'ssh://git@example.test/repo.git',
  )
})
