import type { AppErrorCode, AppErrorDescriptor, AppErrorParams } from '../contracts/dto'
import type { IpcInvokeResult } from '../contracts/ipc'

function createMessageMap(): Record<AppErrorCode, string> {
  return {
    'common.invalid_input': 'The request was invalid.',
    'common.approved_path_required': 'The selected path is outside approved workspaces.',
    'common.unavailable': 'This feature is unavailable.',
    'common.unexpected': 'Something went wrong. Please try again.',
    'space.not_found': 'Space not found.',
    'session.not_found': 'Session not found.',
    'control_surface.unauthorized': 'Unauthorized request.',
    'integration.github.unavailable': 'GitHub integration is unavailable.',
    'integration.github.resolve_failed': 'Unable to load pull request info.',
    'integration.github.action_failed': 'Unable to run pull request action.',
    'workspace.select_directory_failed': 'Unable to open the directory picker.',
    'workspace.ensure_directory_failed': 'Unable to create the directory.',
    'workspace.copy_path_failed': 'Unable to copy the path.',
    'workspace.list_path_openers_failed': 'Unable to load available path openers.',
    'workspace.open_path_failed': 'Unable to open the path.',
    'workspace.canvas_image_write_failed': 'Unable to save the canvas image.',
    'workspace.canvas_image_read_failed': 'Unable to load the canvas image.',
    'workspace.canvas_image_delete_failed': 'Unable to delete the canvas image.',
    'filesystem.create_directory_failed': 'Unable to create the directory.',
    'filesystem.read_file_bytes_failed': 'Unable to read the file.',
    'filesystem.read_file_text_failed': 'Unable to read the file.',
    'filesystem.write_file_text_failed': 'Unable to save the file.',
    'filesystem.copy_entry_failed': 'Unable to copy the file or folder.',
    'filesystem.move_entry_failed': 'Unable to move the file or folder.',
    'filesystem.rename_entry_failed': 'Unable to rename the file or folder.',
    'filesystem.delete_entry_failed': 'Unable to delete the file or folder.',
    'filesystem.read_directory_failed': 'Unable to load the directory.',
    'filesystem.stat_failed': 'Unable to read file details.',
    'worktree.api_unavailable':
      'Worktree API is unavailable. Please restart OpenCove and try again.',
    'worktree.list_branches_failed': 'Unable to load Git branches.',
    'worktree.list_worktrees_failed': 'Unable to load Git worktrees.',
    'worktree.status_summary_failed': 'Unable to load Git status.',
    'worktree.get_default_branch_failed': 'Unable to determine the default branch.',
    'worktree.repo_has_no_commits':
      'This Git repository has no commits yet. Create an initial commit to use worktrees.',
    'worktree.create_failed': 'Unable to create the worktree.',
    'worktree.remove_failed': 'Unable to archive the worktree.',
    'worktree.remove_uncommitted_changes':
      'This worktree has uncommitted changes. Commit or stash them before archiving.',
    'worktree.rename_branch_failed': 'Unable to rename the branch.',
    'worktree.suggest_names_failed': 'Unable to suggest worktree names.',
    'worktree.remove_branch_cleanup_failed':
      'The worktree was archived, but the branch could not be deleted.',
    'worktree.remove_directory_cleanup_failed':
      'The worktree was archived, but the worktree directory could not be removed.',
    'terminal.spawn_failed': 'Unable to start the terminal.',
    'terminal.write_failed': 'Unable to write to the terminal.',
    'terminal.resize_failed': 'Unable to resize the terminal.',
    'terminal.kill_failed': 'Unable to close the terminal.',
    'terminal.attach_failed': 'Unable to attach the terminal session.',
    'terminal.detach_failed': 'Unable to detach the terminal session.',
    'terminal.snapshot_failed': 'Unable to read terminal output.',
    'agent.list_models_failed': 'Unable to load models for this provider.',
    'agent.launch_failed': 'Unable to start the agent.',
    'agent.read_last_message_failed': 'Unable to read the last agent message.',
    'agent.resume_session_resolve_failed': 'Unable to resolve the previous agent session.',
    'task.suggest_title_failed': 'Unable to generate task details.',
    'persistence.unavailable': 'Storage is unavailable; changes will not be saved.',
    'persistence.quota_exceeded': 'Storage quota was exceeded.',
    'persistence.payload_too_large': 'Workspace state is too large to save.',
    'persistence.io_failed': 'Unable to save data to storage.',
    'persistence.invalid_state': 'The workspace state could not be saved.',
    'persistence.invalid_node_id': 'The terminal history could not be saved.',
    'update.get_state_failed': 'Unable to read the update status.',
    'update.configure_failed': 'Unable to apply update settings.',
    'update.check_failed': 'Unable to check for updates.',
    'update.download_failed': 'Unable to download the update.',
    'update.install_failed': 'Unable to install the update.',
    'release_notes.get_current_failed': 'Unable to load release notes.',
  }
}

const APP_ERROR_MESSAGES = createMessageMap()

function normalizeDebugMessage(error: unknown): string | undefined {
  if (error instanceof OpenCoveAppError) {
    return error.debugMessage
  }

  if (error instanceof Error) {
    return error.message.length > 0 ? `${error.name}: ${error.message}` : error.name
  }

  if (typeof error === 'string') {
    return error.length > 0 ? error : undefined
  }

  return undefined
}

export function createAppErrorDescriptor(
  code: AppErrorCode,
  options: {
    params?: AppErrorParams
    debugMessage?: string
  } = {},
): AppErrorDescriptor {
  return {
    code,
    ...(options.params ? { params: options.params } : {}),
    ...(options.debugMessage ? { debugMessage: options.debugMessage } : {}),
  }
}

export function isAppErrorDescriptor(value: unknown): value is AppErrorDescriptor {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.code === 'string' && record.code in APP_ERROR_MESSAGES
}

export class OpenCoveAppError extends Error {
  public readonly code: AppErrorCode
  public readonly params: AppErrorParams | undefined
  public readonly debugMessage: string | undefined

  public constructor(descriptor: AppErrorDescriptor) {
    super(formatAppErrorMessage(descriptor))
    this.name = 'OpenCoveAppError'
    this.code = descriptor.code
    this.params = descriptor.params
    this.debugMessage = descriptor.debugMessage
  }

  public toDescriptor(): AppErrorDescriptor {
    return createAppErrorDescriptor(this.code, {
      params: this.params,
      debugMessage: this.debugMessage,
    })
  }
}

export function createAppError(
  codeOrDescriptor: AppErrorCode | AppErrorDescriptor,
  options: {
    params?: AppErrorParams
    debugMessage?: string
  } = {},
): OpenCoveAppError {
  const descriptor =
    typeof codeOrDescriptor === 'string'
      ? createAppErrorDescriptor(codeOrDescriptor, options)
      : codeOrDescriptor

  return new OpenCoveAppError(descriptor)
}

export function toAppErrorDescriptor(
  error: unknown,
  fallbackCode: AppErrorCode = 'common.unexpected',
): AppErrorDescriptor {
  if (error instanceof OpenCoveAppError) {
    return error.toDescriptor()
  }

  if (isAppErrorDescriptor(error)) {
    return error
  }

  return createAppErrorDescriptor(fallbackCode, {
    debugMessage: normalizeDebugMessage(error),
  })
}

export function formatAppErrorMessage(error: AppErrorDescriptor | OpenCoveAppError): string {
  const descriptor = error instanceof OpenCoveAppError ? error.toDescriptor() : error
  return APP_ERROR_MESSAGES[descriptor.code] ?? APP_ERROR_MESSAGES['common.unexpected']
}

export function getAppErrorDebugMessage(
  error: AppErrorDescriptor | OpenCoveAppError | Error | string | null | undefined,
): string | undefined {
  if (!error) {
    return undefined
  }

  if (error instanceof OpenCoveAppError) {
    return error.debugMessage
  }

  if (isAppErrorDescriptor(error)) {
    return error.debugMessage
  }

  return normalizeDebugMessage(error)
}

export function isIpcInvokeResult<T>(value: unknown): value is IpcInvokeResult<T> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return record.__opencoveIpcEnvelope === true && typeof record.ok === 'boolean'
}
