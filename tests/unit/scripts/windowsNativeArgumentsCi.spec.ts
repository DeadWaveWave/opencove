// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('executes native argument assertions on Windows with an explicitly provisioned WSL guest', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  const job = workflow.slice(workflow.indexOf('  platform-e2e-windows:'))
  expect(job).toContain('tests/integration/terminal/windowsNativeArguments.windows.spec.ts')
  expect(job).toContain('ELECTRON_RUN_AS_NODE:')
  expect(job).toContain('scripts/prepare-wsl-native-arguments.ps1')
  expect(job).toContain('scripts/remove-wsl-native-arguments.ps1')
  expect(job).toContain('if: always()')
  expect(job).toContain('**/*.windows.spec.ts,**/agent.initial-prompt-argv.spec.ts')
})
