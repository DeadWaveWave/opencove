import type { Command, CommandArgs, OptionSpec } from './command'
import type { CliIo } from './io'
import { closeNames } from './suggestions'
import { kindWithArticle } from './kindWording'
import { CliError } from './errors'
import { sessionIdentity, type Invoke } from './identity'
import { requireNodeLineage } from './nodeLineage'
import { resolveCurrentContainer } from './currentContainer'
import type {
  GetSpaceResult,
  ListProjectsResult,
  ListSpacesResult,
} from '../../../shared/contracts/dto'
import type { GetNodeResult, ListNodesResult } from '../../../shared/contracts/dto/nodeControl'

type Kind = NonNullable<OptionSpec['selector']>
type Candidate = {
  id: string
  kind?: string
  title?: string
  name?: string
  spaceId?: string | null
  spaceName?: string | null
  preview?: string
}
const locatorKeys = ['space', 'space-name', 'worker', 'branch', 'path']
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

async function exactTarget(kind: 'node' | 'space', selector: string, invoke: Invoke) {
  try {
    const found = await invoke(kind === 'node' ? 'node.get' : 'space.get', {
      [`${kind}Id`]: selector,
    })
    const target = kind === 'node' ? (found as GetNodeResult).node : (found as GetSpaceResult).space
    return target?.id === selector
      ? {
          projectId:
            kind === 'node'
              ? (found as GetNodeResult).node.projectId
              : (found as GetSpaceResult).projectId,
          spaceId: kind === 'node' ? (found as GetNodeResult).node.spaceId : undefined,
        }
      : undefined
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== `${kind}.not_found`) {
      throw error
    }
    return undefined
  }
}

export function applySelfDefaults(
  options: Record<string, unknown>,
  command: Command,
  env: CliIo['env'],
) {
  if (
    env.OPENCOVE_ENV !== '1' ||
    (command.operation === 'node.create' && options.near !== undefined)
  ) {
    return
  }
  const hasLocator = locatorKeys.some(key => options[key] !== undefined)
  const hasProject = options.project !== undefined
  for (const [key, spec] of Object.entries(command.options ?? {})) {
    if (
      !spec.defaultSelf ||
      options[key] !== undefined ||
      spec.defaultSelfUnless?.some(other => options[other] !== undefined) ||
      spec.conflicts?.some(other => options[other] !== undefined)
    ) {
      continue
    }
    // Explicit project selection is project-wide, not the caller's own space.
    if (key === 'space' && (hasLocator || hasProject)) {
      continue
    }
    options[key] = '@self'
  }
}

export function selectorDescription(spec: OptionSpec): string {
  return (
    spec.description +
    (spec.selector
      ? `; also accepts @self${spec.selector === 'node' ? ', @parent' : ''}, an exact name or a unique ID prefix (6+ characters)`
      : '')
  )
}

function match(
  kind: Kind,
  selector: string,
  candidates: Candidate[],
  scope = 'all projects',
  wrongKind?: string,
): string {
  const ids = candidates.filter(candidate => candidate.id === selector)
  const names = candidates.filter(candidate => (candidate.title ?? candidate.name) === selector)
  const matches = ids.length
    ? ids
    : names.length
      ? names
      : selector.length >= 6
        ? candidates.filter(candidate => candidate.id.startsWith(selector))
        : []
  const label = kind[0].toUpperCase() + kind.slice(1)
  const hint = `Run "opencove ${kind} list" to find available targets.`
  if (!matches.length) {
    const suggestions = closeNames(
      selector,
      candidates.map(candidate => candidate.title ?? candidate.name ?? ''),
    )
    throw new CliError(
      `${kind}.not_found`,
      1,
      `${label} ${JSON.stringify(selector)} was not found; searched ${scope}.${wrongKind ? ` This is a known ${wrongKind} ID, not ${kindWithArticle(kind)} ID.` : ''}`,
      [
        selector.length < 6 && candidates.some(candidate => candidate.id.startsWith(selector))
          ? 'ID prefixes need at least 6 characters.'
          : '',
        suggestions.map(name => `Suggested name: ${JSON.stringify(name)}.`).join(' '),
        hint,
      ]
        .filter(Boolean)
        .join(' '),
      suggestions.length
        ? {
            candidates: candidates
              .filter(candidate => suggestions.includes(candidate.title ?? candidate.name ?? ''))
              .slice(0, 10)
              .map(candidate => ({ ...candidate, kind: candidate.kind ?? kind })),
          }
        : undefined,
    )
  }
  if (matches.length > 1) {
    throw new CliError(
      'cli.ambiguous',
      6,
      `${label} ${JSON.stringify(selector)} matches several targets`,
      'Use the full ID to select one target.',
      {
        candidates: matches.slice(0, 10).map(candidate => ({
          id: candidate.id,
          kind: candidate.kind ?? kind,
          ...(kind === 'node' ? { title: candidate.title } : { name: candidate.name }),
          spaceId: candidate.spaceId ?? null,
          ...(kind === 'node' ? { spaceName: candidate.spaceName ?? null } : {}),
          ...(candidate.preview !== undefined ? { preview: candidate.preview } : {}),
        })),
      },
    )
  }
  return matches[0].id
}

export async function resolveSelectors(
  command: Command,
  args: CommandArgs,
  io: CliIo,
  invoke: Invoke,
  identity = sessionIdentity(io.env, invoke),
) {
  const o = args.options
  if (o['spawned-by'] !== undefined) {
    await requireNodeLineage(invoke)
  }
  const currentContainer = await resolveCurrentContainer(command, args, io, invoke, identity.self)
  let projectId: string | undefined = currentContainer ? String(o.project) : undefined
  const projects = async () =>
    ((await invoke('project.list', null)) as ListProjectsResult).projects ?? []
  const wrongKind = async (kind: Kind, selector: string) => {
    if (kind !== 'project' && (await projects()).some(candidate => candidate.id === selector)) {
      return 'project'
    }
    for (const other of ['space', 'node'] as const) {
      // Probe in order so a known kind avoids further diagnostic reads.
      if (other !== kind && (await exactTarget(other, selector, invoke))) {
        return other
      }
    }
    return undefined
  }
  const scopedMatch = async (
    kind: Kind,
    selector: string,
    candidates: Candidate[],
    scope: string,
    lookupProjectId = projectId,
  ) => {
    try {
      return match(kind, selector, candidates, scope)
    } catch (error) {
      if (!(error instanceof CliError)) {
        throw error
      }
      if (error.code === `${kind}.not_found`) {
        return match(kind, selector, candidates, scope, await wrongKind(kind, selector))
      }
      if (error.code === 'cli.ambiguous' && kind === 'node') {
        const details = error.details as { candidates: Candidate[] }
        const spaces = (
          (await invoke('space.list', { projectId: lookupProjectId })) as ListSpacesResult
        ).spaces
        await Promise.all(
          details.candidates.map(async candidate => {
            candidate.spaceName = spaces.find(space => space.id === candidate.spaceId)?.name ?? null
            if (candidate.kind === 'note') {
              const detail = (await invoke('node.get', { nodeId: candidate.id })) as GetNodeResult
              const text = detail.node.data.kind === 'note' ? detail.node.data.text : ''
              const line = text.replace(/\s+/gu, ' ').trim()
              candidate.preview =
                line.length > 60 ? line.slice(0, 59).replace(/[\uD800-\uDBFF]$/, '') + '…' : line
            }
          }),
        )
      }
      throw error
    }
  }
  if (!currentContainer && command.options?.project?.selector && o.project !== undefined) {
    const selector = String(o.project)
    if (selector === '@parent') {
      throw new CliError('cli.usage', 2, '@parent selects a node. Use a project selector here.')
    }
    projectId =
      selector === '@self'
        ? await identity.self('project')
        : await scopedMatch('project', selector, await projects(), 'all projects')
    o.project = projectId
  }
  // Only a project the caller chose constrains exact IDs; a defaulted one scopes names only.
  const explicitProject = projectId !== undefined && args.explicitOptions?.has('project')
  const explicitSpace = args.explicitOptions?.has('space') === true
  const checkProject = (kind: 'node' | 'space', selector: string, targetProjectId: string) => {
    if (explicitProject && targetProjectId !== projectId) {
      throw new CliError(
        `${kind}.not_found`,
        1,
        `${kind === 'node' ? 'Node' : 'Space'} ${JSON.stringify(selector)} belongs to project ${JSON.stringify(targetProjectId)}, not to the selected project ${JSON.stringify(projectId)}`,
        `Drop --project to address ${kindWithArticle(kind)} by its full ID across projects.`,
      )
    }
  }
  // Scope names and prefixes to the session project, including commands whose only
  // project flag is a lookup filter. An explicit project always takes precedence.
  const scopeProject = async () => {
    if (!projectId && io.env.OPENCOVE_ENV === '1') {
      projectId = await identity.self('project')
    }
    if (!projectId) {
      const caller = await identity.whoami()
      if (caller.caller === 'session-grant') {
        projectId = caller.projectId ?? undefined
      }
    }
    return projectId
  }
  const scopeCreatorLookup = async () => {
    // An explicit Space supplies lookup context; --project alone filters child results.
    if (!explicitProject || explicitSpace) {
      return scopeProject()
    }
    if (io.env.OPENCOVE_ENV === '1') {
      return identity.self('project')
    }
    const caller = await identity.whoami()
    return caller.caller === 'session-grant' ? (caller.projectId ?? undefined) : projectId
  }
  const selectorKeys = [
    'space',
    'node',
    ...Object.keys(command.options ?? {}).filter(
      key => key !== 'node' && command.options?.[key].selector === 'node',
    ),
  ]
  for (const key of selectorKeys) {
    const kind = command.options?.[key]?.selector as 'space' | 'node'
    const isTarget = key === kind || key === 'near'
    if (
      (currentContainer && kind === 'space') ||
      !command.options?.[key]?.selector ||
      o[key] === undefined
    ) {
      continue
    }
    // Project/Space membership filters constrain results and action targets, not creators.
    const checkResolvedProject = (selector: string, targetProjectId: string) => {
      if (isTarget) {
        checkProject(kind, selector, targetProjectId)
      }
    }
    const resolveOne = async (selector: string): Promise<string> => {
      if (selector === '@parent') {
        if (kind !== 'node') {
          throw new CliError(
            'cli.usage',
            2,
            '@parent selects a node. Use a Space or project selector here.',
          )
        }
        await requireNodeLineage(invoke)
        const result = (await invoke('node.resolveCallerSelector', {
          selector: '@parent',
          ...(io.env.OPENCOVE_ENV === '1' && io.env.OPENCOVE_NODE_ID
            ? { expectedCallerNodeId: io.env.OPENCOVE_NODE_ID }
            : {}),
        })) as { id: string }
        if (explicitProject && isTarget) {
          const target = await exactTarget('node', result.id, invoke)
          if (target) {
            checkResolvedProject(selector, target.projectId)
          }
        }
        return result.id
      }
      if (selector === '@self') {
        // Resolution order matters: failure must prevent any later target lookup.
        const ownId = await identity.self(kind)
        if (explicitProject && isTarget) {
          const target = await exactTarget(kind, ownId, invoke)
          if (target) {
            checkResolvedProject(selector, target.projectId)
          }
        }
        return ownId
      }
      // Lists default to the active project. Probe a full UUID through the global
      // read operation so an exact ID still works across projects. A UUID-shaped
      // title may fall through to name resolution when no such ID exists.
      if (uuidPattern.test(selector)) {
        const target = await exactTarget(kind, selector, invoke)
        if (target) {
          checkResolvedProject(selector, target.projectId)
          return selector
        }
      }
      // One list call per selector, without retries or speculative writes.
      const project = await (isTarget ? scopeProject() : scopeCreatorLookup())
      const result = (await invoke(kind === 'space' ? 'space.list' : 'node.list', {
        projectId: project,
        ...(kind === 'node' && isTarget && o.space !== undefined
          ? { space: { kind: 'spaceId', spaceId: o.space } }
          : {}),
      })) as ListSpacesResult | ListNodesResult
      const candidates =
        kind === 'space' ? (result as ListSpacesResult).spaces : (result as ListNodesResult).nodes
      // @compat cli-legacy-input-handling
      // Legacy IDs need the same global exact-ID precedence as UUIDs. Only probe
      // when the list has no exact ID, before accepting a name or a prefix.
      if (!uuidPattern.test(selector) && !candidates.some(candidate => candidate.id === selector)) {
        const target = await exactTarget(kind, selector, invoke)
        if (target) {
          checkResolvedProject(selector, target.projectId)
          return selector
        }
      }
      return scopedMatch(
        kind,
        selector,
        candidates,
        `${(project ?? result.projectId) ? `project ${JSON.stringify(project ?? result.projectId)}` : 'the active project'}${kind === 'node' && isTarget && o.space !== undefined ? `, space ${JSON.stringify(o.space)}` : ''}`,
        project,
      )
    }
    const resolved = Array.isArray(o[key])
      ? Promise.all((o[key] as string[]).map(resolveOne))
      : resolveOne(String(o[key]))
    // Space resolution establishes the scope before resolving node selectors.
    o[key] = await resolved
    // A relationship filter spans the selected creator's current project unless explicitly scoped.
    if (!isTarget && !explicitProject && !explicitSpace) {
      const target = await exactTarget('node', String(o[key]), invoke)
      if (target) {
        o.project = target.projectId
      }
    }
    if (kind === 'node' && isTarget && explicitSpace) {
      // All selector forms pass the same membership check before execution.
      // Exact-ID probes are reused by the per-run read cache.
      await Promise.all(
        [o[key]].flat().map(async id => {
          const target = await exactTarget('node', String(id), invoke)
          if (!target) {
            throw new CliError(
              'node.not_found',
              1,
              `Node ${JSON.stringify(id)} was not found in the selected space ${JSON.stringify(o.space)}`,
              'Run "opencove node list --space <selector>" to find available targets.',
            )
          }
          if (target.spaceId !== o.space) {
            throw new CliError(
              'node.not_found',
              1,
              `Node ${JSON.stringify(id)} belongs to ${target.spaceId === null ? 'no space' : `space ${JSON.stringify(target.spaceId)}`}, not to the selected space ${JSON.stringify(o.space)}`,
              'Drop --space to address a node by its full ID across spaces.',
            )
          }
        }),
      )
    }
    if (
      kind === 'space' &&
      !explicitProject &&
      Object.entries(command.options ?? {}).some(
        ([optionKey, option]) =>
          option.selector === 'node' && (optionKey !== 'near' || o.near !== undefined),
      )
    ) {
      // An explicitly chosen space may belong to a different project than the session.
      const found = await exactTarget('space', String(o.space), invoke)
      projectId = found?.projectId ?? projectId
    }
  }
  return identity
}
