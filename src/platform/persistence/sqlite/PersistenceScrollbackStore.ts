import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import type { PersistWriteResult } from '../../../shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'
import { normalizeScrollback } from './normalize'
import { agentNodePlaceholderScrollback, nodeScrollback } from './schema'
import { toErrorMessage, utf8ByteLength } from './utils'

function readNodeScrollbackFromDb(db: BetterSQLite3Database, nodeId: string): string | null {
  const row = db
    .select({ scrollback: nodeScrollback.scrollback })
    .from(nodeScrollback)
    .where(eq(nodeScrollback.nodeId, nodeId))
    .get()
  return typeof row?.scrollback === 'string' ? row.scrollback : null
}

function readAgentNodePlaceholderScrollbackFromDb(
  db: BetterSQLite3Database,
  nodeId: string,
): string | null {
  const row = db
    .select({ scrollback: agentNodePlaceholderScrollback.scrollback })
    .from(agentNodePlaceholderScrollback)
    .where(eq(agentNodePlaceholderScrollback.nodeId, nodeId))
    .get()
  return typeof row?.scrollback === 'string' ? row.scrollback : null
}

export function createPersistenceScrollbackStore(
  sqlite: Database.Database,
  db: BetterSQLite3Database,
) {
  const readNodeScrollback = async (nodeId: string): Promise<string | null> => {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return null
    }

    try {
      return readNodeScrollbackFromDb(db, normalized)
    } catch {
      return null
    }
  }

  const readAgentNodePlaceholderScrollback = async (nodeId: string): Promise<string | null> => {
    const normalized = nodeId.trim()
    if (normalized.length === 0) {
      return null
    }

    try {
      return readAgentNodePlaceholderScrollbackFromDb(db, normalized)
    } catch {
      return null
    }
  }

  const writeNodeScrollback = async (
    nodeId: string,
    scrollback: string | null,
  ): Promise<PersistWriteResult> => {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_node_id', {
          debugMessage: 'Missing node id.',
        }),
      }
    }

    try {
      const recoveryOwned = sqlite
        .prepare('SELECT 1 FROM terminal_recovery_records WHERE node_id = ? LIMIT 1')
        .get(normalizedNodeId)
      if (recoveryOwned) {
        // Once the Worker has reserved this node, renderer scrollback is only a view cache. A late
        // renderer flush must never overwrite (or delete) the Worker-owned durability mirror.
        return { ok: true, level: 'full', bytes: 0 }
      }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }

    const normalizedScrollback = normalizeScrollback(scrollback)
    if (!normalizedScrollback) {
      try {
        db.delete(nodeScrollback).where(eq(nodeScrollback.nodeId, normalizedNodeId)).run()
        return { ok: true, level: 'full', bytes: 0 }
      } catch (error) {
        return {
          ok: false,
          reason: 'io',
          error: createAppErrorDescriptor('persistence.io_failed', {
            debugMessage: toErrorMessage(error),
          }),
        }
      }
    }

    try {
      const nowIso = new Date().toISOString()
      db.insert(nodeScrollback)
        .values({ nodeId: normalizedNodeId, scrollback: normalizedScrollback, updatedAt: nowIso })
        .onConflictDoUpdate({
          target: nodeScrollback.nodeId,
          set: { scrollback: normalizedScrollback, updatedAt: nowIso },
        })
        .run()
      return { ok: true, level: 'full', bytes: utf8ByteLength(normalizedScrollback) }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  const writeAgentNodePlaceholderScrollback = async (
    nodeId: string,
    scrollback: string | null,
  ): Promise<PersistWriteResult> => {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) {
      return {
        ok: false,
        reason: 'unknown',
        error: createAppErrorDescriptor('persistence.invalid_node_id', {
          debugMessage: 'Missing node id.',
        }),
      }
    }

    const normalizedScrollback = normalizeScrollback(scrollback)
    if (!normalizedScrollback) {
      try {
        db.delete(agentNodePlaceholderScrollback)
          .where(eq(agentNodePlaceholderScrollback.nodeId, normalizedNodeId))
          .run()
        return { ok: true, level: 'full', bytes: 0 }
      } catch (error) {
        return {
          ok: false,
          reason: 'io',
          error: createAppErrorDescriptor('persistence.io_failed', {
            debugMessage: toErrorMessage(error),
          }),
        }
      }
    }

    try {
      const nowIso = new Date().toISOString()
      db.insert(agentNodePlaceholderScrollback)
        .values({
          nodeId: normalizedNodeId,
          scrollback: normalizedScrollback,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: agentNodePlaceholderScrollback.nodeId,
          set: { scrollback: normalizedScrollback, updatedAt: nowIso },
        })
        .run()
      return { ok: true, level: 'full', bytes: utf8ByteLength(normalizedScrollback) }
    } catch (error) {
      return {
        ok: false,
        reason: 'io',
        error: createAppErrorDescriptor('persistence.io_failed', {
          debugMessage: toErrorMessage(error),
        }),
      }
    }
  }

  return {
    readNodeScrollback,
    writeNodeScrollback,
    readAgentNodePlaceholderScrollback,
    writeAgentNodePlaceholderScrollback,
  }
}
