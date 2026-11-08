import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

type ResponsesInputItem = {
  type?: string
  role?: string
  content?: Array<{ type: string; text?: string }>
}
type ResponsesRequest = {
  stream?: boolean
  tools?: Array<{ name?: string }>
  input?: ResponsesInputItem[]
}

function lastUserBlocks(body: ResponsesRequest): string[] {
  const last = (body.input ?? [])
    .filter(item => item.type === 'message' && item.role === 'user')
    .at(-1)
  return (last?.content ?? [])
    .filter(block => block.type === 'input_text')
    .map(block => block.text ?? '')
}

function continuesToolCall(body: ResponsesRequest): boolean {
  return (body.input ?? []).at(-1)?.type === 'function_call_output'
}

function respond(
  res: ServerResponse,
  approvalProbe: boolean,
  slowTool = false,
  slowToolCommand = 'sleep 3',
): void {
  const id = `resp_${Date.now()}`
  const item = slowTool
    ? {
        type: 'function_call',
        id: 'fc_sleep',
        call_id: `call_sleep_${Date.now()}`,
        name: 'exec_command',
        status: 'completed',
        arguments: JSON.stringify({ cmd: slowToolCommand }),
      }
    : approvalProbe
      ? {
          type: 'function_call',
          id: 'fc_probe',
          call_id: 'call_probe',
          name: 'exec_command',
          status: 'completed',
          // Escalation outside the sandbox needs the user's approval under on-request.
          arguments: JSON.stringify({
            cmd: 'touch opencove-approval-probe.txt',
            sandbox_permissions: 'require_escalated',
            justification: 'Create the approval probe file',
          }),
        }
      : {
          type: 'message',
          id: 'msg_ack',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'ACK', annotations: [] }],
        }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (type: string, data: Record<string, unknown>) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  send('response.created', { response: { id, status: 'in_progress', output: [] } })
  send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } })
  send('response.output_item.done', { output_index: 0, item })
  send('response.completed', {
    response: {
      id,
      status: 'completed',
      output: [item],
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    },
  })
  res.end()
}

export async function startResponsesApi(slowToolCommand = 'sleep 3'): Promise<{
  server: Server
  url: string
  main: () => string[][]
  all: () => string[]
}> {
  // Text blocks of the latest user message in each agent-loop request that starts a turn.
  const mainTurns: string[][] = []
  // User text of every agent-loop request, including requests that resume after a tool call.
  const allUserText: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    let body: ResponsesRequest | null = null
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ResponsesRequest
    } catch {
      body = null
    }
    if (req.method === 'POST' && (req.url ?? '').includes('/responses') && body) {
      const isMain = (body.tools ?? []).some(tool => tool.name === 'exec_command')
      const blocks = lastUserBlocks(body)
      const resumed = continuesToolCall(body)
      if (isMain && !resumed) {
        mainTurns.push(blocks)
      }
      if (isMain) {
        allUserText.push(
          (body.input ?? [])
            .filter(item => item.type === 'message' && item.role === 'user')
            .flatMap(item => (item.content ?? []).map(block => block.text ?? ''))
            .join('\n'),
        )
      }
      respond(
        res,
        isMain && !resumed && blocks.some(block => block.includes('TRIGGER_TOOL')),
        isMain && !resumed && blocks.some(block => block.includes('SLOW_TOOL')),
        slowToolCommand,
      )
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${port}/v1`,
    main: () => [...mainTurns],
    all: () => [...allUserText],
  }
}
