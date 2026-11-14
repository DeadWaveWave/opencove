import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('root creation outside OpenCove requires a project before connecting', () => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENCOVE_')) {
      delete env[key]
    }
  }
  const result = spawnSync(
    process.execPath,
    [resolve('out/cli/opencove.mjs'), 'node', 'create', 'note', '--root-canvas'],
    { env, encoding: 'utf8' },
  )
  expect(result.status).toBe(2)
  expect(result.stdout).toBe('')
  expect(JSON.parse(result.stderr).error.message).toBe(
    '--root-canvas needs a project outside OpenCove: add --project <id>',
  )
})
