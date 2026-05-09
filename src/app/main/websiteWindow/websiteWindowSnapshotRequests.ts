import type {
  CaptureWebsiteWindowSnapshotInput,
  WebsiteWindowEventPayload,
} from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import {
  normalizeWebsiteWindowSnapshotQuality,
  requestWebsiteWindowRuntimeSnapshot,
} from './websiteWindowRuntimeViewOps'

export function applyPendingWebsiteWindowSnapshotRequest({
  runtime,
  pendingSnapshotQualityByNodeId,
}: {
  runtime: WebsiteWindowRuntime
  pendingSnapshotQualityByNodeId: Map<string, number>
}): void {
  const pendingSnapshotQuality = pendingSnapshotQualityByNodeId.get(runtime.nodeId) ?? null
  if (pendingSnapshotQuality === null) {
    return
  }

  runtime.pendingSnapshotQuality = pendingSnapshotQuality
  pendingSnapshotQualityByNodeId.delete(runtime.nodeId)
}

export function captureWebsiteWindowSnapshotRequest({
  payload,
  runtimeByNodeId,
  pendingSnapshotQualityByNodeId,
  emit,
}: {
  payload: CaptureWebsiteWindowSnapshotInput
  runtimeByNodeId: Map<string, WebsiteWindowRuntime>
  pendingSnapshotQualityByNodeId: Map<string, number>
  emit: (payload: WebsiteWindowEventPayload) => void
}): void {
  const nodeId = typeof payload?.nodeId === 'string' ? payload.nodeId.trim() : ''
  if (nodeId.length === 0) {
    return
  }

  const quality = normalizeWebsiteWindowSnapshotQuality(payload.quality)
  const runtime = runtimeByNodeId.get(nodeId) ?? null
  if (!runtime) {
    pendingSnapshotQualityByNodeId.set(nodeId, quality)
    return
  }

  requestWebsiteWindowRuntimeSnapshot({
    runtime,
    quality,
    emit,
  })
}
