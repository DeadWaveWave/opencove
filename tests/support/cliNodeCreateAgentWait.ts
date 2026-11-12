/** Shared by the PTY E2E and its TTY output-contract regression. */
export function createAgentWaitArgs(provider: string, prompt: string): string[] {
  return [
    'node',
    'create',
    'agent',
    '--root-canvas',
    '--provider',
    provider,
    '--prompt',
    prompt,
    '--wait',
    '--read',
    '--timeout',
    '10s',
    '-o',
    'json',
  ]
}
