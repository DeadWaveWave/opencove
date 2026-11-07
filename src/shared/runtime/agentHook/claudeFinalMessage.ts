/** Private hook content; byte limits apply to UTF-8, never split a code point. */
export function claudeFinalMessage(value: unknown, alreadyTruncated: unknown) {
  if (typeof value !== 'string' || !value.isWellFormed()) {
    return undefined
  }
  const bytes = Buffer.from(value, 'utf8')
  let end = Math.min(bytes.length, 64 * 1024)
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
    end--
  }
  return {
    message: bytes.subarray(0, end).toString('utf8'),
    truncated: alreadyTruncated === true || end < bytes.length,
  }
}
