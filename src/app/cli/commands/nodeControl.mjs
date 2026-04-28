import { invokeAndPrint, invokeControlSurface } from '../invoke.mjs'
import { readFlagValue, requireFlagValue } from '../args.mjs'

function fail(message) {
  process.stderr.write(`[opencove] ${message}\n`)
  process.exit(2)
}

function readRepeatedFlagValues(args, flag) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue
    }
    const next = args[index + 1]
    if (!next || next.startsWith('-')) {
      fail(`missing required flag: ${flag} <value>`)
    }
    values.push(next)
  }
  return values
}

function readBooleanFlagValue(args, flag) {
  const sawFlag = args.includes(flag)
  const raw = readFlagValue(args, flag)
  if (!raw) {
    if (sawFlag) {
      fail(`missing required flag: ${flag} <true|false>`)
    }
    return null
  }
  if (raw === 'true') {
    return true
  }
  if (raw === 'false') {
    return false
  }
  fail(`invalid boolean for ${flag}: ${raw}`)
}

function readJsonFlag(args, flag) {
  const raw = readFlagValue(args, flag)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${flag} must be a JSON object`)
    }
    return parsed
  } catch {
    fail(`invalid JSON for ${flag}`)
  }
}

function parseSpaceLocator(args, { required = false } = {}) {
  const spaceId = readFlagValue(args, '--space')
  const spaceName = readFlagValue(args, '--space-name')
  const worker = readFlagValue(args, '--worker')
  const branch = readFlagValue(args, '--branch')
  const path = readFlagValue(args, '--path')
  const projectId = readFlagValue(args, '--project')
  const modes = [
    spaceId ? 'spaceId' : null,
    spaceName ? 'spaceName' : null,
    worker && branch ? 'workerBranch' : null,
    worker && path ? 'workerPath' : null,
  ].filter(Boolean)

  if (modes.length === 0) {
    if (required) {
      fail('missing space locator')
    }
    return null
  }
  if (modes.length > 1 || (worker && !branch && !path) || (!worker && (branch || path))) {
    fail('space locator must use exactly one mode')
  }
  if (spaceId) {
    return { kind: 'spaceId', spaceId }
  }
  if (spaceName) {
    return { kind: 'spaceName', name: spaceName, ...(projectId ? { projectId } : {}) }
  }
  if (worker && branch) {
    return { kind: 'workerBranch', worker, branch, ...(projectId ? { projectId } : {}) }
  }
  return { kind: 'workerPath', worker, path, ...(projectId ? { projectId } : {}) }
}

function buildCreateData(kind, args) {
  if (kind === 'note') {
    return { text: readFlagValue(args, '--text') ?? '' }
  }
  if (kind === 'task') {
    return {
      requirement: requireFlagValue(args, '--requirement'),
      priority: readFlagValue(args, '--priority') ?? 'medium',
      tags: readRepeatedFlagValues(args, '--tag'),
    }
  }
  if (kind === 'website') {
    return {
      url: requireFlagValue(args, '--url'),
      pinned: args.includes('--pinned'),
      sessionMode: readFlagValue(args, '--session-mode') ?? 'shared',
      profileId: readFlagValue(args, '--profile'),
    }
  }
  if (kind === 'agent') {
    return {
      prompt: readFlagValue(args, '--prompt') ?? '',
      provider: readFlagValue(args, '--provider'),
      model: readFlagValue(args, '--model'),
    }
  }
  return {
    shell: readFlagValue(args, '--shell'),
    command: readFlagValue(args, '--command'),
    profileId: readFlagValue(args, '--profile'),
  }
}

function buildUpdateData(kind, args) {
  if (kind === 'note') {
    return { text: readFlagValue(args, '--text') }
  }
  if (kind === 'task') {
    const tags = readRepeatedFlagValues(args, '--tag')
    return {
      requirement: readFlagValue(args, '--requirement'),
      priority: readFlagValue(args, '--priority'),
      status: readFlagValue(args, '--status'),
      ...(tags.length > 0 ? { tags } : {}),
    }
  }
  const pinned = readBooleanFlagValue(args, '--pinned')
  const sessionMode = readFlagValue(args, '--session-mode')
  return {
    ...(readFlagValue(args, '--url') ? { url: readFlagValue(args, '--url') } : {}),
    ...(pinned !== null ? { pinned } : {}),
    ...(sessionMode ? { sessionMode } : {}),
    ...(args.includes('--profile') ? { profileId: requireFlagValue(args, '--profile') } : {}),
  }
}

async function createAndMaybeFocus({ connection, payload, pretty, timeoutMs, focus }) {
  const created = await invokeControlSurface(
    connection,
    { kind: 'command', id: 'node.create', payload },
    { timeoutMs },
  )
  if (!created.result || created.result.ok === false) {
    process.stdout.write(
      `${pretty ? JSON.stringify(created.result, null, 2) : JSON.stringify(created.result)}\n`,
    )
    process.exit(1)
  }
  if (!focus) {
    process.stdout.write(
      `${pretty ? JSON.stringify(created.result, null, 2) : JSON.stringify(created.result)}\n`,
    )
    return
  }

  const focusResult = await invokeControlSurface(
    connection,
    {
      kind: 'command',
      id: 'canvas.focus',
      payload: { target: { kind: 'node', nodeId: created.result.value.node.id } },
    },
    { timeoutMs },
  )
  const result = {
    __opencoveControlEnvelope: true,
    ok: true,
    value: {
      node: created.result.value,
      focus: focusResult.result?.ok === true ? focusResult.result.value : null,
      focusError: focusResult.result?.ok === false ? focusResult.result.error : null,
    },
  }
  process.stdout.write(`${pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`)
}

export async function tryHandleNodeControlCommands({
  command,
  args,
  connection,
  pretty,
  timeoutMs,
}) {
  if (command === 'node' && args[1] === 'list') {
    const space = parseSpaceLocator(args)
    await invokeAndPrint(
      connection,
      {
        kind: 'query',
        id: 'node.list',
        payload: {
          ...(space ? { space } : {}),
          ...(readFlagValue(args, '--project')
            ? { projectId: readFlagValue(args, '--project') }
            : {}),
          ...(readFlagValue(args, '--kind') ? { kind: readFlagValue(args, '--kind') } : {}),
        },
      },
      { pretty, timeoutMs },
    )
    return true
  }

  if (command === 'node' && args[1] === 'get') {
    await invokeAndPrint(
      connection,
      { kind: 'query', id: 'node.get', payload: { nodeId: requireFlagValue(args, '--node') } },
      { pretty, timeoutMs },
    )
    return true
  }

  if (command === 'node' && args[1] === 'create') {
    const kind = args[2]
    if (!['note', 'task', 'website', 'agent', 'terminal'].includes(kind)) {
      fail('node create requires kind: note|task|website|agent|terminal')
    }
    await createAndMaybeFocus({
      connection,
      pretty,
      timeoutMs,
      focus: args.includes('--focus'),
      payload: {
        kind,
        space: parseSpaceLocator(args, { required: true }),
        title: readFlagValue(args, '--title'),
        frame: readJsonFlag(args, '--frame'),
        data: buildCreateData(kind, args),
      },
    })
    return true
  }

  if (command === 'node' && args[1] === 'update') {
    const kind = args[2]
    if (!['note', 'task', 'website'].includes(kind)) {
      fail('node update supports only: note|task|website')
    }
    await invokeAndPrint(
      connection,
      {
        kind: 'command',
        id: 'node.update',
        payload: {
          kind,
          nodeId: requireFlagValue(args, '--node'),
          title: readFlagValue(args, '--title'),
          frame: readJsonFlag(args, '--frame'),
          data: buildUpdateData(kind, args),
        },
      },
      { pretty, timeoutMs },
    )
    return true
  }

  if (command === 'node' && args[1] === 'delete') {
    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'node.delete', payload: { nodeId: requireFlagValue(args, '--node') } },
      { pretty, timeoutMs },
    )
    return true
  }

  if (command === 'canvas' && args[1] === 'focus') {
    const targetKind = args[2]
    const target =
      targetKind === 'node'
        ? { kind: 'node', nodeId: requireFlagValue(args, '--node') }
        : targetKind === 'space'
          ? { kind: 'space', locator: parseSpaceLocator(args, { required: true }) }
          : null
    if (!target) {
      fail('canvas focus requires target: node|space')
    }
    await invokeAndPrint(
      connection,
      { kind: 'command', id: 'canvas.focus', payload: { target } },
      { pretty, timeoutMs },
    )
    return true
  }

  return false
}
