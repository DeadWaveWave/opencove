import type { WorkerConnectionInfoDto } from '../../../shared/contracts/dto'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'
import { invokeLocalWorkerConfiguration } from './localWorkerConfigurationClient'

function normalizeTicketResult(value: unknown): { ticket: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid auth.issueWebSessionTicket response payload')
  }
  const ticket = (value as Record<string, unknown>).ticket
  if (typeof ticket !== 'string' || ticket.trim().length === 0) {
    throw new Error('Invalid auth.issueWebSessionTicket ticket value')
  }
  return { ticket: ticket.trim() }
}

export async function resolveLocalWorkerWebUiUrl(
  resolveConnection: () => Promise<WorkerConnectionInfoDto | null>,
): Promise<string | null> {
  const connection = await resolveConnection()
  if (!connection) {
    return null
  }
  const configuration = await invokeLocalWorkerConfiguration(connection, {
    kind: 'query',
    id: 'worker.config.get',
    payload: null,
  })
  if (configuration.webAccess.state !== 'active') {
    return null
  }
  const webBaseUrl = `http://${configuration.webAccess.hostname}:${configuration.webAccess.port}`
  if (configuration.webAccess.passwordRequired) {
    return `${webBaseUrl}/`
  }

  const { httpStatus, result } = await invokeControlSurface(
    {
      hostname: connection.hostname,
      port: connection.port,
      token: connection.token,
    },
    {
      kind: 'query',
      id: 'auth.issueWebSessionTicket',
      payload: { redirectPath: '/' },
    },
  )
  if (httpStatus !== 200 || !result || result.ok !== true) {
    throw new Error('Failed to issue web session ticket')
  }
  const { ticket } = normalizeTicketResult(result.value)
  return `${webBaseUrl}/auth/claim?ticket=${encodeURIComponent(ticket)}`
}
