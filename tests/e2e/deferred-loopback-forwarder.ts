import { createConnection, createServer, type Socket } from 'node:net'

/** Own the simulated remote address throughout bootstrap, including while its Worker is down. */
export async function createDeferredLoopbackForwarder() {
  let targetPort: number | null = null
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    if (targetPort === null) {
      socket.destroy()
      return
    }
    const upstream = createConnection({ host: '127.0.0.1', port: targetPort })
    sockets.add(socket)
    sockets.add(upstream)
    const close = () => {
      sockets.delete(socket)
      sockets.delete(upstream)
      socket.destroy()
      upstream.destroy()
    }
    socket.on('error', close).on('close', close)
    upstream.on('error', close).on('close', close)
    socket.pipe(upstream).pipe(socket)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Missing simulated remote address')
  }
  return {
    port: address.port,
    forwardTo: (port: number) => {
      targetPort = port
    },
    dispose: async () => {
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      for (const socket of sockets) {
        socket.destroy()
      }
      await closed
    },
  }
}
