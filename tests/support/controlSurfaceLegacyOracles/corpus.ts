// @compat-file control-surface-legacy-validation
export const typical = {
  kind: 'agent',
  space: { kind: 'spaceId', spaceId: 'space-1' },
  data: { prompt: '', provider: 'codex', model: null },
}
const huge = 'x'.repeat(1_000_000)
const values = [
  undefined,
  null,
  false,
  true,
  0,
  -1,
  1.5,
  NaN,
  Infinity,
  '',
  ' ',
  '\t\n',
  '-flag',
  huge,
  [],
  {},
  ' hello ',
]
export const corpus: Record<string, { name: string; payload: unknown }[]> = {}
const bases: Record<string, Record<string, unknown>> = {
  'node.create': typical,
  'session.launchAgent': { cwd: '/repo', prompt: 'hello' },
  'filesystem.writeFileText': { uri: 'file:///tmp/f4.txt', content: 'hello' },
}
const fields: Record<string, string[]> = {
  'node.create': ['kind', 'space', 'projectId', 'title', 'frame', 'data'],
  'session.launchAgent': [
    'spaceId',
    'cwd',
    'prompt',
    'provider',
    'mode',
    'model',
    'resumeSessionId',
    'env',
    'executablePathOverride',
    'agentFullAccess',
    'cols',
    'rows',
  ],
  'filesystem.writeFileText': ['uri', 'content', 'overwrite'],
}
for (const [id, base] of Object.entries(bases)) {
  const cases = (corpus[id] = [
    { name: 'baseline', payload: base },
    { name: 'extra field', payload: { ...base, extra: 1 } },
  ])
  values.forEach((payload, i) => cases.push({ name: `root ${i}`, payload }))
  for (const key of fields[id]) {
    const missing = { ...base }
    delete missing[key]
    cases.push({ name: `missing ${key}`, payload: missing })
    values.forEach((value, i) =>
      cases.push({ name: `${key} ${i}`, payload: { ...base, [key]: value } }),
    )
  }
}
const add = (id: string, name: string, payload: unknown) => corpus[id].push({ name, payload })
for (const kind of ['note', 'task', 'website', 'agent', 'terminal']) {
  add('node.create', kind, { kind })
}
for (const space of [
  { kind: 'spaceId', spaceId: ' s ' },
  { kind: 'spaceName', name: ' n ', projectId: 4 },
  { kind: 'workerBranch', worker: ' w ', branch: '-branch' },
  { kind: 'workerPath', worker: 'w', path: '/a' },
]) {
  add('node.create', `locator ${space.kind}`, { ...typical, space })
  for (const field of Object.keys(space).filter(k => k !== 'kind')) {
    for (const [i, v] of values.entries()) {
      add('node.create', `locator ${space.kind}.${field} ${i}`, {
        ...typical,
        space: { ...space, [field]: v },
      })
    }
  }
}
for (const key of ['x', 'y', 'width', 'height']) {
  for (const [i, v] of values.entries()) {
    add('node.create', `frame ${key} ${i}`, { ...typical, frame: { [key]: v, extra: 1 } })
  }
}
for (const env of [
  { ' A ': ' x ', OPENCOVE_X: 'a', '-bad': 'a', BAD: 4 },
  { ['K'.repeat(121)]: huge },
  Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`K${i}`, 'v'])),
  { ' ': 'v' },
  { A: 'x'.repeat(10001) },
]) {
  add('session.launchAgent', `env edge ${Object.keys(env).length}`, {
    cwd: '/repo',
    prompt: '',
    env,
  })
}
for (const provider of [
  'codex',
  'claude-code',
  'opencode',
  'gemini',
  'pi',
  'kimi',
  ' codex ',
  'unknown',
]) {
  add('session.launchAgent', `provider ${provider}`, { spaceId: ' s1 ', prompt: '', provider })
}
for (const mode of ['resume', ' resume ', 'new', 'other']) {
  add('session.launchAgent', `mode ${mode}`, { spaceId: 's1', prompt: '', mode })
}
for (const uri of [
  ' file:///tmp/a ',
  'file:relative',
  'FILE:///tmp/a',
  'https://example.com',
  'file://host/a',
  'file:///a%ZZ',
  '-file:///a',
]) {
  add('filesystem.writeFileText', uri, { uri, content: '' })
}
add(
  'filesystem.writeFileText',
  'array named properties',
  Object.assign([], { uri: 'file:///tmp/a', content: '' }),
)
