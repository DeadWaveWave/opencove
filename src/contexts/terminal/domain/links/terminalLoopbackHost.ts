/** URL.hostname is normalized by the URL parser before this policy is applied. */
export function isTerminalLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    host === '0.0.0.0' ||
    host === '[::]' ||
    host === '[::1]' ||
    /^\[::ffff:7f[0-9a-f]{2}:/.test(host)
  )
}
