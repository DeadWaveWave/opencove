import type { AppErrorDescriptor } from '../contracts/dto'

const inspect =
  'Do not resend. Inspect the terminal with "opencove agent read --node <selector> --screen" and the conversation before retrying.'
export const promptUnknownRecovery = inspect

/** Presentation only: never infer attempt flags from an absent descriptor field. */
export function agentPromptErrorPresentation(
  error: AppErrorDescriptor,
): { message: string; hint: string } | undefined {
  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : {}
  const reason = details.reason
  const zero = details.pasteDispatchAttempted === false && details.submitDispatchAttempted === false
  const nothing = zero ? ' Nothing was sent by this call.' : ''
  const pair = (message: string, hint: string) => ({ message: message + nothing, hint })
  switch (error.code) {
    case 'agent.blocked':
      return pair(
        'The agent is waiting for input.',
        'Inspect with "opencove agent read --node <selector> --screen"; have the human resolve the pending dialog, then retry after the agent is idle.',
      )
    case 'agent.delivery_unsettled':
      return pair(
        'A previous delivery is unresolved.',
        `Never resend; check opencove agent delivery ${details.deliveryId ?? '<id>'} --wait or inspect the screen.`,
      )
    case 'agent.busy':
      if (reason === 'competing_input') {
        return pair(
          'Other input reached the agent before this delivery could submit.',
          'Inspect the screen and editor before deciding what to do next.',
        )
      }
      if (reason === 'expected_turn_mismatch') {
        return pair(
          'The requested turn is no longer the active working turn.',
          'Inspect currentState in the error details and agent get; no new turn is started by --expect-turn.',
        )
      }
      if (reason === 'delivery_in_progress') {
        return pair(
          'Another prompt delivery is in progress for this agent.',
          "Wait for that delivery's result before deciding whether another prompt is needed.",
        )
      }
      if (reason === 'working') {
        return pair(
          'The agent is still working.',
          'Wait for the current turn to finish, then retry.',
        )
      }
      return pair(
        'The agent cannot accept another prompt yet.',
        "Check the agent's current activity before retrying.",
      )
    case 'agent.state_unknown':
      if (reason === 'history_saturated') {
        return {
          message:
            'This Claude session was cleared too many times for OpenCove to track it safely.',
          hint: 'Restart the agent window to send prompts again; the conversation itself is unaffected.',
        }
      }
      if (reason === 'readiness_unobserved') {
        return pair(
          'OpenCove cannot confirm that the agent is ready for a prompt.',
          'Inspect the terminal and resolve any pending dialog. Retry after a completed turn or an observed Claude Code /clear reports the agent ready.',
        )
      }
      if (reason === 'observation_degraded') {
        return pair(
          'OpenCove cannot reliably observe this agent.',
          'Check the hook setup. Retry only after reliable observation returns and the agent is ready.',
        )
      }
      return pair(
        'OpenCove cannot confirm that the agent is ready.',
        'Inspect "opencove agent read --node <selector> --screen" and agent get before retrying.',
      )
    case 'agent.not_running':
      if (reason === 'caller_revoked') {
        return pair(
          'The request lost authorization or its caller disconnected before delivery.',
          'Reconnect or sign in again, then check the target before retrying.',
        )
      }
      if (reason === 'shutdown') {
        return pair(
          'OpenCove stopped before delivery began.',
          'Reconnect after OpenCove starts, then check the target before retrying.',
        )
      }
      if (reason === 'binding_changed') {
        return pair(
          'The target session changed before delivery began.',
          'Check the current agent node and session before retrying.',
        )
      }
      if (reason === 'not_running') {
        return pair(
          'No running agent was found for this target.',
          'Check the node ID and start or resume its agent session.',
        )
      }
      return pair(
        'OpenCove could not begin delivery to this agent.',
        'Check the target session and connection before retrying.',
      )
    case 'agent.prompt_unsupported':
      if (reason === 'executable_override_unverified') {
        return pair(
          'Prompting is unavailable because this agent window was started with a custom executable path (Settings → agent executable). OpenCove cannot verify that it keeps the hooks required for prompting.',
          'Remove the override in Settings → agent executable, then launch a new agent window with the required lifecycle hooks to make it promptable.',
        )
      }
      if (reason === 'terminal_agent_unsupported') {
        return pair(
          'Agents typed into a terminal cannot receive prompts because the shell would receive the input after the agent stops.',
          'Start an agent meant to receive prompts (for example a lead agent other agents report to) as an agent window: Run Agent on a task, the agent launcher, or "opencove node create agent --space <space> --prompt <text>"; it can still use the opencove CLI from there.',
        )
      }
      if (reason === 'remote_unsupported') {
        return pair(
          'Prompt delivery to remote sessions is not supported.',
          'Select a local Claude Code or lifecycle-hook Codex agent window OpenCove launched.',
        )
      }
      if (reason === 'provider_unsupported') {
        return pair(
          'This command supports local Claude Code and lifecycle-hook Codex agent windows OpenCove launched.',
          'Select a local Claude Code or lifecycle-hook Codex agent window OpenCove launched.',
        )
      }
      const missing: Record<string, string> = {
        codex_hooks_notify_only:
          'Codex has only notify-level coverage; lifecycle hooks are not verified for this launch.',
        codex_hooks_skipped: 'Codex hooks were skipped for daemon reuse.',
        codex_hooks_not_required:
          'This Codex launch uses session files instead of lifecycle hooks (including Windows).',
        codex_hooks_not_installed: 'Codex lifecycle hooks are not installed for this invocation.',
        codex_hooks_partial: 'Codex lifecycle hook installation is incomplete.',
        codex_hooks_error: 'Codex lifecycle hook installation failed.',
        codex_hooks_missing: 'This Codex invocation has no explicit lifecycle hook coverage.',
        codex_lifecycle_observation_missing:
          'Codex readiness comes from a session file; a lifecycle hook Stop is required.',
        claude_hooks_missing:
          'This Claude Code invocation has no explicit lifecycle hook coverage.',
      }
      if (typeof reason === 'string' && missing[reason]) {
        return pair(
          missing[reason],
          'Start a local agent with lifecycle hooks, then complete a turn observed by those hooks before retrying.',
        )
      }
      if (reason === 'bracketed_paste_off') {
        return pair(
          'The terminal has not enabled bracketed paste.',
          'Use "opencove agent read --node <selector> --screen" to check that the agent is at its prompt, then retry. This command does not fall back to raw typing.',
        )
      }
      return pair(
        'This session does not support prompt delivery.',
        'Use a local agent window OpenCove launched with lifecycle hooks and bracketed paste enabled.',
      )
    case 'agent.prompt_interrupted':
      return {
        message:
          'Prompt delivery stopped after a paste attempt. Text may be in the editor; this command did not press Enter.',
        hint: 'Inspect the editor with "opencove agent read --node <selector> --screen" and have the human resolve any dialog before continuing. Do not paste the text again if it is already there.',
      }
    case 'agent.prompt_stalled':
      return {
        message:
          'OpenCove attempted to press Enter but did not observe a matching submission event.',
        hint: 'Do not resend. Inspect "opencove agent read --node <selector> --screen" and the conversation to determine whether the prompt was submitted.',
      }
    case 'agent.prompt_timeout':
      return {
        message: 'The delivery timeout expired before any text was sent.',
        hint: 'Check the target. You may retry this call; use --timeout to allow more time, up to 60s.',
      }
    default:
      return undefined
  }
}

export function promptValidationPresentation(details: unknown): { message: string; hint: string } {
  const record = details && typeof details === 'object' ? (details as Record<string, unknown>) : {}
  const issue = Array.isArray(record.issues)
    ? (record.issues[0] as { path?: unknown[]; message?: string; hint?: string })
    : undefined
  return issue
    ? {
        message: `Invalid prompt request: ${issue.path?.join('.') || 'input'}: ${issue.message ?? 'invalid value'}${issue.message?.includes('Nothing was sent') ? '' : ' Nothing was sent.'}`,
        hint: issue.hint ?? 'Run opencove agent prompt --help for the supported input.',
      }
    : {
        message: 'The prompt request is invalid. Nothing was sent.',
        hint: 'Check the target, text and timeout requirements in opencove agent prompt --help.',
      }
}
