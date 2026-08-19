import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIssueReportBreadcrumbsForTests,
  getIssueReportBreadcrumbs,
  normalizeTerminalDiagnosticPayload,
  normalizeUiDiagnosticBreadcrumb,
  recordTerminalBreadcrumb,
  recordUiBreadcrumb,
} from '../../../src/app/main/diagnostics/issueReportBreadcrumbs'
import { ISSUE_REPORT_BREADCRUMB_CAPACITY } from '../../../src/shared/diagnostics/issueReportBreadcrumbPolicy'
import { BoundedRingBuffer } from '../../../src/shared/diagnostics/BoundedRingBuffer'

describe('issue report breadcrumbs', () => {
  beforeEach(() => {
    clearIssueReportBreadcrumbsForTests()
  })

  it('keeps only the most recent bounded UI events', () => {
    for (let index = 0; index < ISSUE_REPORT_BREADCRUMB_CAPACITY + 5; index += 1) {
      recordUiBreadcrumb({
        source: 'renderer-ui',
        event: 'window-resize',
        details: { sequence: index },
      })
    }

    const entries = getIssueReportBreadcrumbs()
    expect(entries).toHaveLength(ISSUE_REPORT_BREADCRUMB_CAPACITY)
    expect(entries[0]?.details['sequence']).toBe(5)
    expect(entries.at(-1)?.details['sequence']).toBe(ISSUE_REPORT_BREADCRUMB_CAPACITY + 4)
  })

  it('records key terminal geometry events and ignores verbose input events', () => {
    const base = {
      source: 'renderer-terminal' as const,
      nodeId: 'node-1',
      sessionId: 'session-1',
      nodeKind: 'terminal' as const,
      title: 'Terminal',
      snapshot: {
        bufferKind: 'normal' as const,
        activeBaseY: 0,
        activeViewportY: 0,
        activeLength: 24,
        cols: 80,
        rows: 24,
        viewportScrollTop: 0,
        viewportScrollHeight: 480,
        viewportClientHeight: 480,
        hasViewport: true,
        hasVerticalScrollbar: false,
      },
    }

    recordTerminalBreadcrumb({ ...base, event: 'resize' })
    recordTerminalBreadcrumb({ ...base, event: 'pty-write' })

    expect(getIssueReportBreadcrumbs()).toHaveLength(1)
    expect(getIssueReportBreadcrumbs()[0]).toMatchObject({
      source: 'renderer-terminal',
      event: 'resize',
      details: { cols: 80, rows: 24 },
    })
  })

  it('rejects malformed untrusted IPC payloads', () => {
    expect(normalizeTerminalDiagnosticPayload({ event: 'resize' })).toBeNull()
    expect(
      normalizeUiDiagnosticBreadcrumb({
        source: 'renderer-ui',
        event: 'arbitrary-event',
        details: {},
      }),
    ).toBeNull()
  })

  it('does not let breadcrumb storage failures affect runtime behavior', () => {
    vi.spyOn(BoundedRingBuffer.prototype, 'push').mockImplementationOnce(() => {
      throw new Error('storage failed')
    })

    expect(() =>
      recordUiBreadcrumb({
        source: 'renderer-ui',
        event: 'window-resize',
        details: { innerWidth: 1280 },
      }),
    ).not.toThrow()
  })
})
