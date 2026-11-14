import type { NodeLineageRepository } from './NodeLineageRepository'
import type { NodeLineageRecord } from '../../domain/nodeLineage'
import { projectNodeLineage } from '../../domain/nodeLineage'
/** Connection-local cache of immutable creation facts; no adoption or writes. */
export class EventLineageReader {
  private disposed = false
  private bytes = 0
  private readonly cache = new Map<string, NodeLineageRecord | null>()
  constructor(
    private readonly repository: NodeLineageRepository,
    private readonly budget = 1024,
  ) {}
  private async read(id: string) {
    if (this.disposed) {
      throw new Error('Ancestry reader closed')
    }
    if (!this.cache.has(id)) {
      if (this.cache.size >= this.budget) {
        throw new Error('Ancestry budget exhausted')
      }
      const row = (await this.repository.readMany([id])).get(id) ?? null
      if (this.disposed) {
        throw new Error('Ancestry reader closed')
      }
      const size = new TextEncoder().encode(id + JSON.stringify(row)).byteLength
      if (this.bytes + size > 256 * 1024) {
        throw new Error('Ancestry byte budget exhausted')
      }
      this.bytes += size
      this.cache.set(id, row)
    }
    return this.cache.get(id)!
  }
  async project(id: string | null) {
    if (id === null) {
      throw new Error('Unbound observation')
    }
    return projectNodeLineage(await this.read(id))
  }
  async matches(id: string | null, relationship: { spawnedBy?: string; lineage?: string }) {
    if (id === null) {
      return false
    }
    if (relationship.spawnedBy) {
      return (await this.read(id))?.spawnedBy === relationship.spawnedBy
    }
    const seen = new Set<string>()
    while (id !== null) {
      if (id === relationship.lineage) {
        return true
      }
      if (seen.has(id) || seen.size >= this.budget) {
        throw new Error('Ancestry cycle or work limit')
      }
      seen.add(id)
      // Each immutable parent determines the next read.
      id = (await this.read(id))?.spawnedBy ?? null
    }
    return false
  }
  dispose() {
    this.disposed = true
    this.bytes = 0
    this.cache.clear()
  }
}
