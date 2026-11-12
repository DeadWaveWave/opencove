// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { spaceComparisonCommand } from '../../e2e/cli.output.helpers'

it.skipIf(process.platform !== 'win32')(
  'preserves the list E2E selector in Windows PowerShell',
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          '$self = @("WRONG-TARGET")',
          'function opencove { ConvertTo-Json -Compress -InputObject @($args) }',
          spaceComparisonCommand,
        ].join('\n'),
      ],
      { encoding: 'utf8', timeout: 10000 },
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const args = JSON.parse(result.stdout.trim()) as string[]
    expect(args).not.toContain('WRONG-TARGET')
    expect(args[args.indexOf('--space') + 1]).toBe('@self')
  },
)
