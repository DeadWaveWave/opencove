export function taskClaimErrorPresentation(error: { code?: string; details?: unknown }) {
  if (error.code !== 'task.already_claimed') {
    return undefined
  }
  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : {}
  const holder =
    details.holder && typeof details.holder === 'object'
      ? (details.holder as Record<string, unknown>)
      : {}
  const title =
    typeof holder.title === 'string'
      ? holder.title
      : typeof holder.nodeId === 'string'
        ? holder.nodeId
        : 'another agent'
  return {
    holder: title,
    message: `This task is already claimed by ${title}.`,
    hint: 'Choose another task, or ask the holder or user to release this task.',
  }
}
