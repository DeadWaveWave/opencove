import type { NodeLineageRecord } from '../../domain/nodeLineage'
/** Only creation commits may insert. Reads never adopt or repair ancestry. */
export interface NodeLineageRepository {
  readMany(nodeIds: readonly string[]): Promise<ReadonlyMap<string, NodeLineageRecord>>
}
