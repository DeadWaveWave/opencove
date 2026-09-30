import { randomUUID } from 'node:crypto'

export async function activate(context) {
  const startupId = randomUUID()
  context.log('Hello Clock ready')
  return {
    async invoke(method, _params, viewContext) {
      if (method !== 'clock.now') {
        throw new Error(`Unknown clock method: ${method}`)
      }
      return {
        iso: viewContext.preview ? '2030-01-01T12:34:56.000Z' : new Date().toISOString(),
        platform: process.platform,
        startupId,
        preview: viewContext.preview,
      }
    },
    async dispose() {
      context.log('Hello Clock stopped')
    },
  }
}
