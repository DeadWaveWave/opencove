export interface ClaudeUserOrigin {
  type?: unknown
  isMeta?: unknown
  promptSource?: unknown
  origin?: unknown
  turnOrigin?: unknown
}
export function hasClaudeHumanOrigin(record: ClaudeUserOrigin): boolean {
  return (
    record.promptSource === 'typed' ||
    record.turnOrigin === 'human' ||
    (!!record.origin &&
      typeof record.origin === 'object' &&
      'kind' in record.origin &&
      record.origin.kind === 'human')
  )
}
/** Text never establishes provenance. Linked local-command evidence is folded per file. */
export function isClaudeAuxiliaryUser(record: ClaudeUserOrigin): boolean {
  return record.type === 'user' && record.isMeta === true && !hasClaudeHumanOrigin(record)
}
