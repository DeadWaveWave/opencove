function code(value: unknown): unknown {
  return value && typeof value === 'object' && 'code' in value ? value.code : undefined
}

/** Only a transport errno establishes refusal; prose and other failures are unclassified. */
export function isConnectionRefused(error: unknown): boolean {
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
  return code(error) === 'ECONNREFUSED' || code(cause) === 'ECONNREFUSED'
}
