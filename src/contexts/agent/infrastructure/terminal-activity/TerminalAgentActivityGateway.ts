import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type {
  TerminalAgentShimProvider,
  TerminalSessionMetadataEvent,
} from '../../../../shared/contracts/dto'
import type {
  AgentHookInjectionPlan,
  AgentHookInjectionPlanner,
} from '../../application/ports/AgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../application/services/AgentLaunchArtifactScope'

const REQUEST_PATH = '/terminal-agent/activity'
const MAX_BODY_BYTES = 64 * 1024

interface InvocationRecord {
  artifacts: AgentLaunchArtifactScope
  generation: number
  invocationId: string
  plan: AgentHookInjectionPlan
  provider: TerminalAgentShimProvider
  startedAtMs: number
}

interface TerminalCredential {
  currentGeneration: number
  invocations: Map<string, InvocationRecord>
  nextGeneration: number
  sessionId: string | null
  token: string
}

export interface TerminalAgentGatewayReservation {
  endpoint: string
  token: string
  commit: (sessionId: string) => void
  dispose: () => Promise<void>
}

export class TerminalAgentActivityGateway {
  private readonly credentials = new Map<string, TerminalCredential>()
  private readonly listeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  private server: Server | null = null
  private endpoint: string | null = null
  private startPromise: Promise<void> | null = null
  private disposed = false

  public constructor(
    private readonly options: {
      resolveHookInjection: (
        provider: TerminalAgentShimProvider,
      ) => AgentHookInjectionPlanner | null
      now?: () => number
      createHttpServer?: typeof createServer
    },
  ) {}

  public async start(): Promise<void> {
    if (this.endpoint) {
      return
    }
    if (this.disposed) {
      throw new Error('Terminal Agent activity gateway is disposed.')
    }
    if (this.startPromise) {
      return await this.startPromise
    }
    const startPromise = this.startOwnedServer()
    this.startPromise = startPromise
    try {
      await startPromise
    } catch (error) {
      if (this.startPromise === startPromise) {
        this.startPromise = null
      }
      throw error
    }
  }

  private async startOwnedServer(): Promise<void> {
    const createHttpServer = this.options.createHttpServer ?? createServer
    const server = createHttpServer((request, response) => {
      void this.handleRequest(request, response)
    })
    this.server = server
    try {
      const endpoint = await new Promise<string>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        server.once('error', onError)
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError)
          const address = server.address()
          if (!address || typeof address === 'string') {
            reject(new Error('Terminal Agent activity gateway has no TCP address.'))
            return
          }
          resolve(`http://127.0.0.1:${address.port}${REQUEST_PATH}`)
        })
      })
      if (this.disposed || this.server !== server) {
        throw new Error('Terminal Agent activity gateway is disposed.')
      }
      this.endpoint = endpoint
    } catch (error) {
      if (this.server === server) {
        this.server = null
      }
      await closeServer(server)
      throw error
    }
  }

  public async reserveTerminal(): Promise<TerminalAgentGatewayReservation> {
    await this.start()
    const endpoint = this.endpoint
    if (!endpoint) {
      throw new Error('Terminal Agent activity gateway did not start.')
    }
    const token = randomBytes(32).toString('base64url')
    const credential: TerminalCredential = {
      currentGeneration: 0,
      invocations: new Map(),
      nextGeneration: 1,
      sessionId: null,
      token,
    }
    this.credentials.set(token, credential)
    let disposed = false
    return {
      endpoint,
      token,
      commit: sessionId => {
        if (disposed || credential.sessionId || !this.credentials.has(token)) {
          return
        }
        credential.sessionId = sessionId
        const current = this.findCurrentInvocation(credential)
        if (current) {
          this.startInvocation(credential, current)
        }
      },
      dispose: async () => {
        if (disposed) {
          return
        }
        disposed = true
        this.credentials.delete(token)
        await this.disposeInvocations(credential)
      },
    }
  }

  public onMetadata(listener: (event: TerminalSessionMetadataEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const credentials = [...this.credentials.values()]
    this.credentials.clear()
    await Promise.all(
      credentials.map(async credential => await this.disposeInvocations(credential)),
    )
    this.listeners.clear()
    await this.startPromise?.catch(() => undefined)
    const server = this.server
    this.server = null
    this.endpoint = null
    await closeServer(server)
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== REQUEST_PATH) {
      this.respond(response, 404)
      return
    }
    const tokenHeader = request.headers['x-opencove-terminal-agent-token']
    const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : ''
    const credential = this.credentials.get(token)
    if (!credential) {
      this.respond(response, 401)
      return
    }
    try {
      const body = await readJsonBody(request)
      if (body.operation === 'prepare') {
        await this.prepareInvocation(credential, body, response)
        return
      }
      if (body.operation === 'complete') {
        await this.completeInvocation(credential, body, response)
        return
      }
      this.respond(response, 400)
    } catch {
      this.respond(response, 400)
    }
  }

  private async prepareInvocation(
    credential: TerminalCredential,
    body: Record<string, unknown>,
    response: ServerResponse,
  ): Promise<void> {
    const provider = normalizeProvider(body.provider)
    const invocationId = normalizeIdentifier(body.invocationId)
    const cwd = normalizeNonEmptyString(body.cwd)
    const executablePath = normalizeNonEmptyString(body.executablePath)
    const environment = normalizeEnvironment(body.environment)
    if (!provider || !invocationId || !cwd || !executablePath || !environment) {
      this.respond(response, 400)
      return
    }
    if (credential.invocations.has(invocationId)) {
      this.respond(response, 409)
      return
    }
    const planner = this.options.resolveHookInjection(provider)
    if (!planner) {
      this.respond(response, 422)
      return
    }

    const artifacts = new AgentLaunchArtifactScope()
    let plan: AgentHookInjectionPlan
    try {
      plan = await planner.prepareHookInjection({
        artifacts,
        environment,
        executablePathOverride: executablePath,
        workspaceDirectory: cwd,
      })
      artifacts.seal()
    } catch (error) {
      artifacts.seal()
      await artifacts.dispose().catch(() => undefined)
      throw error
    }
    if (!this.isCredentialLive(credential)) {
      await artifacts.dispose().catch(() => undefined)
      this.respond(response, 410)
      return
    }
    if (credential.invocations.has(invocationId)) {
      await artifacts.dispose().catch(() => undefined)
      this.respond(response, 409)
      return
    }
    const record: InvocationRecord = {
      artifacts,
      generation: credential.nextGeneration++,
      invocationId,
      plan,
      provider,
      startedAtMs: this.now(),
    }
    credential.currentGeneration = record.generation
    credential.invocations.set(invocationId, record)
    if (credential.sessionId) {
      this.startInvocation(credential, record)
    }
    this.respond(response, 200, {
      ok: true,
      args: [...plan.args],
      env: definedEnvironment(plan.env),
      generation: record.generation,
    })
  }

  private async completeInvocation(
    credential: TerminalCredential,
    body: Record<string, unknown>,
    response: ServerResponse,
  ): Promise<void> {
    const invocationId = normalizeIdentifier(body.invocationId)
    const generation = normalizeGeneration(body.generation)
    const record = invocationId ? credential.invocations.get(invocationId) : null
    if (!record || generation !== record.generation) {
      this.respond(response, 404)
      return
    }
    credential.invocations.delete(record.invocationId)
    if (credential.sessionId && credential.currentGeneration === record.generation) {
      this.emitActivity(credential.sessionId, record, 'exited')
    }
    await record.artifacts.dispose()
    this.respond(response, 204)
  }

  private startInvocation(credential: TerminalCredential, record: InvocationRecord): void {
    const sessionId = credential.sessionId
    if (!sessionId || credential.currentGeneration !== record.generation) {
      return
    }
    record.plan.onStarted?.(sessionId, {
      provider: record.provider,
      invocationId: record.invocationId,
      generation: record.generation,
      isCurrent: () =>
        credential.currentGeneration === record.generation &&
        credential.invocations.get(record.invocationId) === record,
    })
    this.emitActivity(sessionId, record, 'active')
  }

  private emitActivity(
    sessionId: string,
    record: InvocationRecord,
    phase: 'active' | 'exited',
  ): void {
    const event: TerminalSessionMetadataEvent = {
      sessionId,
      resumeSessionId: null,
      terminalAgentActivity: {
        provider: record.provider,
        invocationId: record.invocationId,
        generation: record.generation,
        phase,
        observedAtMs: phase === 'active' ? record.startedAtMs : this.now(),
        identityAuthority: null,
      },
    }
    this.listeners.forEach(listener => listener(event))
  }

  private findCurrentInvocation(credential: TerminalCredential): InvocationRecord | null {
    return (
      [...credential.invocations.values()].find(
        invocation => invocation.generation === credential.currentGeneration,
      ) ?? null
    )
  }

  private async disposeInvocations(credential: TerminalCredential): Promise<void> {
    const invocations = [...credential.invocations.values()]
    credential.invocations.clear()
    await Promise.all(invocations.map(async invocation => await invocation.artifacts.dispose()))
  }

  private isCredentialLive(credential: TerminalCredential): boolean {
    return !this.disposed && this.credentials.get(credential.token) === credential
  }

  private respond(response: ServerResponse, statusCode: number, body?: unknown): void {
    response.statusCode = statusCode
    if (body === undefined) {
      response.end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(body))
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) {
    return
  }
  await new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      throw new Error('Terminal Agent activity request is too large.')
    }
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Terminal Agent activity request must be an object.')
  }
  return parsed as Record<string, unknown>
}

function normalizeProvider(value: unknown): TerminalAgentShimProvider | null {
  return value === 'claude-code' || value === 'codex' ? value : null
}

function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function normalizeIdentifier(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value)
  return normalized && /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : null
}

function normalizeGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function normalizeEnvironment(value: unknown): NodeJS.ProcessEnv | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const entries = Object.entries(value)
  if (!entries.every(([, entry]) => typeof entry === 'string')) {
    return null
  }
  return Object.fromEntries(entries) as NodeJS.ProcessEnv
}

function definedEnvironment(environment: Readonly<NodeJS.ProcessEnv>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string'
    }),
  )
}
