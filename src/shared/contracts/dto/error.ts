export const APP_ERROR_CODES = [
  'common.invalid_input',
  'common.approved_path_required',
  'common.unavailable',
  'common.unexpected',
  'integration.github.unavailable',
  'integration.github.resolve_failed',
  'integration.github.action_failed',
  'workspace.select_directory_failed',
  'workspace.ensure_directory_failed',
  'workspace.copy_path_failed',
  'workspace.list_path_openers_failed',
  'workspace.open_path_failed',
  'worktree.api_unavailable',
  'worktree.list_branches_failed',
  'worktree.list_worktrees_failed',
  'worktree.status_summary_failed',
  'worktree.get_default_branch_failed',
  'worktree.create_failed',
  'worktree.remove_failed',
  'worktree.remove_uncommitted_changes',
  'worktree.rename_branch_failed',
  'worktree.suggest_names_failed',
  'worktree.remove_branch_cleanup_failed',
  'worktree.remove_directory_cleanup_failed',
  'terminal.spawn_failed',
  'terminal.write_failed',
  'terminal.resize_failed',
  'terminal.kill_failed',
  'terminal.attach_failed',
  'terminal.detach_failed',
  'terminal.snapshot_failed',
  'agent.list_models_failed',
  'agent.launch_failed',
  'agent.read_last_message_failed',
  'agent.resume_session_resolve_failed',
  'task.suggest_title_failed',
  'persistence.unavailable',
  'persistence.quota_exceeded',
  'persistence.payload_too_large',
  'persistence.io_failed',
  'persistence.invalid_state',
  'persistence.invalid_node_id',
  'update.get_state_failed',
  'update.configure_failed',
  'update.check_failed',
  'update.download_failed',
  'update.install_failed',
  'release_notes.get_range_failed',
] as const

export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export type AppErrorParamValue = boolean | number | string | null

export type AppErrorParams = Record<string, AppErrorParamValue>

export interface AppErrorDescriptor {
  code: AppErrorCode
  params?: AppErrorParams
  debugMessage?: string
}
