import { describe, expect, it } from 'vitest'
import {
  buildGitHubIssueUrl,
  buildIssueReportDocument,
} from '../../../src/contexts/issueReport/application/IssueReportDocument'
import type { IssueReportDiagnosticSection } from '../../../src/contexts/issueReport/application/IssueReportDocument'
import {
  createAgentStateSection,
  createAppRuntimeSection,
  createDiagnosticBreadcrumbsSection,
  createJsonIssueReportSection,
  createLogSection,
  createReportMetadataSection,
  createUiGeometrySection,
  createUpdateStateSection,
  createWorkerStateSection,
  createWorkspaceStateSection,
} from '../../../src/contexts/issueReport/application/IssueReportSections'

const CAPACITY = 200

function breadcrumb(index: number): {
  ts: string
  source: 'renderer-ui'
  event: string
  details: Record<string, number>
} {
  return {
    ts: `2026-08-20T10:00:${String(index % 60).padStart(2, '0')}.000Z`,
    source: 'renderer-ui',
    event: `window-resize-IDX${index}`,
    details: {
      innerWidth: 1512 - (index % 400),
      innerHeight: 858 - (index % 200),
      viewportScrollHeight: 2400 + index,
      viewportClientHeight: 858,
    },
  }
}

function padding(fieldCount: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: fieldCount }, (_, index) => [
      `field${index}`,
      `value-${index}-${'x'.repeat(20)}`,
    ]),
  )
}

/**
 * Mirrors the production section list and ordering from
 * `collectIssueReportDiagnosticSections`, so budget pressure in this test is
 * representative of a real report rather than of a two-section fixture.
 */
function realisticSections(breadcrumbs: unknown[]): IssueReportDiagnosticSection[] {
  return [
    createReportMetadataSection({
      request: { kind: 'app_error', includeLocalPaths: false },
      reportId: 'report-1',
      createdAt: '2026-08-20T10:00:00.000Z',
      logSampleBytes: 131_072,
      logFileNames: ['runtime-diagnostics.log', 'main.log'],
    }),
    createAppRuntimeSection({
      version: '0.2.0',
      isPackaged: true,
      platform: 'win32',
      arch: 'x64',
      ...padding(20),
    } as never),
    createUpdateStateSection(padding(20) as never),
    createWorkerStateSection(padding(25) as never),
    createWorkspaceStateSection(padding(30)),
    createUiGeometrySection({
      window: { innerWidth: 1512, innerHeight: 858, devicePixelRatio: 2 },
      canvas: { viewport: { zoom: 1 } },
      viewport: { viewportScrollHeight: 2400, viewportClientHeight: 858 },
      terminals: [{ id: 't1', cols: 120, rows: 30 }],
    } as never),
    createDiagnosticBreadcrumbsSection(breadcrumbs),
    createAgentStateSection(padding(30)),
    createJsonIssueReportSection('process_snapshot', 'Process Snapshot', padding(30), {
      github: 'excerpt',
    }),
    createLogSection({
      fileName: 'runtime-diagnostics.log',
      path: null,
      status: 'available',
      content: 'L'.repeat(120_000),
      originalBytes: 2_134_084,
      includedBytes: 131_072,
      omittedBytes: 2_003_012,
      truncated: true,
      tail: true,
      sampling: 'tail',
    }),
    createLogSection({
      fileName: 'main.log',
      path: null,
      status: 'available',
      content: 'M'.repeat(40_000),
      originalBytes: 90_000,
      includedBytes: 40_000,
      omittedBytes: 50_000,
      truncated: true,
      tail: true,
      sampling: 'tail',
    }),
  ]
}

function buildRealisticDocument(breadcrumbs: unknown[]): { githubBody: string; markdown: string } {
  return buildIssueReportDocument({
    reportId: 'report-1',
    createdAt: '2026-08-20T10:00:00.000Z',
    request: {
      kind: 'app_error',
      title: 'scroll area does not follow window resize',
      description: 'After resizing the window the scrollable area does not change.',
      includeLocalPaths: false,
      context: null,
    },
    sections: realisticSections(breadcrumbs),
    knownPathsToRedact: [],
  })
}

function keptBreadcrumbIndices(text: string): number[] {
  return [...text.matchAll(/window-resize-IDX(\d+)/gu)].map(match => Number(match[1]))
}

describe('issue report GitHub delivery', () => {
  it('keeps the newest breadcrumbs in the GitHub body, not the oldest', () => {
    const breadcrumbs = Array.from({ length: CAPACITY }, (_, index) => breadcrumb(index))

    const kept = keptBreadcrumbIndices(buildRealisticDocument(breadcrumbs).githubBody)

    expect(kept.length).toBeGreaterThan(0)
    // The event closest to the failure is the whole point of a breadcrumb trail.
    expect(kept).toContain(CAPACITY - 1)
    // Whatever survives must be a contiguous newest-first window, kept in
    // chronological order so the trail still reads forwards.
    expect(kept).toStrictEqual([...kept].sort((left, right) => left - right))
    expect(kept.at(-1)).toBe(CAPACITY - 1)
    expect(kept.at(-1)! - kept[0]!).toBe(kept.length - 1)
  })

  it('states how many breadcrumbs were dropped from the GitHub body', () => {
    const breadcrumbs = Array.from({ length: CAPACITY }, (_, index) => breadcrumb(index))

    const { githubBody } = buildRealisticDocument(breadcrumbs)
    const kept = keptBreadcrumbIndices(githubBody)

    expect(kept.length).toBeLessThan(CAPACITY)
    expect(githubBody).toContain(`"count": ${CAPACITY}`)
    expect(githubBody).toContain(`"omittedEntries": ${CAPACITY - kept.length}`)
  })

  it('emits a parseable breadcrumb payload in the GitHub body', () => {
    const breadcrumbs = Array.from({ length: CAPACITY }, (_, index) => breadcrumb(index))

    const { githubBody } = buildRealisticDocument(breadcrumbs)

    const start = githubBody.indexOf('#### Diagnostic Breadcrumbs')
    expect(start).toBeGreaterThanOrEqual(0)
    const fenced = githubBody.slice(start).match(/```text\n([\s\S]*?)\n```/u)
    expect(fenced).not.toBeNull()

    // A mid-string cut of pretty-printed JSON is unusable to whoever triages
    // the issue, no matter which end of the trail it preserved.
    const parsed = JSON.parse(fenced![1]!) as {
      count: number
      omittedEntries: number
      entries: { event: string }[]
    }
    expect(parsed.count).toBe(CAPACITY)
    expect(parsed.entries.length).toBeGreaterThan(0)
    expect(parsed.entries.at(-1)?.event).toBe(`window-resize-IDX${CAPACITY - 1}`)
    expect(parsed.omittedEntries).toBe(CAPACITY - parsed.entries.length)
  })

  it('keeps every breadcrumb in the full saved report', () => {
    const breadcrumbs = Array.from({ length: CAPACITY }, (_, index) => breadcrumb(index))

    const kept = keptBreadcrumbIndices(buildRealisticDocument(breadcrumbs).markdown)

    expect(kept).toHaveLength(CAPACITY)
    expect(kept).toContain(0)
    expect(kept).toContain(CAPACITY - 1)
  })

  it('does not pad the GitHub body when breadcrumbs already fit', () => {
    const breadcrumbs = Array.from({ length: 3 }, (_, index) => breadcrumb(index))

    const { githubBody } = buildRealisticDocument(breadcrumbs)

    expect(keptBreadcrumbIndices(githubBody)).toStrictEqual([0, 1, 2])
    expect(githubBody).toContain('"omittedEntries": 0')
  })

  it('fits the prefilled GitHub URL within its budget for a full report', () => {
    const breadcrumbs = Array.from({ length: CAPACITY }, (_, index) => breadcrumb(index))

    const { githubBody } = buildRealisticDocument(breadcrumbs)
    const url = buildGitHubIssueUrl({ title: 'resize regression', body: githubBody })

    expect(url.length).toBeLessThanOrEqual(7_500)
    // The newest breadcrumb has to survive percent-encoding and URL trimming,
    // which is the step that actually reaches GitHub.
    const deliveredBody = new URL(url).searchParams.get('body') ?? ''
    expect(deliveredBody).toContain(`window-resize-IDX${CAPACITY - 1}`)
    expect(deliveredBody).toContain('UI Geometry')
    expect(deliveredBody).toContain('viewportScrollHeight')
  })
})
