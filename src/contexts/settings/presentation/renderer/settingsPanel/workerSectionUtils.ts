export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function toBaseUrl(connection: { hostname: string; port: number }): string {
  return `http://${connection.hostname}:${connection.port}`
}

export function formatToken(token: string, revealed: boolean): string {
  if (revealed) {
    return token
  }

  if (token.length <= 10) {
    return '•'.repeat(Math.max(6, token.length))
  }

  return `${token.slice(0, 4)}…${token.slice(-4)}`
}
