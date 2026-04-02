import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { APIRequestContext, Page } from '@playwright/test'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[web-canvas-e2e] Missing required env var: ${name}`)
  }

  return value
}

export const webCanvasBaseUrl = requireEnv('OPENCOVE_WEB_CANVAS_BASE_URL')
export const webCanvasToken = requireEnv('OPENCOVE_WEB_CANVAS_TOKEN')
export const webCanvasWorkspaceRoot = requireEnv('OPENCOVE_WEB_CANVAS_WORKSPACE_ROOT')

type ControlSurfaceEnvelope<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error?: { code?: string; message?: string } }

export async function invokeValue<TValue>(
  request: APIRequestContext,
  kind: 'query' | 'command',
  id: string,
  payload: unknown,
): Promise<TValue> {
  const response = await request.post('/invoke', {
    headers: {
      authorization: `Bearer ${webCanvasToken}`,
      'content-type': 'application/json',
    },
    data: { kind, id, payload },
  })

  const envelope = (await response.json()) as ControlSurfaceEnvelope<TValue>
  if (!response.ok() || !envelope.ok) {
    throw new Error(
      `[web-canvas-e2e] ${kind} ${id} failed: ${response.status()} ${
        !envelope.ok ? (envelope.error?.code ?? envelope.error?.message ?? 'unknown_error') : ''
      }`,
    )
  }

  return envelope.value
}

export async function issueWebTicket(request: APIRequestContext): Promise<string> {
  const result = await invokeValue<{ ticket: string }>(
    request,
    'query',
    'auth.issueWebSessionTicket',
    { redirectPath: '/' },
  )
  return result.ticket
}

export async function openAuthedCanvas(page: Page): Promise<void> {
  const ticket = await issueWebTicket(page.request)
  await page.goto(`/auth/claim?ticket=${encodeURIComponent(ticket)}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(500)
}

export async function createWorkspaceDir(name: string): Promise<string> {
  const directoryPath = path.join(webCanvasWorkspaceRoot, `${name}-${randomUUID()}`)
  await mkdir(directoryPath, { recursive: true })
  return directoryPath
}

export function fileUri(filePath: string): string {
  return pathToFileURL(filePath).toString()
}

type SeedNode =
  | {
      id: string
      title: string
      kind: 'note'
      position: { x: number; y: number }
      width: number
      height: number
      text: string
    }
  | {
      id: string
      title: string
      kind: 'document'
      position: { x: number; y: number }
      width: number
      height: number
      uri: string
    }

export function buildAppState(options: {
  workspacePath: string
  workspaceName?: string
  spaces: Array<{
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
    rect: { x: number; y: number; width: number; height: number } | null
  }>
  nodes?: SeedNode[]
  settings?: Record<string, unknown>
}): {
  formatVersion: number
  activeWorkspaceId: string
  workspaces: unknown[]
  settings: Record<string, unknown>
} {
  const workspaceId = 'workspace-1'
  const nodes = (options.nodes ?? []).map(node => ({
    id: node.id,
    title: node.title,
    titlePinnedByUser: false,
    position: node.position,
    width: node.width,
    height: node.height,
    kind: node.kind,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    executionDirectory: null,
    expectedDirectory: null,
    agent: null,
    task:
      node.kind === 'note'
        ? { text: node.text }
        : {
            uri: node.uri,
          },
  }))

  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: options.workspaceName ?? 'web-canvas-workspace',
        path: options.workspacePath,
        worktreesRoot: path.join(options.workspacePath, '.opencove', 'worktrees'),
        pullRequestBaseBranchOptions: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaceArchiveRecords: [],
        spaces: options.spaces.map(space => ({
          ...space,
          labelColor: null,
        })),
        activeSpaceId: options.spaces[0]?.id ?? null,
        nodes,
      },
    ],
    settings: options.settings ?? {},
  }
}

export async function writeAppState(request: APIRequestContext, state: unknown): Promise<void> {
  const current = await invokeValue<{ revision: number }>(request, 'query', 'sync.state', null)
  await invokeValue(request, 'command', 'sync.writeState', {
    state,
    baseRevision: current.revision,
  })
}

export async function readSharedState(request: APIRequestContext): Promise<{
  revision: number
  state: {
    activeWorkspaceId: string | null
    workspaces: Array<{
      id: string
      activeSpaceId: string | null
      nodes: Array<Record<string, unknown> & { kind: string }>
      spaces: Array<Record<string, unknown> & { nodeIds: string[] }>
    }>
  } | null
}> {
  return await invokeValue(request, 'query', 'sync.state', null)
}

export async function readViewState(page: Page): Promise<unknown> {
  return await page.evaluate(() => {
    const raw = window.localStorage.getItem('opencove:m5.6:view-state')
    return raw ? (JSON.parse(raw) as unknown) : null
  })
}

export async function readTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, 'utf8')
}
