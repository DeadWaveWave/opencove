import type { ClientState } from './ptyStreamState'

export function unregisterPtyClient(
  clients: Map<string, ClientState>,
  clientId: string,
  detach: (clientId: string, sessionId: string) => void,
): void {
  const client = clients.get(clientId)
  if (!client) {
    return
  }
  for (const sessionId of client.rolesBySessionId.keys()) {
    detach(clientId, sessionId)
  }
  clients.delete(clientId)
}
