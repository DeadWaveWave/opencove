import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import * as z from 'zod'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { readJsonBody, sendJson } from './httpJson'
import {
  assertManagedClaudeMutationAllowed,
  managedClaudeWritesEnabled,
} from '../managedClaudeCompatibility'
import { toAppErrorDescriptor, createAppError } from '../../../../shared/errors/appError'

const inputSchema = z
  .object({
    nodeId: z.string().min(1).max(256),
    resumeSessionId: z.uuid(),
  })
  .strict()

/** No operation registration: available only in an explicitly enabled test Worker. */
export async function tryManagedClaudeTestHook(input: {
  req: IncomingMessage
  res: ServerResponse
  privateBearer: boolean
  getStore(): Promise<PersistenceStore>
}): Promise<boolean> {
  if (
    input.req.url !== '/_test/managed-claude-rebind' ||
    input.req.method !== 'POST' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.OPENCOVE_TEST_ENABLE_MANAGED_CLAUDE_REBIND !== '1'
  ) {
    return false
  }
  if (!input.privateBearer) {
    sendJson(input.res, 403, { ok: false })
    return true
  }
  try {
    const payload = inputSchema.parse(await readJsonBody(input.req))
    assertManagedClaudeMutationAllowed(
      { clientFeatures: { managedClaudeResumeBindingV1: true } } as Parameters<
        typeof assertManagedClaudeMutationAllowed
      >[0],
      payload.nodeId,
      managedClaudeWritesEnabled(),
    )
    const store = await input.getStore()
    const binding = store.observeManagedClaudeNode?.(payload.nodeId).binding
    if (!binding?.runtimeSessionId || !store.commitManagedClaudeRebind) {
      throw createAppError('session.not_found')
    }
    const result = await store.commitManagedClaudeRebind({
      nodeId: payload.nodeId,
      runtimeSessionId: binding.runtimeSessionId,
      activationId: randomUUID(),
      expected: binding.tuple,
      next: { resumeSessionId: payload.resumeSessionId, resumeSessionIdVerified: true },
    })
    sendJson(input.res, 200, result)
  } catch (error) {
    sendJson(input.res, 400, { ok: false, error: toAppErrorDescriptor(error) })
  }
  return true
}
