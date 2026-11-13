export const taskMutationAccessMessage =
  'You can claim or release tasks only for your own agents or agents you started.'
export const taskMutationAccessHint =
  'Choose your own agent or one you started, or ask the user to assign the task.'

export function taskMutationAccessErrorPresentation(error: { code?: string; details?: unknown }) {
  if (error.code !== 'common.forbidden') {
    return undefined
  }
  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : {}
  if (details.reason !== 'agent_identity_mismatch' && details.reason !== 'not_current_holder') {
    return undefined
  }
  return { message: taskMutationAccessMessage, hint: taskMutationAccessHint }
}
