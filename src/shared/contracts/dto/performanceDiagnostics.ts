export type PerformanceProcessScope =
  | 'opencove'
  | 'external-agent'
  | 'platform'
  | 'diagnostics'
  | 'other'

export type PerformanceProcessKind =
  | 'opencove-main'
  | 'opencove-renderer'
  | 'opencove-utility'
  | 'opencove-pty-host'
  | 'opencove-worker'
  | 'external-agent-codex'
  | 'external-agent-claude'
  | 'external-agent-opencode'
  | 'external-agent-gemini'
  | 'external-output-stub'
  | 'external-shell'
  | 'windows-console-host'
  | 'diagnostics-collector'
  | 'node-child'
  | 'other'

export interface PerformanceDiagnosticsProcess {
  pid: number
  parentPid: number | null
  name: string
  kind: PerformanceProcessKind
  scope: PerformanceProcessScope
  workingSetBytes: number | null
  privateBytes: number | null
  threadCount: number | null
  cpuUserTimeMs: number | null
  cpuKernelTimeMs: number | null
  commandLine: string | null
}

export interface PerformanceDiagnosticsProcessSummary {
  kind: PerformanceProcessKind
  scope: PerformanceProcessScope
  count: number
  workingSetBytes: number | null
  privateBytes: number | null
  threadCount: number | null
}

export interface PerformanceDiagnosticsElectronMetric {
  pid: number
  type: string
  name: string | null
  serviceName: string | null
  cpuPercent: number | null
  memory: {
    workingSetSize: number | null
    peakWorkingSetSize: number | null
    privateBytes: number | null
  }
}

export interface PerformanceDiagnosticsProcessTreeStatus {
  status: 'available' | 'unsupported' | 'error'
  rootPid: number
  sampledProcessCount: number
  message: string | null
}

export interface PerformanceDiagnosticsSnapshotResult {
  capturedAt: string
  platform: string
  arch: string
  mainPid: number
  processTree: PerformanceDiagnosticsProcessTreeStatus
  processes: PerformanceDiagnosticsProcess[]
  processSummary: PerformanceDiagnosticsProcessSummary[]
  electronMetrics: PerformanceDiagnosticsElectronMetric[]
  notes: string[]
}
