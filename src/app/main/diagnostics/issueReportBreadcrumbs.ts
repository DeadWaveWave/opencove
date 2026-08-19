import type {
  RuntimeDiagnosticsDetailValue,
  TerminalDiagnosticsLogInput,
  UiDiagnosticBreadcrumbEvent,
  UiDiagnosticBreadcrumbInput,
} from '@shared/contracts/dto'
import { BoundedRingBuffer } from '@shared/diagnostics/BoundedRingBuffer'
import {
  ISSUE_REPORT_BREADCRUMB_CAPACITY,
  shouldRecordTerminalBreadcrumb,
} from '@shared/diagnostics/issueReportBreadcrumbPolicy'

const MAX_TEXT_LENGTH = 1_024
const MAX_DETAIL_COUNT = 160
const UI_EVENTS = new Set<UiDiagnosticBreadcrumbEvent>([
  'window-geometry',
  'window-resize',
  'canvas-geometry',
  'canvas-viewport-change',
])

export interface IssueReportBreadcrumb {
  ts: string
  source: 'renderer-terminal' | 'renderer-ui'
  event: string
  details: Record<string, RuntimeDiagnosticsDetailValue>
}

const breadcrumbs = new BoundedRingBuffer<IssueReportBreadcrumb>(ISSUE_REPORT_BREADCRUMB_CAPACITY)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : null
}

function normalizeDetailValue(value: unknown): RuntimeDiagnosticsDetailValue | undefined {
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    return value.slice(0, MAX_TEXT_LENGTH)
  }
  return undefined
}

function normalizeNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeDetails(value: unknown): Record<string, RuntimeDiagnosticsDetailValue> {
  if (!isRecord(value)) {
    return {}
  }

  const normalized: Record<string, RuntimeDiagnosticsDetailValue> = {}
  for (const [key, detail] of Object.entries(value).slice(0, MAX_DETAIL_COUNT)) {
    const normalizedValue = normalizeDetailValue(detail)
    if (normalizedValue !== undefined) {
      normalized[key.slice(0, 120)] = normalizedValue
    }
  }
  return normalized
}

export function normalizeTerminalDiagnosticPayload(
  value: unknown,
): TerminalDiagnosticsLogInput | null {
  if (!isRecord(value) || value.source !== 'renderer-terminal' || !isRecord(value.snapshot)) {
    return null
  }

  const nodeId = normalizeText(value.nodeId, 256)
  const sessionId = normalizeText(value.sessionId, 256)
  const title = normalizeText(value.title, 512)
  const event = normalizeText(value.event, 160)
  const nodeKind =
    value.nodeKind === 'agent' || value.nodeKind === 'terminal' ? value.nodeKind : null
  if (!nodeId || !sessionId || !title || !event || !nodeKind) {
    return null
  }

  const snapshot = normalizeDetails(value.snapshot)
  if (typeof snapshot['cols'] !== 'number' || typeof snapshot['rows'] !== 'number') {
    return null
  }

  return {
    source: 'renderer-terminal',
    nodeId,
    sessionId,
    nodeKind,
    title,
    event,
    snapshot: {
      ...snapshot,
      bufferKind:
        value.snapshot.bufferKind === 'normal' || value.snapshot.bufferKind === 'alternate'
          ? value.snapshot.bufferKind
          : 'unknown',
      activeBaseY: normalizeNumberOrNull(value.snapshot.activeBaseY),
      activeViewportY: normalizeNumberOrNull(value.snapshot.activeViewportY),
      activeLength: normalizeNumberOrNull(value.snapshot.activeLength),
      cols: snapshot['cols'],
      rows: snapshot['rows'],
      viewportScrollTop: normalizeNumberOrNull(value.snapshot.viewportScrollTop),
      viewportScrollHeight: normalizeNumberOrNull(value.snapshot.viewportScrollHeight),
      viewportClientHeight: normalizeNumberOrNull(value.snapshot.viewportClientHeight),
      hasViewport: value.snapshot.hasViewport === true,
      hasVerticalScrollbar: value.snapshot.hasVerticalScrollbar === true,
    },
    ...(isRecord(value.details) ? { details: normalizeDetails(value.details) } : {}),
  }
}

export function normalizeUiDiagnosticBreadcrumb(
  value: unknown,
): UiDiagnosticBreadcrumbInput | null {
  if (
    !isRecord(value) ||
    value.source !== 'renderer-ui' ||
    typeof value.event !== 'string' ||
    !UI_EVENTS.has(value.event as UiDiagnosticBreadcrumbEvent)
  ) {
    return null
  }

  return {
    source: 'renderer-ui',
    event: value.event as UiDiagnosticBreadcrumbEvent,
    details: normalizeDetails(value.details),
  }
}

export function recordTerminalBreadcrumb(payload: TerminalDiagnosticsLogInput): void {
  if (!shouldRecordTerminalBreadcrumb(payload.event)) {
    return
  }

  try {
    breadcrumbs.push({
      ts: new Date().toISOString(),
      source: payload.source,
      event: payload.event,
      details: {
        nodeId: payload.nodeId,
        sessionId: payload.sessionId,
        nodeKind: payload.nodeKind,
        title: payload.title,
        ...payload.details,
        ...payload.snapshot,
      },
    })
  } catch {
    // Diagnostics collection must never affect app runtime behavior.
  }
}

export function recordUiBreadcrumb(payload: UiDiagnosticBreadcrumbInput): void {
  try {
    breadcrumbs.push({
      ts: new Date().toISOString(),
      source: payload.source,
      event: payload.event,
      details: payload.details,
    })
  } catch {
    // Diagnostics collection must never affect app runtime behavior.
  }
}

export function getIssueReportBreadcrumbs(): IssueReportBreadcrumb[] {
  return breadcrumbs.snapshot()
}

export function clearIssueReportBreadcrumbsForTests(): void {
  breadcrumbs.clear()
}
