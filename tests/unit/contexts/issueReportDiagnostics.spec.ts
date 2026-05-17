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
    vi.doMock('@app/main/worker/homeWorkerConfig', () => ({
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
      },
      reportId: 'report-1',
      createdAt: '2026-05-07T00:00:00.000Z',
      userDataPath: '/Users/alice/Library/Application Support/OpenCove',
      persistedState: null,
      getUpdateState: () => ({ status: 'idle', checkedAt: null }),
      workerEndpointResolver: null,
    })

    const agentSection = sections.find(section => section.id === 'agent_state')
    expect(JSON.stringify(agentSection?.content)).not.toContain('/Users/alice')
    expect(JSON.stringify(agentSection?.content)).not.toContain('/opt/homebrew/bin/codex')
    expect(JSON.stringify(agentSection?.content)).not.toContain('C:\\Users\\alice')
    expect(JSON.stringify(agentSection?.content)).toContain('[configured override]')
    expect(JSON.stringify(agentSection?.content)).toContain('[local-executable-path]')
  })
})
