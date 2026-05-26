import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from '../../../../platform/persistence/sqlite/migrate'

export interface SessionFileFingerprint {
  mtimeMs: number
  size: number
}

// read 命中时返回 { value };未命中返回 null。用包装区分"命中但值本身是 null"
// (例如某会话解析不出标题)与"未命中"两种情况。
export interface CachedSessionValue {
  value: unknown
}

// 会话目录扫描结果的持久化存储(L2)。复刻 BrowserProfileStore 的写法:打开共享的
// opencove.db、跑共享 migrate(幂等建表)、用 prepared statement 同步读写。与会话目录
// 扫描同处主进程,故读写为同步调用。value 以 JSON 存储,对各 provider 形状不敏感。
export interface AgentSessionTitleCacheStore {
  read: (filePath: string, fingerprint: SessionFileFingerprint) => CachedSessionValue | null
  write: (params: {
    filePath: string
    provider: string
    fingerprint: SessionFileFingerprint
    value: unknown
  }) => void
  // 删除磁盘上已不存在的会话文件对应的行,防止长期累积陈旧记录;返回删除条数。
  pruneMissing: () => number
  dispose: () => void
}

interface CachedTitleRow {
  mtime_ms?: unknown
  size?: unknown
  value_json?: unknown
}

export async function createAgentSessionTitleCacheStore(storeOptions: {
  dbPath: string
}): Promise<AgentSessionTitleCacheStore> {
  await mkdir(dirname(storeOptions.dbPath), { recursive: true })
  const db = new Database(storeOptions.dbPath)
  migrate(db)

  const read = (
    filePath: string,
    fingerprint: SessionFileFingerprint,
  ): CachedSessionValue | null => {
    const row = db
      .prepare(
        'SELECT mtime_ms, size, value_json FROM agent_session_title_cache WHERE file_path = ? LIMIT 1',
      )
      .get(filePath) as CachedTitleRow | undefined

    if (!row || typeof row.mtime_ms !== 'number' || typeof row.size !== 'number') {
      return null
    }

    // 指纹失配(会话被追加 / 文件被替换)→ 视为未命中,交由上层重新扫描。
    if (row.mtime_ms !== fingerprint.mtimeMs || row.size !== fingerprint.size) {
      return null
    }

    if (typeof row.value_json !== 'string') {
      return null
    }

    try {
      return { value: JSON.parse(row.value_json) }
    } catch {
      // 记录损坏 → 当作未命中,重新扫描后会覆盖它。
      return null
    }
  }

  const write = (params: {
    filePath: string
    provider: string
    fingerprint: SessionFileFingerprint
    value: unknown
  }): void => {
    const valueJson = JSON.stringify(params.value === undefined ? null : params.value)
    db.prepare(
      `
        INSERT INTO agent_session_title_cache
          (file_path, provider, mtime_ms, size, value_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          provider = excluded.provider,
          mtime_ms = excluded.mtime_ms,
          size = excluded.size,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
    ).run(
      params.filePath,
      params.provider,
      params.fingerprint.mtimeMs,
      params.fingerprint.size,
      valueJson,
      new Date().toISOString(),
    )
  }

  const pruneMissing = (): number => {
    const rows = db.prepare('SELECT file_path FROM agent_session_title_cache').all() as Array<{
      file_path?: unknown
    }>

    const missing = rows
      .map(row => (typeof row.file_path === 'string' ? row.file_path : null))
      .filter((filePath): filePath is string => filePath !== null && !existsSync(filePath))

    if (missing.length === 0) {
      return 0
    }

    const deleteStatement = db.prepare('DELETE FROM agent_session_title_cache WHERE file_path = ?')
    const deleteMany = db.transaction((filePaths: string[]) => {
      for (const filePath of filePaths) {
        deleteStatement.run(filePath)
      }
    })
    deleteMany(missing)

    return missing.length
  }

  return {
    read,
    write,
    pruneMissing,
    dispose: () => {
      try {
        db.close()
      } catch {
        // ignore
      }
    },
  }
}
