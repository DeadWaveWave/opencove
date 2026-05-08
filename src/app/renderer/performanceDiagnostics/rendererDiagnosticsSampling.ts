import { useCallback, useEffect, useRef, useState } from 'react'
import type { PerformanceDiagnosticsSnapshotResult } from '@shared/contracts/dto'

export interface RendererDomSnapshot {
  domNodeCount: number
  terminalNodeCount: number
  xtermInstanceCount: number
  terminalCanvasCount: number
  jsHeapUsedBytes: number | null
  jsHeapTotalBytes: number | null
}

export interface RendererFrameSnapshot {
  sampleCount: number
  frameP95Ms: number | null
  frameMaxMs: number | null
  longTaskCount: number
  longTaskTotalMs: number
}

export interface RendererMemoryTrendSnapshot {
  sampleCount: number
  durationMs: number
  baselineJsHeapUsedBytes: number | null
  currentJsHeapUsedBytes: number | null
  deltaJsHeapUsedBytes: number | null
  deltaPercent: number | null
  isGrowing: boolean
}

export interface PerformanceDiagnosticsSnapshotState {
  snapshot: PerformanceDiagnosticsSnapshotResult | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  refreshSnapshot: () => Promise<void>
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize?: number
    totalJSHeapSize?: number
  }
}

const EMPTY_FRAME_SNAPSHOT: RendererFrameSnapshot = {
  sampleCount: 0,
  frameP95Ms: null,
  frameMaxMs: null,
  longTaskCount: 0,
  longTaskTotalMs: 0,
}

const EMPTY_MEMORY_TREND: RendererMemoryTrendSnapshot = {
  sampleCount: 0,
  durationMs: 0,
  baselineJsHeapUsedBytes: null,
  currentJsHeapUsedBytes: null,
  deltaJsHeapUsedBytes: null,
  deltaPercent: null,
  isGrowing: false,
}

const MEMORY_GROWTH_MIN_DURATION_MS = 20_000
const MEMORY_GROWTH_MIN_DELTA_BYTES = 64 * 1024 * 1024
const MEMORY_GROWTH_MIN_RATIO = 0.2
const MEMORY_TREND_RESET_AFTER_MS = 5 * 60_000

export function getRendererDomSnapshot(): RendererDomSnapshot {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      domNodeCount: 0,
      terminalNodeCount: 0,
      xtermInstanceCount: 0,
      terminalCanvasCount: 0,
      jsHeapUsedBytes: null,
      jsHeapTotalBytes: null,
    }
  }

  const memory = (window.performance as PerformanceWithMemory).memory
  return {
    domNodeCount: document.querySelectorAll('*').length,
    terminalNodeCount: document.querySelectorAll('.terminal-node').length,
    xtermInstanceCount: document.querySelectorAll('.xterm').length,
    terminalCanvasCount: document.querySelectorAll('.xterm-screen canvas').length,
    jsHeapUsedBytes:
      typeof memory?.usedJSHeapSize === 'number' ? Math.round(memory.usedJSHeapSize) : null,
    jsHeapTotalBytes:
      typeof memory?.totalJSHeapSize === 'number' ? Math.round(memory.totalJSHeapSize) : null,
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? null
}

export function useRendererDomSampler({
  intervalMs = 1_000,
}: {
  intervalMs?: number
} = {}): RendererDomSnapshot {
  const [snapshot, setSnapshot] = useState<RendererDomSnapshot>(() => getRendererDomSnapshot())

  useEffect(() => {
    setSnapshot(getRendererDomSnapshot())
    const intervalId = window.setInterval(() => {
      setSnapshot(getRendererDomSnapshot())
    }, intervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [intervalMs])

  return snapshot
}

export function useRendererFrameSampler({
  enabled = true,
  publishIntervalMs = 1_000,
  maxFrameSamples = 240,
}: {
  enabled?: boolean
  publishIntervalMs?: number
  maxFrameSamples?: number
} = {}): RendererFrameSnapshot {
  const [snapshot, setSnapshot] = useState<RendererFrameSnapshot>(EMPTY_FRAME_SNAPSHOT)

  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_FRAME_SNAPSHOT)
      return
    }

    const frameDurations: number[] = []
    let animationFrameId = 0
    let lastFrameAt = performance.now()
    let lastPublishAt = lastFrameAt
    let longTaskCount = 0
    let longTaskTotalMs = 0
    let observer: PerformanceObserver | null = null

    const publish = () => {
      setSnapshot({
        sampleCount: frameDurations.length,
        frameP95Ms: percentile(frameDurations, 0.95),
        frameMaxMs: frameDurations.length > 0 ? Math.max(...frameDurations) : null,
        longTaskCount,
        longTaskTotalMs: Math.round(longTaskTotalMs),
      })
    }

    const onFrame = (now: number) => {
      const delta = now - lastFrameAt
      lastFrameAt = now
      if (delta > 0 && delta < 1_000) {
        frameDurations.push(delta)
        if (frameDurations.length > maxFrameSamples) {
          frameDurations.shift()
        }
      }
      if (now - lastPublishAt >= publishIntervalMs) {
        lastPublishAt = now
        publish()
      }
      animationFrameId = window.requestAnimationFrame(onFrame)
    }

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            longTaskCount += 1
            longTaskTotalMs += entry.duration
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        observer = null
      }
    }

    animationFrameId = window.requestAnimationFrame(onFrame)
    return () => {
      window.cancelAnimationFrame(animationFrameId)
      observer?.disconnect()
    }
  }, [enabled, maxFrameSamples, publishIntervalMs])

  return snapshot
}

export function useRendererMemoryTrend(
  domSnapshot: RendererDomSnapshot,
): RendererMemoryTrendSnapshot {
  const baselineRef = useRef<{ value: number; capturedAt: number; sampleCount: number } | null>(
    null,
  )
  const [trend, setTrend] = useState<RendererMemoryTrendSnapshot>(EMPTY_MEMORY_TREND)

  useEffect(() => {
    const current = domSnapshot.jsHeapUsedBytes
    if (current === null || !Number.isFinite(current)) {
      baselineRef.current = null
      setTrend(EMPTY_MEMORY_TREND)
      return
    }

    const now = performance.now()
    const baseline = baselineRef.current
    if (
      baseline === null ||
      current < baseline.value * 0.75 ||
      now - baseline.capturedAt > MEMORY_TREND_RESET_AFTER_MS
    ) {
      baselineRef.current = { value: current, capturedAt: now, sampleCount: 1 }
      setTrend({
        sampleCount: 1,
        durationMs: 0,
        baselineJsHeapUsedBytes: current,
        currentJsHeapUsedBytes: current,
        deltaJsHeapUsedBytes: 0,
        deltaPercent: 0,
        isGrowing: false,
      })
      return
    }

    baseline.sampleCount += 1
    const durationMs = now - baseline.capturedAt
    const deltaBytes = current - baseline.value
    const deltaPercent = baseline.value > 0 ? deltaBytes / baseline.value : null
    const isGrowing =
      durationMs >= MEMORY_GROWTH_MIN_DURATION_MS &&
      deltaBytes >= MEMORY_GROWTH_MIN_DELTA_BYTES &&
      (deltaPercent ?? 0) >= MEMORY_GROWTH_MIN_RATIO

    setTrend({
      sampleCount: baseline.sampleCount,
      durationMs,
      baselineJsHeapUsedBytes: baseline.value,
      currentJsHeapUsedBytes: current,
      deltaJsHeapUsedBytes: deltaBytes,
      deltaPercent,
      isGrowing,
    })
  }, [domSnapshot])

  return trend
}

export function usePerformanceDiagnosticsSnapshot({
  enabled,
  pollIntervalMs = null,
}: {
  enabled: boolean
  pollIntervalMs?: number | null
}): PerformanceDiagnosticsSnapshotState {
  const [snapshot, setSnapshot] = useState<PerformanceDiagnosticsSnapshotResult | null>(null)
  const snapshotRef = useRef<PerformanceDiagnosticsSnapshotResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const hasSnapshot = snapshotRef.current !== null
    setIsLoading(!hasSnapshot)
    setIsRefreshing(hasSnapshot)
    setError(null)

    try {
      const nextSnapshot = await window.opencoveApi.performanceDiagnostics.getSnapshot()
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return
      }
      setSnapshot(nextSnapshot)
    } catch (nextError) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return
      }
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void refreshSnapshot()
    if (pollIntervalMs === null) {
      return
    }

    const intervalId = window.setInterval(() => {
      void refreshSnapshot()
    }, pollIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [enabled, pollIntervalMs, refreshSnapshot])

  return {
    snapshot,
    isLoading,
    isRefreshing,
    error,
    refreshSnapshot,
  }
}
