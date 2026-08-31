import { app } from 'electron'
import type { AppUpdateState, PrepareIssueReportInput } from '@shared/contracts/dto'
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
import { readHomeWorkerConfig } from '@contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import { collectPerformanceDiagnosticsSnapshot } from '@app/main/diagnostics/performanceDiagnosticsCollector'
import type { IssueReportDiagnosticSection } from '../../application/IssueReportDocument'
import {
  createAgentStateSection,
  createAppRuntimeSection,
  createDiagnosticBreadcrumbsSection,
  createLogSection,
  createProcessSnapshotSection,
  createReportMetadataSection,
  createUnavailableIssueReportSection,
  createUpdateStateSection,
  createUiGeometrySection,
  createWorkerStateSection,
  createWorkspaceStateSection,
} from '../../application/IssueReportSections'
import { getIssueReportBreadcrumbs } from '@app/main/diagnostics/issueReportBreadcrumbs'
import {
  collectIssueReportLogExcerpts,
  ISSUE_REPORT_LOG_FILE_NAMES,
  LOG_SAMPLE_BYTES,
} from './issueReportLogCollector'

function redactExecutablePathDiagnostics(diagnostics: readonly string[]): string[] {
  return diagnostics.map(diagnostic =>
    diagnostic
      .replace(/(Configured override was not executable: ).+$/gu, '$1[configured override]')
      .replace(/\b[A-Z]:\\[^\s"'`,;]+/gu, '[local-executable-path]')
      .replace(/(^|[\s("'=])\/[^\s"'`,;)]+/gu, '$1[local-executable-path]'),
  )
}

export interface CollectIssueReportDiagnosticSectionsInput {
  input: PrepareIssueReportInput
  reportId: string
  createdAt: string
  userDataPath: string
  persistedState: unknown | null
  getUpdateState: () => AppUpdateState
  workerEndpointResolver?: ControlSurfaceRemoteEndpointResolver | null
  getBreadcrumbs?: () => unknown[]
}

export async function readIssueReportPersistedState(
  getPersistenceStore: () => Promise<PersistenceStore>,
): Promise<unknown | null> {
  return await getPersistenceStore()
    .then(store => store.readAppState())
    .catch(() => null)
}

async function collectAgentDiagnostics(persistedState: unknown | null) {
  try {
    const persisted = normalizePersistedAppState(persistedState)
    const settings = normalizeAgentSettings(persisted?.settings)
    const availability = await listInstalledAgentProviders({
      executablePathOverrideByProvider: settings.agentExecutablePathOverrideByProvider,
    })

    return {
      defaultProvider: settings.defaultProvider,
      defaultModel: resolveAgentModel(settings, settings.defaultProvider),
      defaultTerminalProfileId: settings.defaultTerminalProfileId,
      agentFullAccess: settings.agentFullAccess,
      runtimeEnvironment: {
        launchOwner: 'terminal_profile',
        availabilityScope: 'host_executable_discovery',
        availabilityIsLaunchGate: false,
      },
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
                  diagnostics: redactExecutablePathDiagnostics(info.diagnostics),
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

function collectWorkspaceDiagnostics(persistedState: unknown | null) {
  const persisted = normalizePersistedAppState(persistedState)
  if (!persisted) {
    return {
      status: 'unavailable',
      reason: 'No persisted app state was available.',
    }
  }

  return {
    formatVersion: persisted.formatVersion,
    activeWorkspaceId: persisted.activeWorkspaceId,
    workspaceCount: persisted.workspaces.length,
    workspaces: persisted.workspaces.map(workspace => {
      const activeSpace = workspace.spaces.find(space => space.id === workspace.activeSpaceId)
      const nodeKindCounts = new Map<string, number>()
      const runtimeKindCounts = new Map<string, number>()
      const statusCounts = new Map<string, number>()
      for (const node of workspace.nodes) {
        incrementCount(nodeKindCounts, node.kind)
        incrementCount(runtimeKindCounts, node.runtimeKind ?? 'unknown')
        incrementCount(statusCounts, node.status ?? 'unknown')
      }

      return {
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        active: workspace.id === persisted.activeWorkspaceId,
        nodeCount: workspace.nodes.length,
        spaceCount: workspace.spaces.length,
        archivedSpaceCount: workspace.spaceArchiveRecords.length,
        activeSpaceId: workspace.activeSpaceId,
        activeSpaceName: activeSpace?.name ?? null,
        activeSpacePath: activeSpace?.directoryPath ?? null,
        nodeKindCounts: Object.fromEntries(nodeKindCounts.entries()),
        runtimeKindCounts: Object.fromEntries(runtimeKindCounts.entries()),
        statusCounts: Object.fromEntries(statusCounts.entries()),
        nodesWithSession: workspace.nodes.filter(node => Boolean(node.sessionId)).length,
        nodesWithLastError: workspace.nodes.filter(node => Boolean(node.lastError)).length,
      }
    }),
  }
}

function incrementCount(target: Map<string, number>, key: string): void {
  target.set(key, (target.get(key) ?? 0) + 1)
}

async function collectWorkerDiagnostics(
  userDataPath: string,
  workerEndpointResolver?: ControlSurfaceRemoteEndpointResolver | null,
) {
  const config = await readHomeWorkerConfig(userDataPath, {
    allowStandaloneMode: false,
    allowRemoteMode: true,
  })
  const endpoint = await workerEndpointResolver?.().catch(() => null)

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

export function collectIssueReportKnownPaths(options: {
  input: PrepareIssueReportInput
  persistedState: unknown | null
  userDataPath: string
}): string[] {
  const paths = new Set<string>([
    app.getPath('home'),
    options.userDataPath,
    options.input.context?.activeWorkspacePath ?? '',
    options.input.context?.activeSpacePath ?? '',
  ])
  const persisted = normalizePersistedAppState(options.persistedState)
  for (const workspace of persisted?.workspaces ?? []) {
    paths.add(workspace.path)
    paths.add(workspace.worktreesRoot)
    for (const space of workspace.spaces) {
      paths.add(space.directoryPath)
    }
    for (const node of workspace.nodes) {
      paths.add(node.executionDirectory ?? '')
      paths.add(node.expectedDirectory ?? '')
    }
  }
  return [...paths].filter(path => path.trim().length >= 4)
}

export async function collectIssueReportDiagnosticSections({
  input,
  reportId,
  createdAt,
  userDataPath,
  persistedState,
  getUpdateState,
  workerEndpointResolver,
  getBreadcrumbs = getIssueReportBreadcrumbs,
}: CollectIssueReportDiagnosticSectionsInput): Promise<IssueReportDiagnosticSection[]> {
  const sections: IssueReportDiagnosticSection[] = []

  sections.push(
    createReportMetadataSection({
      request: input,
      reportId,
      createdAt,
      logSampleBytes: LOG_SAMPLE_BYTES,
      logFileNames: ISSUE_REPORT_LOG_FILE_NAMES,
    }),
  )

  sections.push(createAppRuntimeDiagnosticSection())
  sections.push(createUpdateStateSection(getUpdateState()))
  sections.push(await collectWorkerSection(userDataPath, workerEndpointResolver))
  sections.push(createWorkspaceSection(persistedState))
  sections.push(
    input.uiGeometry
      ? createUiGeometrySection(input.uiGeometry)
      : createUnavailableIssueReportSection(
          'ui_geometry',
          'UI Geometry',
          'Renderer geometry was unavailable.',
          { github: 'excerpt' },
        ),
  )
  sections.push(collectBreadcrumbSection(getBreadcrumbs))
  sections.push(await collectAgentSection(persistedState))
  sections.push(await collectProcessSection())

  const logExcerpts = await collectIssueReportLogExcerpts(userDataPath)
  sections.push(...logExcerpts.map(createLogSection))

  return sections
}

function collectBreadcrumbSection(getBreadcrumbs: () => unknown[]): IssueReportDiagnosticSection {
  try {
    return createDiagnosticBreadcrumbsSection(getBreadcrumbs())
  } catch (error) {
    return createUnavailableIssueReportSection(
      'diagnostic_breadcrumbs',
      'Diagnostic Breadcrumbs',
      error,
      { github: 'excerpt' },
    )
  }
}

function createAppRuntimeDiagnosticSection(): IssueReportDiagnosticSection {
  return createAppRuntimeSection({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    locale: typeof app.getLocale === 'function' ? app.getLocale() : null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
  })
}

async function collectWorkerSection(
  userDataPath: string,
  workerEndpointResolver?: ControlSurfaceRemoteEndpointResolver | null,
): Promise<IssueReportDiagnosticSection> {
  return await collectWorkerDiagnostics(userDataPath, workerEndpointResolver)
    .then(worker => createWorkerStateSection(worker))
    .catch(error => createUnavailableIssueReportSection('worker_state', 'Worker State', error))
}

function createWorkspaceSection(persistedState: unknown | null): IssueReportDiagnosticSection {
  return createWorkspaceStateSection(collectWorkspaceDiagnostics(persistedState))
}

async function collectAgentSection(
  persistedState: unknown | null,
): Promise<IssueReportDiagnosticSection> {
  return await collectAgentDiagnostics(persistedState)
    .then(agent => createAgentStateSection(agent))
    .catch(error => createUnavailableIssueReportSection('agent_state', 'Agent State', error))
}

async function collectProcessSection(): Promise<IssueReportDiagnosticSection> {
  return await collectPerformanceDiagnosticsSnapshot()
    .then(snapshot => createProcessSnapshotSection(snapshot))
    .catch(error =>
      createUnavailableIssueReportSection('process_snapshot', 'Process Snapshot', error, {
        github: 'excerpt',
      }),
    )
}
