// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who } from './cliIdentity.helpers'

it.skipIf(process.platform !== 'win32').each(['grouped', 'ungrouped', 'help'])(
  'preserves literal @self in PowerShell %s commands',
  async mode => {
    const f = identityFixture()
    let examples: string[]
    if (mode === 'help') {
      expect(await run(['context', '--help'], f.io)).toBe(0)
      examples = f
        .out()
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('opencove ') && line.includes('@self'))
    } else {
      if (mode === 'ungrouped') {
        f.io.env.OPENCOVE_SPACE_ID = ''
        f.values['system.whoami'] = { ...who, spaceId: '' }
      } else {
        f.values['node.list'] = {
          nodes: [{ id: 'task', kind: 'task', title: 'Todo', data: { status: 'doing' } }],
        }
      }
      expect(await run(['context'], f.io)).toBe(0)
      examples = JSON.parse(f.out()).next
    }
    const script = [
      // A bare @self would splat this trap into the invocation arguments.
      '$self = @("WRONG-TARGET")',
      'function opencove { ConvertTo-Json -Compress -InputObject @($args) }',
      ...examples,
    ].join('\n')
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const captured = result.stdout
      .trim()
      .split(/\r?\n/)
      .map(line => JSON.parse(line) as string[])
    expect(captured).toHaveLength(examples.length)
    for (const [i, command] of examples.entries()) {
      expect(captured[i]).not.toContain('WRONG-TARGET')
      const selector = /--(node|space|project)\s+["']?@self/.exec(command)
      if (selector) {
        const flagIndex = captured[i].indexOf(`--${selector[1]}`)
        expect(flagIndex).toBeGreaterThanOrEqual(0)
        expect(captured[i][flagIndex + 1]).toBe('@self')
      }
    }
  },
)
