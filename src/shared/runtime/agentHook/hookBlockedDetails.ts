import type { AgentBlockedSummary, AgentRunSnapshot } from '../../contracts/dto/agentRunState'

interface HookDialogInput {
  state: string | null
  hookEventName?: string
  notificationType?: string
  tool?: { name: string; input?: unknown }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function boundedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  // Slice before iteration to bound work even for oversized/untrusted strings.
  const chars = [...value.slice(0, 401)]
  return chars.length > 200 ? `${chars.slice(0, 199).join('')}…` : value
}
function dialogSummary(tool: HookDialogInput['tool']): AgentBlockedSummary | null {
  if (tool?.name === 'ExitPlanMode') {
    return { kind: 'plan' }
  }
  if (tool?.name !== 'AskUserQuestion' || !isRecord(tool.input)) {
    return null
  }
  if (!Array.isArray(tool.input.questions)) {
    return null
  }
  const questions = tool.input.questions.slice(0, 3).flatMap(value => {
    if (!isRecord(value)) {
      return []
    }
    const question = boundedText(value.question)
    if (!question) {
      return []
    }
    const options = Array.isArray(value.options)
      ? value.options.slice(0, 4).flatMap(option => {
          const label = isRecord(option) ? boundedText(option.label) : null
          return label ? [label] : []
        })
      : []
    return [{ question, options }]
  })
  return questions.length ? { kind: 'question', questions } : null
}

/** Public dialog data only. Never forward arbitrary tool input or notification messages. */
export function resolveHookBlockedDetails(input: HookDialogInput): {
  blockedReason?: AgentRunSnapshot['blockedReason']
  blockedSummary?: AgentBlockedSummary
} {
  if (input.state !== 'waiting') {
    return {}
  }
  // The dialog tool decides the reason: Claude also sends PermissionRequest for these tools.
  const blockedReason =
    input.tool?.name === 'AskUserQuestion'
      ? 'question'
      : input.tool?.name === 'ExitPlanMode'
        ? 'plan'
        : input.hookEventName === 'PermissionRequest'
          ? 'permission'
          : input.notificationType === 'permission_prompt'
            ? 'permission'
            : ['elicitation_dialog', 'elicitation_url_dialog'].includes(
                  input.notificationType ?? '',
                )
              ? 'question'
              : null
  const blockedSummary = dialogSummary(input.tool)
  return {
    ...(blockedReason ? { blockedReason } : {}),
    ...(blockedSummary ? { blockedSummary } : {}),
  }
}
