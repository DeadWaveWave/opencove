import { createServer } from 'node:http'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../src/app/cli/constants.mjs'

/** Fake Worker HTTP envelope/SSE pattern shared with cliPluginCommands.spec.ts. */
export function agentWaitHttpFixture(snapshot: AgentRunSnapshot) {
  const requests: string[] = []
  let closed = false
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.flushHeaders()
      res.on('close', () => {
        closed = true
      })
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { id: string }
    requests.push(body.id)
    const node = {
      id: 'a',
      kind: 'agent',
      title: 'Child',
      projectId: 'p',
      spaceId: 'space',
      sessionId: snapshot.sessionId,
    }
    const value =
      body.id === 'system.whoami'
        ? { kind: 'bearer', scopeTier: 'admin' }
        : body.id === 'system.capabilities'
          ? { protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION }
          : body.id === 'node.get'
            ? { node }
            : body.id === 'node.list'
              ? { nodes: [node] }
              : body.id === 'agent.list'
                ? { epoch: 'e', seq: 0, agents: [snapshot] }
                : body.id === 'agent.get'
                  ? snapshot
                  : null
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value }))
  })
  return {
    server,
    requests,
    closed: () => closed,
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Missing fixture address')
      }
      return `http://127.0.0.1:${address.port}`
    },
    async stop() {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
