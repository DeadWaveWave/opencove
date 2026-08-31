import { describe, expect, it, vi } from 'vitest'

describe('issue report diagnostics', () => {
  it('summarizes agent availability diagnostics without leaking executable paths', async () => {
    vi.resetModules()

    vi.doMock('electron', () => ({
      app: {
        getVersion: () => '0.2.0',
        isPackaged: false,
        getLocale: () => 'en-US',
        getPath: () => '/Users/alice',
      },
    }))
    vi.doMock('@contexts/settings/infrastructure/homeWorker/homeWorkerConfig', () => ({
      readHomeWorkerConfig: vi.fn(async () => ({
        mode: 'remote',
        updatedAt: '2026-05-07T00:00:00.000Z',
        remote: null,
        webUi: { enabled: false },
      })),
    }))
    vi.doMock('@app/main/diagnostics/performanceDiagnosticsCollector', () => ({
      collectPerformanceDiagnosticsSnapshot: vi.fn(async () => ({
        capturedAt: '2026-05-07T00:00:00.000Z',
        platform: 'darwin',
        arch: 'arm64',
        mainPid: 123,
        processTree: {
          status: 'available',
          sampledProcessCount: 0,
          rootPid: 123,
          rootName: 'OpenCove',
        },
        processSummary: [],
        processes: [],
        electronMetrics: [],
        notes: [],
      })),
    }))
    vi.doMock('@contexts/agent/infrastructure/cli/AgentCliAvailability', () => ({
      listInstalledAgentProviders: vi.fn(async () => ({
        providers: [],
        fetchedAt: '2026-05-07T00:00:00.000Z',
        availabilityByProvider: {
          'claude-code': { status: 'not_found', command: 'claude', diagnostics: [] },
          codex: {
            status: 'invalid_override',
            command: 'codex',
            source: null,
            executablePath: null,
            diagnostics: [
              'Configured override was not executable: /Users/alice/bin/codex',
              'Unable to resolve codex (/opt/homebrew/bin/codex) from current process PATH.',
              'Configured override was not executable: C:\\Users\\alice\\bin\\codex.cmd',
            ],
          },
          opencode: { status: 'not_found', command: 'opencode', diagnostics: [] },
          gemini: { status: 'not_found', command: 'gemini', diagnostics: [] },
        },
      })),
    }))

    const { collectIssueReportDiagnosticSections } =
      await import('../../../src/contexts/issueReport/infrastructure/main/issueReportDiagnostics')

    const sections = await collectIssueReportDiagnosticSections({
      input: {
        kind: 'run_agent_failed',
        includeLocalPaths: true,
        uiGeometry: {
          window: {
            innerWidth: 1280,
            innerHeight: 720,
            outerWidth: 1280,
            outerHeight: 720,
            devicePixelRatio: 2,
            visualViewportScale: 1,
          },
          canvas: {
            rect: { x: 0, y: 48, width: 1280, height: 672 },
            viewport: { x: 10, y: 20, zoom: 0.8 },
          },
          nodes: [{ id: 'node-1', kind: 'terminal', x: 20, y: 80, width: 600, height: 400 }],
        },
      },
      reportId: 'report-1',
      createdAt: '2026-05-07T00:00:00.000Z',
      userDataPath: '/Users/alice/Library/Application Support/OpenCove',
      persistedState: null,
      getUpdateState: () => ({ status: 'idle', checkedAt: null }),
      workerEndpointResolver: null,
      getBreadcrumbs: () => [
        {
          ts: '2026-05-07T00:00:00.000Z',
          source: 'renderer-ui',
          event: 'window-resize',
          details: { innerWidth: 1280 },
        },
      ],
    })

    const agentSection = sections.find(section => section.id === 'agent_state')
    expect(JSON.stringify(agentSection?.content)).not.toContain('/Users/alice')
    expect(JSON.stringify(agentSection?.content)).not.toContain('/opt/homebrew/bin/codex')
    expect(JSON.stringify(agentSection?.content)).not.toContain('C:\\Users\\alice')
    expect(JSON.stringify(agentSection?.content)).toContain('[configured override]')
    expect(JSON.stringify(agentSection?.content)).toContain('[local-executable-path]')

    const metadata = sections.find(section => section.id === 'report_meta')
    expect(JSON.stringify(metadata?.content)).not.toContain('terminal-diagnostics.log')
    expect(sections.find(section => section.id === 'ui_geometry')?.content).toMatchObject({
      window: { devicePixelRatio: 2 },
      canvas: { viewport: { zoom: 0.8 } },
      nodes: [{ id: 'node-1', width: 600, height: 400 }],
    })
    expect(
      sections.find(section => section.id === 'diagnostic_breadcrumbs')?.content,
    ).toMatchObject({
      count: 1,
      entries: [{ event: 'window-resize' }],
    })

    const failedBreadcrumbSections = await collectIssueReportDiagnosticSections({
      input: { kind: 'other' },
      reportId: 'report-2',
      createdAt: '2026-05-07T00:00:01.000Z',
      userDataPath: '/Users/alice/Library/Application Support/OpenCove',
      persistedState: null,
      getUpdateState: () => ({ status: 'idle', checkedAt: null }),
      getBreadcrumbs: () => {
        throw new Error('breadcrumb collector failed')
      },
    })
    expect(
      failedBreadcrumbSections.find(section => section.id === 'diagnostic_breadcrumbs'),
    ).toMatchObject({
      status: 'unavailable',
      error: 'Error: breadcrumb collector failed',
    })
    expect(failedBreadcrumbSections.find(section => section.id === 'app_runtime')).toBeDefined()
  })
})
