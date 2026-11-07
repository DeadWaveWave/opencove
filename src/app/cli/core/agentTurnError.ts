import { CliError } from './errors'
import { shellWord } from './shellWord'

export interface AgentTurnErrorContext {
  nodeId?: string
  sessionId?: string
  turnId?: string
}

/** Presentation only: retain machine-readable codes/reasons and add concrete recovery commands. */
export function presentAgentTurnError(error: CliError, context: AgentTurnErrorContext): CliError {
  if (!['agent.final_message_unavailable', 'agent.wait_turn_unavailable'].includes(error.code)) {
    return error
  }
  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : {}
  const ids = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined))
  const merged = { ...details, ...ids }
  const nodeId = typeof merged.nodeId === 'string' ? merged.nodeId : undefined
  const sessionId = typeof merged.sessionId === 'string' ? merged.sessionId : undefined
  const turnId = typeof merged.turnId === 'string' ? merged.turnId : undefined
  const node = nodeId ? shellWord(nodeId) : '<selector>'
  const turn = turnId ? shellWord(turnId) : '<turnId>'
  const get = `opencove agent get --node ${node}`
  const screen = `opencove agent read --node ${node} --screen`
  const transcript = sessionId
    ? `opencove session final --session ${shellWord(sessionId)}`
    : undefined
  const commands = (...lines: (string | undefined)[]) =>
    `Run:\n${lines
      .filter(line => line !== undefined)
      .map(line => `  ${line}`)
      .join('\n')}`
  const inspectOutput = commands(screen, transcript)
  const label = turnId ? `Turn ${turnId}` : 'The selected turn'
  let message: string, hint: string
  switch (details.reason) {
    case 'turn_not_ended':
      message = `${label} is still running.`
      hint = commands(`opencove agent wait --node ${node} --turn ${turn}`)
      break
    case 'turn_not_found':
      message = `${label} is not in the last 8 ended turns of this agent session; it may have been evicted, belong to another session, or have been cleared by restart.`
      hint = commands(get)
      break
    case 'provider_sent_no_message':
      message = `${label} ended, but the provider sent no final message.`
      hint = `Inspect the terminal or provider transcript.\n${sessionId ? inspectOutput : commands(get, screen)}${sessionId ? '' : '\nUse the sessionId from agent get to inspect the saved transcript.'}`
      break
    case 'no_ended_turn':
      message = 'This agent session has no retained ended turn.'
      hint = `Inspect the current agent and available output.\n${commands(get, screen, transcript)}`
      break
    case 'remote_history_unavailable':
      message = `${label} cannot be checked in this Worker's remote turn history.`
      hint = `Older turns of remote agents can only be checked on the Worker that runs them. Inspect the current agent and available output.\n${commands(get, screen, transcript)}`
      break
    default:
      return error
  }
  return new CliError(error.code, error.exitCode, message, hint, merged, error.debugMessage)
}
