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

export const NODE_MAX_SIZE_BY_KIND = {
  terminal: { width: 720, height: 520 },
  task: { width: 360, height: 520 },
  agent: { width: 720, height: 1040 },
  note: { width: 360, height: 260 },
  role: { width: 520, height: 640 },
  image: { width: 960, height: 720 },
  document: { width: 960, height: 900 },
  folder: { width: 960, height: 900 },
  website: { width: 1280, height: 1040 },
  plugin: { width: 1040, height: 820 },
} as const
