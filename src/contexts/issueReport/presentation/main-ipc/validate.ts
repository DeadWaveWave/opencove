import type {
  IssueReportContextInput,
  IssueReportKind,
  OpenIssueReportGithubInput,
  PrepareIssueReportInput,
  ShowIssueReportFileInput,
} from '@shared/contracts/dto'
import { ISSUE_REPORT_KINDS } from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'

const MAX_TITLE_LENGTH = 180
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_CONTEXT_TEXT_LENGTH = 1_024

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
  if (githubIssueUrl.length === 0 || githubIssueUrl.length > 2_500) {
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
