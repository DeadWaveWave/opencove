import type { AppErrorDescriptor } from '../contracts/dto'

const inspect = 'Do not resend. Inspect the agent terminal and conversation before retrying.'
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
        'Resolve the pending dialog in the agent terminal, then retry after the agent is idle.',
      )
    case 'agent.busy':
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
      if (reason === 'readiness_unobserved') {
        return pair(
          'OpenCove has not observed this agent finish a turn.',
          'Complete a turn in the agent terminal, then retry after OpenCove reports idle.',
        )
      }
      if (reason === 'observation_degraded') {
        return pair(
          'OpenCove cannot reliably observe this agent.',
          'Check the hook setup. Retry only after OpenCove observes a completed turn.',
        )
      }
      return pair(
        'OpenCove cannot confirm that the agent is ready.',
        'Inspect the agent terminal and its reported state before retrying.',
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
      if (reason === 'remote_unsupported') {
        return pair(
          'Prompt delivery to remote sessions is not supported.',
          'Select a local Claude Code agent node.',
        )
      }
      if (reason === 'provider_unsupported') {
        return pair(
          'This command supports local Claude Code sessions only.',
          'Select a local Claude Code agent node.',
        )
      }
      if (reason === 'bracketed_paste_off') {
        return pair(
          'The terminal has not enabled bracketed paste.',
          'Check that Claude Code is at its prompt, then retry. This command does not fall back to raw typing.',
        )
      }
      return pair(
        'This session does not support prompt delivery.',
        'Use a local Claude Code session with working hooks and bracketed paste enabled.',
      )
    case 'agent.prompt_interrupted':
      return {
        message:
          'Prompt delivery stopped after a paste attempt. Text may be in the editor; this command did not press Enter.',
        hint: 'Inspect the editor and resolve any dialog before continuing. Do not paste the text again if it is already there.',
      }
    case 'agent.prompt_stalled':
      return {
        message:
          'OpenCove attempted to press Enter but did not observe a matching submission event.',
        hint: 'Do not resend. Inspect the agent terminal and conversation to determine whether the prompt was submitted.',
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
