import { describe, expect, it } from 'vitest'
import {
  buildGitHubIssueUrl,
  buildIssueReportMarkdown,
  redactSensitiveText,
  truncateText,
} from '../../../src/contexts/issueReport/application/IssueReportDocument'

describe('issue report document', () => {
  it('redacts tokens, secrets, and known local paths', () => {
    const redacted = redactSensitiveText(
      [
        'authorization: Bearer abc.def',
        'OPENAI_API_KEY=sk-test',
        '"token": "secret-token"',
        '/Users/alice/OpenCove/logs/runtime.log',
      ].join('\n'),
      { knownPaths: ['/Users/alice'] },
    )

    expect(redacted).toContain('Bearer [redacted]')
    expect(redacted).toContain('OPENAI_API_KEY=[redacted]')
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
      diagnostics: {
        app: { version: '0.2.0' },
        update: { channel: 'stable' },
        worker: { mode: 'local' },
        agent: { defaultProvider: 'codex' },
        logs: [{ label: 'runtime', content: `cwd=${workspacePath} token=abc` }],
      },
    })

    expect(markdown).toContain('Run Agent failed')
    expect(markdown).toContain('Active workspace path: [hidden]')
    expect(markdown).not.toContain('D:\\Development\\client')
    expect(markdown).toContain('token=[redacted]')
  })

  it('builds a bounded GitHub issue URL', () => {
    const url = buildGitHubIssueUrl({
      title: 'Run Agent failed',
      description: 'details '.repeat(600),
      reportId: 'report-1',
      reportFileName: 'opencove-issue-report-report-1.md',
    })

    expect(url).toContain('https://github.com/DeadWaveWave/opencove/issues/new?')
    expect(url.length).toBeLessThan(2_500)
  })
})
