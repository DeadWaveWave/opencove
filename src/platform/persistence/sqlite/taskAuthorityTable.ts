import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Read mapping for the independent authority ledger; DDL lives in taskAuthoritySchema. */
export const taskFieldAuthority = sqliteTable('task_field_authority', {
  nodeId: text('node_id').primaryKey(),
  projectId: text('project_id').notNull(),
  kind: text('kind').notNull(),
  generation: text('generation').notNull(),
  activeHolderNodeId: text('active_holder_node_id'),
  retired: integer('retired').notNull(),
  fieldsJson: text('fields_json').notNull(),
})
