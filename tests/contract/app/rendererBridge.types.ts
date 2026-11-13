import type { OpenCoveApi } from '../../../src/app/preload/api'
import type {
  OpenCoveBridgeApi,
  RendererBridgeResult,
} from '../../../src/shared/contracts/rendererBridge'
import type { FileSystemStat } from '../../../src/shared/contracts/dto'

declare const api: OpenCoveApi
declare const bridge: OpenCoveBridgeApi<OpenCoveApi>
declare const file: File
const { invoke } = api.controlSurface
const { invoke: invokeTransport } = bridge.controlSurface
const request = { kind: 'query' as const, id: 'node.get', payload: { nodeId: 'missing' } }
const value: Promise<{ answer: number }> = invoke<{ answer: number }>(request)
const envelope: Promise<RendererBridgeResult<{ answer: number }>> = invokeTransport<{
  answer: number
}>(request)
const path: string = api.filesystem.getPathForFile(file)
const bounds: void = api.websiteWindow.setBounds({} as never)
const optional: Promise<RendererBridgeResult<FileSystemStat | null>> | undefined =
  bridge.filesystem.resolveDroppedFile?.(file)
void [value, envelope, path, bounds, optional]
