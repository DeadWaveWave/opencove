import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { TerminalAgentShimProvider } from '../../../../shared/contracts/dto'
import type {
  AgentHookInjectionPlan,
  AgentHookInjectionPlanner,
} from '../../application/ports/AgentProviderContribution'
import { AgentLaunchArtifactScope } from '../../application/services/AgentLaunchArtifactScope'
import type {
  TerminalAgentInvocation,
  TerminalAgentInvocationRegistry,
  TerminalAgentInvocationTerminal,
} from '../../application/TerminalAgentInvocationRegistry'

const REQUEST_PATH = '/terminal-agent/activity'
const MAX_BODY_BYTES = 64 * 1024

interface InvocationRecord {
  artifacts: AgentLaunchArtifactScope
  invocationId: string
  invocation: TerminalAgentInvocation
  plan: AgentHookInjectionPlan
  provider: TerminalAgentShimProvider
}

interface TerminalCredential {
  disposalPromise: Promise<void> | null
  invocations: Map<string, InvocationRecord>
  sessionId: string | null
  terminal: TerminalAgentInvocationTerminal
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
  private readonly credentialDisposals = new Set<Promise<void>>()
  private server: Server | null = null
  private endpoint: string | null = null
  private startPromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null
  private disposed = false

  public constructor(
    private readonly options: {
      registry: TerminalAgentInvocationRegistry
      resolveHookInjection: (
        provider: TerminalAgentShimProvider,
      ) => AgentHookInjectionPlanner | null
      createHttpServer?: typeof createServer
    },
  ) {}

  public async start(): Promise<void> {
    this.assertNotDisposed()
    if (this.endpoint) {
      return
    }
    if (this.startPromise) {
      await this.startPromise
      this.assertNotDisposed()
      return
    }
    const startPromise = this.startOwnedServer()
    this.startPromise = startPromise
    try {
      await startPromise
      this.assertNotDisposed()
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
    this.assertNotDisposed()
    const endpoint = this.endpoint
    if (!endpoint) {
      throw new Error('Terminal Agent activity gateway did not start.')
    }
    const token = randomBytes(32).toString('base64url')
    const credential: TerminalCredential = {
      disposalPromise: null,
      invocations: new Map(),
      sessionId: null,
      terminal: this.options.registry.reserve({ sourceId: 'terminal-shim' }),
      token,
    }
    this.credentials.set(token, credential)
    return {
      endpoint,
      token,
      commit: sessionId => {
        if (credential.disposalPromise || credential.sessionId || !this.credentials.has(token)) {
          return
        }
        credential.sessionId = sessionId
        credential.terminal.bind(sessionId)
        const current = this.findCurrentInvocation(credential)
        if (current) {
          this.startInvocation(credential, current)
        }
      },
      dispose: () => this.disposeCredential(credential),
    }
  }

  public dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise
    }
    this.disposed = true
    this.disposePromise = this.disposeOwnedResources()
    return this.disposePromise
  }

  private async disposeOwnedResources(): Promise<void> {
    const credentials = [...this.credentials.values()]
    this.credentials.clear()
    const disposals = new Set(this.credentialDisposals)
    credentials.forEach(credential => disposals.add(this.disposeCredential(credential)))
    const credentialDisposals = await Promise.allSettled([...disposals])
    await this.startPromise?.catch(() => undefined)
    const server = this.server
    this.server = null
    this.endpoint = null
    await closeServer(server)
    const failures = credentialDisposals
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason)
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Terminal Agent activity gateway cleanup failed.')
    }
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
    const invocationArguments = normalizeArguments(body.arguments)
    if (
      !provider ||
      !invocationId ||
      !cwd ||
      !executablePath ||
      !environment ||
      !invocationArguments
    ) {
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
    const invocation = credential.terminal.beginInvocation({
      invocationId,
      provider,
      expectedResumeSessionId: resolveExpectedResumeSessionId(provider, invocationArguments),
    })
    if (!invocation) {
      await artifacts.dispose().catch(() => undefined)
      this.respond(response, 409)
      return
    }
    const record: InvocationRecord = {
      artifacts,
      invocationId,
      invocation,
      plan,
      provider,
    }
    credential.invocations.set(invocationId, record)
    if (credential.sessionId) {
      this.startInvocation(credential, record)
    }
    this.respond(response, 200, {
      ok: true,
      args: [...plan.args],
      env: definedEnvironment(plan.env),
      generation: invocation.generation,
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
    if (!record || generation !== record.invocation.generation) {
      this.respond(response, 404)
      return
    }
    if (!credential.terminal.complete({ invocationId: record.invocationId, generation })) {
      this.respond(response, 404)
      return
    }
    credential.invocations.delete(record.invocationId)
    await record.artifacts.dispose()
    this.respond(response, 204)
  }

  private startInvocation(credential: TerminalCredential, record: InvocationRecord): void {
    const sessionId = credential.sessionId
    if (!sessionId || !record.invocation.isCurrent()) {
      return
    }
    record.plan.onStarted?.(sessionId, {
      provider: record.provider,
      invocationId: record.invocationId,
      generation: record.invocation.generation,
      isCurrent: record.invocation.isCurrent,
      observe: record.invocation.observe,
    })
  }

  private findCurrentInvocation(credential: TerminalCredential): InvocationRecord | null {
    return (
      [...credential.invocations.values()].find(invocation => invocation.invocation.isCurrent()) ??
      null
    )
  }

  private async disposeInvocations(credential: TerminalCredential): Promise<void> {
    const invocations = [...credential.invocations.values()]
    credential.invocations.clear()
    const results = await Promise.allSettled(
      invocations.map(async invocation => await invocation.artifacts.dispose()),
    )
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason)
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Terminal Agent invocation cleanup failed.')
    }
  }

  private disposeCredential(credential: TerminalCredential): Promise<void> {
    if (credential.disposalPromise) {
      return credential.disposalPromise
    }
    this.credentials.delete(credential.token)
    credential.terminal.release()
    const disposal = this.disposeInvocations(credential)
    credential.disposalPromise = disposal
    this.credentialDisposals.add(disposal)
    const forgetDisposal = (): void => {
      this.credentialDisposals.delete(disposal)
    }
    void disposal.then(forgetDisposal, forgetDisposal)
    return disposal
  }

  private isCredentialLive(credential: TerminalCredential): boolean {
    return !this.disposed && this.credentials.get(credential.token) === credential
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Terminal Agent activity gateway is disposed.')
    }
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
  return value === 'claude-code' || value === 'codex' || value === 'pi' ? value : null
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

function normalizeArguments(value: unknown): string[] | null {
  if (value === undefined) {
    return []
  }
  return Array.isArray(value) && value.every(argument => typeof argument === 'string')
    ? value
    : null
}

function resolveExpectedResumeSessionId(
  provider: TerminalAgentShimProvider,
  args: readonly string[],
): string | null {
  if (provider === 'claude-code') {
    const resumeIndex = args.findIndex(argument => argument === '--resume')
    if (resumeIndex >= 0) {
      return normalizeNonEmptyString(args[resumeIndex + 1])
    }
    const inline = args.find(argument => argument.startsWith('--resume='))
    return inline ? normalizeNonEmptyString(inline.slice('--resume='.length)) : null
  }
  return args[0] === 'resume' ? normalizeNonEmptyString(args[1]) : null
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
