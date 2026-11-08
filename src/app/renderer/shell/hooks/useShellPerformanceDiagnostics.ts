import { useMemo } from 'react'
import { resolvePerformanceStatus } from '@app/renderer/performanceDiagnostics/performanceDiagnosticsFormatting'
import { usePerformanceIncidentRecorder } from '@app/renderer/performanceDiagnostics/performanceIncidentRecorder'
import {
  useRendererDomSampler,
  useRendererFrameSampler,
  useRendererMemoryTrend,
} from '@app/renderer/performanceDiagnostics/rendererDiagnosticsSampling'

/** The renderer's samples, the status they add up to, and the incidents recorded from it. */
export function useShellPerformanceDiagnostics() {
  const rendererSnapshot = useRendererDomSampler()
  const frameSnapshot = useRendererFrameSampler()
  const memoryTrend = useRendererMemoryTrend(rendererSnapshot)
  const performanceStatus = useMemo(
    () =>
      resolvePerformanceStatus({
        frames: frameSnapshot,
        dom: rendererSnapshot,
        memoryTrend,
      }),
    [frameSnapshot, memoryTrend, rendererSnapshot],
  )
  const performanceIncidents = usePerformanceIncidentRecorder({
    status: performanceStatus,
    frameSnapshot,
    rendererSnapshot,
    memoryTrend,
  })
  return { rendererSnapshot, frameSnapshot, memoryTrend, performanceStatus, performanceIncidents }
}
