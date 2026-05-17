import { describe, expect, it } from 'vitest'
import {
  buildGitHubIssueUrl,
  buildIssueReportDocument,
  buildIssueReportMarkdown,
  redactSensitiveText,
  truncateText,
} from '../../../src/contexts/issueReport/application/IssueReportDocument'
import {
  createJsonIssueReportSection,
  createLogSection,
} from '../../../src/contexts/issueReport/application/IssueReportSections'

describe('issue report document', () => {
  it('redacts tokens, secrets, and known local paths', () => {
    const urlCredential = 'credential'
    const redacted = redactSensitiveText(
      [
        'authorization: Bearer abc.def',
        'OPENAI_API_KEY=sk-test',
        'Cookie: session=abc123',
        `https://alice:${urlCredential}@example.com/repo.git`,
        '"token": "secret-token"',
        '/Users/alice/OpenCove/logs/runtime.log',
      ].join('\n'),
      { knownPaths: ['/Users/alice'] },
    )

    expect(redacted).toContain('Bearer [redacted]')
    expect(redacted).toContain('OPENAI_API_KEY=[redacted]')
    expect(redacted).toContain('Cookie: [redacted]')
    expect(redacted).toContain('https://[redacted]@example.com/repo.git')
    expect(redacted).toContain('"token":"[redacted]"')
    expect(redacted).toContain('[local-path]/OpenCove')
  })

  it('truncates large text with an explicit marker', () => {
    const truncated = truncateText('x'.repeat(200), 100)

    expect(truncated.length).toBeLessThan(140)
    expect(truncated).toContain('[truncated')
  })

  it('builds markdown that hides local paths by default', () => {
    const workspacePath = 'D:\\Development\\client\\opencove'
    const markdown = buildIssueReportMarkdown({
      reportId: 'report-1',
      createdAt: '2026-05-07T00:00:00.000Z',
      request: {
        kind: 'run_agent_failed',
        title: 'Run Agent failed',
        description: 'After updating, Run Agent does not start.',
        includeLocalPaths: false,
        context: {
          activeWorkspaceName: 'OpenCove',
          activeWorkspacePath: workspacePath,
        },
      },
      knownPathsToRedact: ['/Users/alice', workspacePath],
      sections: [
        createJsonIssueReportSection('app_runtime', 'App Runtime', { version: '0.2.0' }),
        createJsonIssueReportSection('update_state', 'Update State', { channel: 'stable' }),
        createJsonIssueReportSection('worker_state', 'Worker State', { mode: 'local' }),
        createJsonIssueReportSection('agent_state', 'Agent State', { defaultProvider: 'codex' }),
        createLogSection({
          fileName: 'runtime-diagnostics.log',
          path: workspacePath,
          status: 'available',
          content: `cwd=${workspacePath} token=abc`,
          originalBytes: 120,
          includedBytes: 60,
          omittedBytes: 60,
          truncated: true,
          tail: true,
        }),
      ],
    })

    expect(markdown).toContain('Run Agent failed')
    expect(markdown).toContain('Active workspace path: [hidden]')
    expect(markdown).toContain('## Diagnostics Manifest')
    expect(markdown).toContain('## Log: runtime-diagnostics.log')
    expect(markdown).toContain('originalBytes=120')
    expect(markdown).toContain('tail=yes')
    expect(markdown).not.toContain('D:\\Development\\client')
    expect(markdown).toContain('token=[redacted]')
  })

  it('builds a GitHub issue body with diagnostic excerpts', () => {
    const document = buildIssueReportDocument({
      reportId: 'report-1',
      createdAt: '2026-05-07T00:00:00.000Z',
      request: {
        kind: 'run_agent_failed',
        title: 'Run Agent failed',
        description: 'details '.repeat(120),
        includeLocalPaths: false,
        context: {
          activeWorkspaceName: 'OpenCove',
          activeWorkspacePath: '/Users/alice/project',
        },
      },
      knownPathsToRedact: ['/Users/alice'],
      sections: [
        createJsonIssueReportSection('app_runtime', 'App Runtime', { version: '0.2.0' }),
        createLogSection({
          fileName: 'runtime-diagnostics.log',
          path: '/Users/alice/Library/Application Support/OpenCove/logs/runtime-diagnostics.log',
          status: 'available',
          content: 'authorization: Bearer abc.def\ncrash after agent launch\n'.repeat(80),
          originalBytes: 10_000,
          includedBytes: 4_000,
          omittedBytes: 6_000,
          truncated: true,
          tail: true,
        }),
      ],
    })

    expect(document.githubBody).toContain('### Runtime Diagnostics')
    expect(document.githubBody).toContain('#### Log: runtime-diagnostics.log')
    expect(document.githubBody).toContain('originalBytes=10000')
    expect(document.githubBody).toContain('crash after agent launch')
    expect(document.githubBody).toContain('Bearer [redacted]')
    expect(document.githubBody).not.toContain('/Users/alice')
  })

  it('builds a bounded GitHub issue URL', () => {
    const url = buildGitHubIssueUrl({
      title: 'Run Agent failed',
      body: 'details '.repeat(2_000),
    })

    expect(url).toContain('https://github.com/DeadWaveWave/opencove/issues/new?')
    expect(url.length).toBeLessThan(8_000)
  })
})
