import type { Command, CommandArgs, OptionSpec } from './command'
import type { CliIo } from './io'
import { CliError } from './errors'
import { sessionIdentity, type Invoke } from './identity'
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
  if (env.OPENCOVE_ENV !== '1') {
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
      ? '; also accepts @self, an exact name or a unique ID prefix (6+ characters)'
      : '')
  )
}

function match(kind: Kind, selector: string, candidates: Candidate[]): string {
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
    throw new CliError(
      `${kind}.not_found`,
      1,
      `${label} ${JSON.stringify(selector)} was not found`,
      selector.length < 6 && candidates.some(candidate => candidate.id.startsWith(selector))
        ? `ID prefixes need at least 6 characters. ${hint}`
        : hint,
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
) {
  const identity = sessionIdentity(io.env, invoke)
  const o = args.options
  let projectId: string | undefined
  if (command.options?.project?.selector && o.project !== undefined) {
    const selector = String(o.project)
    projectId =
      selector === '@self'
        ? await identity.self('project')
        : match(
            'project',
            selector,
            ((await invoke('project.list', null)) as ListProjectsResult).projects,
          )
    o.project = projectId
  }
  // Only a project the caller chose constrains exact IDs; a defaulted one scopes names only.
  const explicitProject = projectId !== undefined && args.explicitOptions?.has('project')
  const checkProject = (kind: 'node' | 'space', selector: string, targetProjectId: string) => {
    if (explicitProject && targetProjectId !== projectId) {
      throw new CliError(
        `${kind}.not_found`,
        1,
        `${kind === 'node' ? 'Node' : 'Space'} ${JSON.stringify(selector)} belongs to project ${JSON.stringify(targetProjectId)}, not to the selected project ${JSON.stringify(projectId)}`,
        `Drop --project to address a ${kind} by its full ID across projects.`,
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
  for (const kind of ['space', 'node'] as const) {
    if (!command.options?.[kind]?.selector || o[kind] === undefined) {
      continue
    }
    const resolveOne = async (selector: string): Promise<string> => {
      if (selector === '@self') {
        // Resolution order matters: failure must prevent any later target lookup.
        // eslint-disable-next-line no-await-in-loop
        const ownId = await identity.self(kind)
        if (explicitProject) {
          // eslint-disable-next-line no-await-in-loop
          const target = await exactTarget(kind, ownId, invoke)
          if (target) {
            checkProject(kind, selector, target.projectId)
          }
        }
        return ownId
      }
      // Lists default to the active project. Probe a full UUID through the global
      // read operation so an exact ID still works across projects. A UUID-shaped
      // title may fall through to name resolution when no such ID exists.
      if (uuidPattern.test(selector)) {
        // eslint-disable-next-line no-await-in-loop
        const target = await exactTarget(kind, selector, invoke)
        if (target) {
          checkProject(kind, selector, target.projectId)
          return selector
        }
      }
      // One list call per selector, without retries or speculative writes.
      // eslint-disable-next-line no-await-in-loop
      const project = await scopeProject()
      // eslint-disable-next-line no-await-in-loop
      const result = await invoke(kind === 'space' ? 'space.list' : 'node.list', {
        projectId: project,
      })
      const candidates =
        kind === 'space' ? (result as ListSpacesResult).spaces : (result as ListNodesResult).nodes
      // Legacy IDs need the same global exact-ID precedence as UUIDs. Only probe
      // when the list has no exact ID, before accepting a name or a prefix.
      if (!uuidPattern.test(selector) && !candidates.some(candidate => candidate.id === selector)) {
        // eslint-disable-next-line no-await-in-loop
        const target = await exactTarget(kind, selector, invoke)
        if (target) {
          checkProject(kind, selector, target.projectId)
          return selector
        }
      }
      return match(kind, selector, candidates)
    }
    const resolved = Array.isArray(o[kind])
      ? Promise.all((o[kind] as string[]).map(resolveOne))
      : resolveOne(String(o[kind]))
    // Space resolution establishes the scope before resolving node selectors.
    // eslint-disable-next-line no-await-in-loop
    o[kind] = await resolved
  }
  return identity
}
