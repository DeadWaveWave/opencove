// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { nodeCreateInput } from '../../../src/shared/contracts/controlSurface/operations/domains/nodeInputs'
import { identityFixture, node, who } from './cliIdentity.helpers'
import { defineCommand } from '../../../src/app/cli/core/command'
import { help } from '../../../src/app/cli/core/help'

it.each(['create', 'update'])(
  'uses the correct article in node %s help for every kind',
  async action => {
    for (const [kind, article] of [
      ['agent', 'an'],
      ['note', 'a'],
      ['task', 'a'],
      ['website', 'a'],
      ['terminal', 'a'],
    ]) {
      const f = identityFixture(false)
      // eslint-disable-next-line no-await-in-loop
      expect(await run(['node', action, kind, '--help'], f.io)).toBe(0)
      expect(f.out()).toContain(
        `${action === 'create' ? 'Create' : 'Update'} ${article} ${kind} node`,
      )
      expect(f.fetch).not.toHaveBeenCalled()
    }
  },
)

it('lists exactly the accepted provider IDs in node create agent help', async () => {
  const parsed = nodeCreateInput.safeParse({
    kind: 'agent',
    data: { provider: 'invalid-provider' },
  })
  if (parsed.success) {
    throw Error('Invalid provider was accepted')
  }
  const issue = parsed.error.issues.find(item => item.code === 'invalid_value')
  if (issue?.code !== 'invalid_value') {
    throw Error('Provider choices were not reported')
  }
  const providers = issue.values.filter(value => value !== '')
  const f = identityFixture(false)
  expect(await run(['node', 'create', 'agent', '--help'], f.io)).toBe(0)
  const option = f
    .out()
    .split('\n')
    .find(line => line.includes('--provider'))!
  expect(option).toContain(`Accepted IDs: ${providers.join(', ')}`)
  expect(option).toContain('omit to use the configured default')
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([
  ['node', 'get'],
  ['node', 'list'],
  ...['note', 'task', 'website', 'agent', 'terminal'].map(kind => ['node', 'create', kind]),
  ['agent', 'get'],
  ['agent', 'list'],
  ['context'],
])('defines lineage fields in %j help', async (...path) => {
  const f = identityFixture(false)
  expect(await run([...path, '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('Field descriptions:')
  expect(f.out()).toContain(
    'A node started by the user has lineageDepth 1; each agent-created generation adds one',
  )
  expect(f.out()).toContain('ID of the node that created this node')
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(['', 'canvas'])('defines depth in the offline %s skill', async topic => {
  const f = identityFixture(false)
  expect(await run(['skill', ...(topic ? [topic] : [])], f.io)).toBe(0)
  expect(f.out()).toContain(
    'A node started by the user has `lineageDepth` 1; each agent-created generation adds one',
  )
  expect(f.fetch).not.toHaveBeenCalled()
})

it('omits descriptions for fields outside a command’s output contract', () => {
  const command = defineCommand({
    path: ['sample'],
    summary: 'Read a sample',
    connect: false,
    render: {
      fields: ['title'],
      fieldDescriptions: { title: 'Sample title', lineageDepth: 'Hidden lineage description' },
    },
  })
  const text = help([command], ['sample'])
  expect(text).toContain('Sample title')
  expect(text).not.toContain('Hidden lineage description')
  expect(text).not.toContain('lineageDepth')
})

it.each([
  ['node', 'update', 'note'],
  ['node', 'update', 'agent'],
  ['space', 'get'],
  ['space', 'list'],
  ['session', 'run-agent'],
  ['session', 'get'],
])('keeps lineage descriptions off %j help', async (...path) => {
  const f = identityFixture(false)
  expect(await run([...path, '--help'], f.io)).toBe(0)
  expect(f.out()).not.toContain('lineageDepth')
  expect(f.fetch).not.toHaveBeenCalled()
})

it('uses the correct article for an image in target errors', async () => {
  const f = identityFixture()
  f.values['node.get'] = { node: { ...node, kind: 'image', title: 'Diagram' } }
  f.values['agent.get'] = null
  expect(await run(['agent', 'get', '--node', who.nodeId], f.io)).toBe(1)
  expect(f.error().message).toBe('"Diagram" is an image, not an agent window.')
})

it('documents Full Access as a create-only choice with a Settings default', async () => {
  const f = identityFixture(false)
  expect(await run(['node', 'create', 'agent', '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('--full-access <true|false>')
  expect(f.out()).toContain('omit to follow Settings')
  expect(f.out()).toMatchSnapshot()
  const update = identityFixture(false)
  expect(await run(['node', 'update', 'agent', '--help'], update.io)).toBe(0)
  expect(update.out()).not.toContain('--full-access')
})
