// 会话标题/预览的解析缓存。
//
// 背景:列出会话时,需要逐个打开会话日志文件扫描出标题与预览。其中 Claude 的
// 语义标题(ai-title)可能埋在长会话很靠后的位置,深度扫描代价不小;而会话列表
// 每次刷新都会重扫一遍,造成重复 I/O。
//
// 思路:会话日志写定后内容不再变化(其 mtime 与 size 也不变),因此以
// 「文件路径 + mtime + size」为指纹缓存解析结果——历史会话只需做一次昂贵扫描,
// 后续刷新直接命中缓存。会话被追加(mtime/size 变化)时指纹失配,自动重算。
//
// 仅缓存「需要扫描文件」的来源(Claude / Codex / Gemini);OpenCode 的标题来自
// 其自身的 CLI / SQLite,本就廉价,不走这里。

interface SessionFileFingerprint {
  mtimeMs: number
  size: number
}

interface CachedSessionFileEntry {
  mtimeMs: number
  size: number
  value: unknown
}

// 缓存条目上限。每条仅保存截断后的标题/预览(或精简的会话摘要),占用很小;
// 设上限只是防止长时间运行后无界增长。超出后按插入顺序淘汰最旧的一条。
const MAX_CACHED_SESSION_FILES = 4096

const sessionFileCache = new Map<string, CachedSessionFileEntry>()

function isUsableFingerprint(
  fingerprint: SessionFileFingerprint | null,
): fingerprint is SessionFileFingerprint {
  return (
    fingerprint !== null &&
    Number.isFinite(fingerprint.mtimeMs) &&
    Number.isFinite(fingerprint.size)
  )
}

function storeWithEviction(
  filePath: string,
  fingerprint: SessionFileFingerprint,
  value: unknown,
): void {
  if (!sessionFileCache.has(filePath) && sessionFileCache.size >= MAX_CACHED_SESSION_FILES) {
    const oldestKey = sessionFileCache.keys().next().value
    if (oldestKey !== undefined) {
      sessionFileCache.delete(oldestKey)
    }
  }

  sessionFileCache.set(filePath, { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size, value })
}

/**
 * 以文件指纹为键缓存会话文件的解析结果。
 *
 * @param filePath    会话文件路径,作为缓存键。
 * @param fingerprint 文件指纹(mtime + size);为 null 或字段非有限数字时不缓存,
 *                    直接执行 compute(既兼顾文件被删除等异常,也保证测试隔离)。
 * @param compute     指纹失配或不可缓存时,实际执行的解析逻辑。
 */
export async function readSessionFileWithCache<T>(
  filePath: string,
  fingerprint: SessionFileFingerprint | null,
  compute: () => Promise<T>,
): Promise<T> {
  const cacheable = isUsableFingerprint(fingerprint)

  if (cacheable) {
    const cached = sessionFileCache.get(filePath)
    if (cached && cached.mtimeMs === fingerprint.mtimeMs && cached.size === fingerprint.size) {
      return cached.value as T
    }
  }

  const value = await compute()

  if (cacheable) {
    storeWithEviction(filePath, fingerprint, value)
  }

  return value
}

/** 清空缓存。仅供测试用于隔离用例之间的状态。 */
export function clearSessionFileCache(): void {
  sessionFileCache.clear()
}
