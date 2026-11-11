import type { NodeLineageRecord } from '../../domain/nodeLineage'
/** Only creation commits may insert. Reads never adopt or repair ancestry. */
export interface NodeLineageRepository {
  /** Startup audit: orphan ancestry has no durable endpoint/session association. */
  readAll?(): Promise<ReadonlyMap<string, NodeLineageRecord>>
  readMany(nodeIds: readonly string[]): Promise<ReadonlyMap<string, NodeLineageRecord>>
}
