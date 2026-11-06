const values: unknown[] = [
  undefined,
  null,
  false,
  true,
  0,
  -1,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  '',
  ' ',
  '\t\n',
  '-flag',
  'x'.repeat(1_000_000),
  [],
  {},
  ' hello ',
]
const bases: Record<string, Record<string, unknown>> = {
  'canvas.focus': { target: { kind: 'node', nodeId: 'node-1' } },
  'node.delete': { nodeId: 'node-1' },
  'node.get': { nodeId: 'node-1' },
  'node.list': {
    space: { kind: 'spaceId', spaceId: 'space-1' },
    projectId: 'project-1',
    kind: 'note',
  },
  'node.update': {
    kind: 'note',
    nodeId: 'node-1',
    title: ' Note ',
    frame: { x: 10, y: 20, width: 400, height: 300 },
    data: { text: 'hello' },
  },
  'project.list': {},
  'space.get': { spaceId: 'space-1' },
  'space.list': { projectId: 'project-1' },
  'worktree.archive': { spaceId: 'space-1', force: true, deleteBranch: false },
  'worktree.create': { spaceId: 'space-1', name: 'feature/test' },
  'worktree.list': { projectId: 'project-1' },
}
export const pr2aCorpus: Record<string, { name: string; payload: unknown }[]> = {}
for (const [id, base] of Object.entries(bases)) {
  const cases = (pr2aCorpus[id] = [
    { name: 'baseline', payload: base },
    { name: 'extra', payload: { ...base, extra: 1 } },
    { name: 'array named properties', payload: Object.assign([], base) },
  ])
  values.forEach((payload, i) => cases.push({ name: `root ${i}`, payload }))
  for (const key of Object.keys(base)) {
    const missing = { ...base }
    delete missing[key]
    cases.push({ name: `missing ${key}`, payload: missing })
    values.forEach((value, i) =>
      cases.push({ name: `${key} ${i}`, payload: { ...base, [key]: value } }),
    )
  }
}
const add = (id: string, name: string, payload: unknown) => pr2aCorpus[id].push({ name, payload })
for (const kind of [
  'note',
  'task',
  'website',
  'agent',
  'terminal',
  'plugin',
  'document',
  'folder',
  'image',
  'role',
  ['plugin'],
]) {
  add('node.list', `kind ${kind}`, { kind })
  add('node.update', `kind ${kind}`, { ...bases['node.update'], kind })
}
for (const key of ['x', 'y', 'width', 'height']) {
  values.forEach((v, i) =>
    add('node.update', `frame ${key} ${i}`, {
      ...bases['node.update'],
      frame: { [key]: v, extra: 1 },
    }),
  )
}
for (const locator of [
  { kind: 'spaceId', spaceId: ' s ' },
  { kind: 'spaceName', name: ' n ', projectId: 4 },
  { kind: 'workerBranch', worker: ' w ', branch: '-branch' },
  { kind: 'workerPath', worker: ' w ', path: '/repo' },
]) {
  const variants: unknown[] = [locator, ...values]
  for (const key of Object.keys(locator)) {
    const missing = { ...locator } as Record<string, unknown>
    delete missing[key]
    variants.push(missing)
    for (const v of values) {
      variants.push({ ...locator, [key]: v })
    }
  }
  variants.forEach((space, i) => {
    add('node.list', `locator ${locator.kind} ${i}`, { space })
    add('canvas.focus', `locator ${locator.kind} ${i}`, {
      target: { kind: 'space', locator: space },
    })
  })
}
for (const key of ['kind', 'nodeId']) {
  values.forEach((v, i) =>
    add('canvas.focus', `target ${key} ${i}`, {
      target: { kind: 'node', nodeId: 'node-1', [key]: v },
    }),
  )
}

// Existing handler payloads: controlSurface.worktreeHandlers.spec.ts:185 and controlSurface.spaceHandlers.spec.ts:92.
add('worktree.create', 'existing handler payload', { spaceId: 's1', name: 'feature-a' })
add('space.get', 'existing handler payload', { spaceId: 'space-1' })

add('project.list', 'preserve own __proto__ key', JSON.parse('{"__proto__":{"value":1},"extra":2}'))
