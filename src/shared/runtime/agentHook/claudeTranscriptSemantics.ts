/** Display-only Claude records carry no evidence that a prompt is being processed. */
export function isClaudeAuxiliaryUser(record: {
  type?: unknown
  isMeta?: unknown
  promptId?: unknown
  promptSource?: unknown
  message?: { content?: unknown }
}): boolean {
  if (record.type !== 'user') {
    return false
  }
  if (record.isMeta === true) {
    return true
  }
  if (record.promptId !== undefined || record.promptSource !== undefined) {
    return false
  }
  const content = record.message?.content
  if (typeof content !== 'string') {
    return false
  }
  const text = content.trim()
  return (
    text === '/clear' ||
    /^<command-name>\/clear<\/command-name>\s*(?:<command-message>clear<\/command-message>\s*)?(?:<command-args><\/command-args>)?$/u.test(
      text,
    ) ||
    /^<local-command-(caveat|stdout)>[\s\S]*<\/local-command-\1>$/u.test(text)
  )
}
