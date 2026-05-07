import { app, shell } from 'electron'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import type {
  AppUpdateState,
  PrepareIssueReportInput,
  PrepareIssueReportResult,
} from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'
import type { PersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import {
  normalizeAgentSettings,
  resolveAgentExecutablePathOverride,
  resolveAgentModel,
} from '@contexts/settings/domain/agentSettings'
import { AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings.providers'
import { listInstalledAgentProviders } from '@contexts/agent/infrastructure/cli/AgentCliAvailability'
import type { ControlSurfaceRemoteEndpointResolver } from '@app/main/controlSurface/remote/controlSurfaceHttpClient'
import { readHomeWorkerConfig } from '@app/main/worker/homeWorkerConfig'
import {
  buildGitHubIssueUrl,
  buildIssueReportMarkdown,
  defaultIssueReportTitle,
  resolveIncludedDiagnostics,
} from '../../application/IssueReportDocument'

const ISSUE_REPORTS_DIR = 'issue-reports'
const LOG_TAIL_BYTES = 32 * 1024

export interface IssueReportService {
  prepare(input: PrepareIssueReportInput): Promise<PrepareIssueReportResult>
  openGithubIssue(githubIssueUrl: string): Promise<void>
  showReportFile(reportPath: string): Promise<void>
}

export function createIssueReportService(deps: {
  getUpdateState: () => AppUpdateState
  getPersistenceStore: () => Promise<PersistenceStore>
  workerEndpointResolver?: ControlSurfaceRemoteEndpointResolver | null
}): IssueReportService {
  const userDataPath = app.getPath('userData')
  const issueReportsDir = resolve(userDataPath, ISSUE_REPORTS_DIR)

  const isReportPathOwnedByApp = (reportPath: string): boolean => {
    const resolved = resolve(reportPath)
    const rel = relative(issueReportsDir, resolved)
    return rel.length > 0 && !rel.startsWith('..') && !rel.includes(':')
  }

  const readLogTail = async (fileName: string): Promise<string | null> => {
    const filePath = resolve(userDataPath, 'logs', fileName)
    let file: Awaited<ReturnType<typeof open>> | null = null
    try {
      file = await open(filePath, 'r')
      const stat = await file.stat()
      const length = Math.min(stat.size, LOG_TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      await file.read(buffer, 0, length, Math.max(0, stat.size - length))
      return buffer.toString('utf8')
    } catch {
      return null
    } finally {
      await file?.close().catch(() => undefined)
    }
  }

  const collectAgentDiagnostics = async () => {
    try {
      const store = await deps.getPersistenceStore()
      const persisted = normalizePersistedAppState(await store.readAppState())
      const settings = normalizeAgentSettings(persisted?.settings)
      const availability = await listInstalledAgentProviders({
        executablePathOverrideByProvider: settings.agentExecutablePathOverrideByProvider,
      })

      return {
        defaultProvider: settings.defaultProvider,
        defaultModel: resolveAgentModel(settings, settings.defaultProvider),
        defaultTerminalProfileId: settings.defaultTerminalProfileId,
        agentFullAccess: settings.agentFullAccess,
        executableOverrides: Object.fromEntries(
          AGENT_PROVIDERS.map(provider => [
            provider,
            Boolean(resolveAgentExecutablePathOverride(settings, provider)),
          ]),
        ),
        providers: Object.fromEntries(
          AGENT_PROVIDERS.map(provider => {
            const info = availability.availabilityByProvider[provider]
            return [
              provider,
              info
                ? {
                    status: info.status,
                    command: info.command,
                    source: info.source,
                    hasExecutablePath: Boolean(info.executablePath),
                    diagnostics: info.diagnostics,
                  }
                : { status: 'unknown' },
            ]
          }),
        ),
        fetchedAt: availability.fetchedAt,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }
    }
  }

  const collectWorkerDiagnostics = async () => {
    const config = await readHomeWorkerConfig(userDataPath, {
      allowStandaloneMode: false,
      allowRemoteMode: true,
    })
    const endpoint = await deps.workerEndpointResolver?.().catch(() => null)

    return {
      mode: config.mode,
      updatedAt: config.updatedAt,
      remote: config.remote
        ? {
            hostname: config.remote.hostname,
            port: config.remote.port,
            token: '[hidden]',
          }
        : null,
      webUi: config.webUi,
      endpointAvailable: Boolean(endpoint),
      endpoint: endpoint
        ? {
            hostname: endpoint.hostname,
            port: endpoint.port,
            token: '[hidden]',
          }
        : null,
    }
  }

  const prepare = async (input: PrepareIssueReportInput): Promise<PrepareIssueReportResult> => {
    const createdAt = new Date().toISOString()
    const reportId = createdAt.replace(/[:.]/g, '-')
    const fileName = `opencove-issue-report-${reportId}.md`
    const reportPath = resolve(issueReportsDir, fileName)
    const includeLocalPaths = input.includeLocalPaths === true
    const title = input.title?.trim() || defaultIssueReportTitle(input.kind)
    const description = input.description?.trim() ?? ''
    const diagnostics = {
      app: {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        versions: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
      },
      update: deps.getUpdateState(),
      worker: await collectWorkerDiagnostics().catch(error => ({
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })),
      agent: await collectAgentDiagnostics(),
      logs: [
        { label: 'runtime-diagnostics.log', content: await readLogTail('runtime-diagnostics.log') },
        { label: 'pty-host.log', content: await readLogTail('pty-host.log') },
      ],
    }
    const knownPathsToRedact = includeLocalPaths
      ? []
      : [
          app.getPath('home'),
          userDataPath,
          input.context?.activeWorkspacePath ?? '',
          input.context?.activeSpacePath ?? '',
        ]
    const markdown = buildIssueReportMarkdown({
      reportId,
      createdAt,
      request: {
        kind: input.kind,
        title,
        description,
        includeLocalPaths,
        context: input.context ?? null,
      },
      diagnostics,
      knownPathsToRedact,
    })
    const githubIssueUrl = buildGitHubIssueUrl({
      title,
      description,
      reportId,
      reportFileName: fileName,
    })

    await mkdir(issueReportsDir, { recursive: true })
    await writeFile(reportPath, markdown, { encoding: 'utf8', mode: 0o600 })

    return {
      reportId,
      createdAt,
      reportPath,
      markdown,
      githubIssueUrl,
      includedDiagnostics: resolveIncludedDiagnostics(includeLocalPaths),
    }
  }

  const openGithubIssue = async (githubIssueUrl: string): Promise<void> => {
    const parsed = new URL(githubIssueUrl)
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      parsed.pathname !== '/DeadWaveWave/opencove/issues/new'
    ) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid GitHub issue URL.' })
    }

    await shell.openExternal(parsed.toString())
  }

  const showReportFile = async (reportPath: string): Promise<void> => {
    if (!isReportPathOwnedByApp(reportPath) || basename(reportPath).endsWith('.md') === false) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid issue report path.' })
    }

    shell.showItemInFolder(resolve(reportPath))
  }

  return {
    prepare,
    openGithubIssue,
    showReportFile,
  }
}
