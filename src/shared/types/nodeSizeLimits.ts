/** Shared size contract: runtime enforcement and CLI help read the same values. */
export const NODE_MIN_SIZE_BY_KIND = {
  terminal: { width: 400, height: 260 },
  task: { width: 220, height: 260 },
  agent: { width: 400, height: 520 },
  note: { width: 220, height: 140 },
  role: { width: 320, height: 300 },
  image: { width: 180, height: 120 },
  document: { width: 400, height: 260 },
  folder: { width: 360, height: 260 },
  website: { width: 400, height: 260 },
  plugin: { width: 400, height: 260 },
} as const
