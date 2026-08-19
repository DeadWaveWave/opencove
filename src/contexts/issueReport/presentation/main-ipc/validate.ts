import type {
  IssueReportContextInput,
  IssueReportKind,
  IssueReportUiGeometryInput,
  OpenIssueReportGithubInput,
  PrepareIssueReportInput,
  ShowIssueReportFileInput,
} from '@shared/contracts/dto'
import { ISSUE_REPORT_KINDS } from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'

const MAX_TITLE_LENGTH = 180
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_CONTEXT_TEXT_LENGTH = 1_024
const MAX_GITHUB_ISSUE_URL_LENGTH = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null
}

function normalizeKind(value: unknown): IssueReportKind {
  if (ISSUE_REPORT_KINDS.includes(value as IssueReportKind)) {
    return value as IssueReportKind
  }

  return 'run_agent_failed'
}

function normalizeContext(value: unknown): IssueReportContextInput | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    activeWorkspaceName: normalizeOptionalText(value.activeWorkspaceName, MAX_CONTEXT_TEXT_LENGTH),
    activeWorkspacePath: normalizeOptionalText(value.activeWorkspacePath, MAX_CONTEXT_TEXT_LENGTH),
    activeSpaceName: normalizeOptionalText(value.activeSpaceName, MAX_CONTEXT_TEXT_LENGTH),
    activeSpacePath: normalizeOptionalText(value.activeSpacePath, MAX_CONTEXT_TEXT_LENGTH),
  }
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeUiGeometry(value: unknown): IssueReportUiGeometryInput | null {
  if (!isRecord(value) || !isRecord(value.window) || !isRecord(value.canvas)) {
    return null
  }

  const canvasRect = isRecord(value.canvas.rect)
    ? {
        x: normalizeFiniteNumber(value.canvas.rect.x) ?? 0,
        y: normalizeFiniteNumber(value.canvas.rect.y) ?? 0,
        width: normalizeFiniteNumber(value.canvas.rect.width) ?? 0,
        height: normalizeFiniteNumber(value.canvas.rect.height) ?? 0,
      }
    : null
  const canvasViewport = isRecord(value.canvas.viewport)
    ? {
        x: normalizeFiniteNumber(value.canvas.viewport.x) ?? 0,
        y: normalizeFiniteNumber(value.canvas.viewport.y) ?? 0,
        zoom: normalizeFiniteNumber(value.canvas.viewport.zoom) ?? 1,
      }
    : null
  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .filter(isRecord)
        .slice(0, 100)
        .map(node => ({
          id: normalizeOptionalText(node.id, 256) ?? 'unknown',
          kind: normalizeOptionalText(node.kind, 80),
          x: normalizeFiniteNumber(node.x) ?? 0,
          y: normalizeFiniteNumber(node.y) ?? 0,
          width: normalizeFiniteNumber(node.width) ?? 0,
          height: normalizeFiniteNumber(node.height) ?? 0,
        }))
    : []

  return {
    window: {
      innerWidth: normalizeFiniteNumber(value.window.innerWidth),
      innerHeight: normalizeFiniteNumber(value.window.innerHeight),
      outerWidth: normalizeFiniteNumber(value.window.outerWidth),
      outerHeight: normalizeFiniteNumber(value.window.outerHeight),
      devicePixelRatio: normalizeFiniteNumber(value.window.devicePixelRatio),
      visualViewportScale: normalizeFiniteNumber(value.window.visualViewportScale),
    },
    canvas: { rect: canvasRect, viewport: canvasViewport },
    nodes,
  }
}

export function normalizePrepareIssueReportPayload(payload: unknown): PrepareIssueReportInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for issue-report:prepare.',
    })
  }

  return {
    kind: normalizeKind(payload.kind),
    title: normalizeOptionalText(payload.title, MAX_TITLE_LENGTH),
    description: normalizeOptionalText(payload.description, MAX_DESCRIPTION_LENGTH),
    includeLocalPaths: payload.includeLocalPaths === true,
    context: normalizeContext(payload.context),
    uiGeometry: normalizeUiGeometry(payload.uiGeometry),
  }
}

export function normalizeOpenIssueReportGithubPayload(
  payload: unknown,
): OpenIssueReportGithubInput {
  if (!isRecord(payload) || typeof payload.githubIssueUrl !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for issue-report:open-github.',
    })
  }

  const githubIssueUrl = payload.githubIssueUrl.trim()
  if (githubIssueUrl.length === 0 || githubIssueUrl.length > MAX_GITHUB_ISSUE_URL_LENGTH) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid GitHub issue URL.',
    })
  }

  return { githubIssueUrl }
}

export function normalizeShowIssueReportFilePayload(payload: unknown): ShowIssueReportFileInput {
  if (!isRecord(payload) || typeof payload.reportPath !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for issue-report:show-file.',
    })
  }

  const reportPath = payload.reportPath.trim()
  if (reportPath.length === 0 || reportPath.length > 2_000) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid issue report path.',
    })
  }

  return { reportPath }
}
