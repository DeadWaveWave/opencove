export function serializeCodexTomlString(value: string, runtimePlatform: NodeJS.Platform): string {
  if (runtimePlatform !== 'win32') {
    return JSON.stringify(value)
  }
  const literal = serializeCodexTomlLiteralString(value)
  if (literal) {
    return literal
  }
  throw new Error('Codex configuration contains an unsupported TOML literal string.')
}

export function serializeCodexTomlStringArray(
  values: readonly string[],
  runtimePlatform: NodeJS.Platform,
): string {
  return `[${values.map(value => serializeCodexTomlString(value, runtimePlatform)).join(',')}]`
}

export function serializeCodexTomlLiteralString(value: string): string | null {
  if (!value.includes("'") && !value.includes('\n') && !value.includes('\r')) {
    return `'${value}'`
  }
  if (value.includes("'''")) {
    return null
  }
  return `'''${value}'''`
}
