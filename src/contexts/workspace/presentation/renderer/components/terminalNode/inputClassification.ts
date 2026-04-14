const CSI_PREFIX = '\u001b['
const AUTOMATIC_TERMINAL_REPLY_PATTERNS = [
  /^\d+;\d+R$/u,
  /^\?\d+;\d+R$/u,
  /^\?\d+(?:;\d+)*c$/u,
  /^>\d+(?:;\d+)*c$/u,
  /^\?\d+(?:;\d+)*u$/u,
]

export function isAutomaticTerminalReply(data: string): boolean {
  if (!data.startsWith(CSI_PREFIX)) {
    return false
  }

  const payload = data.slice(CSI_PREFIX.length)
  return AUTOMATIC_TERMINAL_REPLY_PATTERNS.some(pattern => pattern.test(payload))
}
