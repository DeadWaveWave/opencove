import { expect, it } from 'vitest'
import { rendererBridgeViolations } from '../lib/renderer-bridge-rules.mjs'
const config = {
  id: 'architecture.rendererBridgeBoundary',
  severity: 'error',
  clients: ['src/app/renderer/bootstrap/installDesktopOpenCoveApi.ts'],
}
const file = 'src/contexts/workspace/presentation/renderer/view.ts'
it.each([
  'window.__opencoveBridge',
  'window["__opencoveBridge"]',
  'const key = "__opencoveBridge"; const bridge = window[key]',
  'result.__opencoveRendererBridge',
  'import { getAppErrorDebugMessage as readDebug } from "@shared/errors/appError"',
  'const expose = contextBridge.exposeInMainWorld; expose("opencoveApi", api)',
  'const { __opencoveBridge: bridge } = window; bridge.pty.write()',
  'const w = window; const bridge = w.__opencoveBridge',
  'const { debugMessage: text } = error',
  'error["debugMessage"]',
  'const tag = "__opencoveRendererBridge"',
  'contextBridge.exposeInMainWorld("opencoveApi", api)',
  'contextBridge.exposeInMainWorld("__opencoveBridge", api)',
])('rejects raw bridge or diagnostic access: %s', source => {
  expect(rendererBridgeViolations(file, source, config).length).toBeGreaterThan(0)
})
it('permits native local errors and the approved wrapped exposure', () => {
  expect(
    rendererBridgeViolations(
      file,
      'if (error instanceof DOMException) handle(error.code); if (error instanceof TypeError) fix()',
      config,
    ),
  ).toEqual([])
  expect(
    rendererBridgeViolations(
      'src/app/preload/index.ts',
      'const bridge = createRendererBridge(api); contextBridge.exposeInMainWorld("__opencoveBridge", bridge)',
      config,
    ),
  ).toEqual([])
  expect(rendererBridgeViolations(config.clients[0], 'window.__opencoveBridge', config)).toEqual([])
})
it('allows only the explicit plugin diagnostic formatter to read author diagnostics', () => {
  const scoped = {
    ...config,
    pluginDiagnosticFormatters: [
      'src/contexts/plugins/presentation/renderer/pluginErrorMessage.ts',
    ],
  }
  expect(
    rendererBridgeViolations(
      scoped.pluginDiagnosticFormatters[0],
      'descriptor.debugMessage',
      scoped,
    ),
  ).toEqual([])
  expect(rendererBridgeViolations(file, 'descriptor.debugMessage', scoped)).toHaveLength(1)
})
