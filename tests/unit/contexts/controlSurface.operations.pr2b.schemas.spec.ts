// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'

// Independent expected wire contract, including permissive fields normalized by legacy rules.
const expected: Record<
  string,
  { fields: string[]; required: string[]; types: Record<string, string> }
> = {
  'endpoint.register': {
    fields: ['hostname', 'port', 'token', 'displayName'],
    required: ['hostname', 'port', 'token'],
    types: {
      hostname: 'string',
      port: 'number',
      token: 'string',
    },
  },
  'endpoint.ping': {
    fields: ['endpointId', 'timeoutMs'],
    required: ['endpointId'],
    types: {
      endpointId: 'string',
    },
  },
  'endpoint.remove': {
    fields: ['endpointId', 'expectedMountCount'],
    required: ['endpointId'],
    types: {
      endpointId: 'string',
    },
  },
  'mount.create': {
    fields: ['projectId', 'endpointId', 'rootPath', 'name'],
    required: ['projectId', 'endpointId', 'rootPath'],
    types: {
      projectId: 'string',
      endpointId: 'string',
      rootPath: 'string',
    },
  },
  'mount.list': {
    fields: ['projectId'],
    required: ['projectId'],
    types: {
      projectId: 'string',
    },
  },
  'mount.remove': {
    fields: ['mountId'],
    required: ['mountId'],
    types: {
      mountId: 'string',
    },
  },
  'mountTarget.resolve': {
    fields: ['mountId'],
    required: ['mountId'],
    types: {
      mountId: 'string',
    },
  },
  'pty.spawnInMount': {
    fields: ['mountId', 'cwdUri', 'profileId', 'shell', 'command', 'args', 'cols', 'rows', 'env'],
    required: ['mountId'],
    types: {
      mountId: 'string',
    },
  },
  'session.get': {
    fields: ['sessionId'],
    required: ['sessionId'],
    types: {
      sessionId: 'string',
    },
  },
  'session.kill': {
    fields: ['sessionId'],
    required: ['sessionId'],
    types: {
      sessionId: 'string',
    },
  },
  'session.finalMessage': {
    fields: ['sessionId'],
    required: ['sessionId'],
    types: {
      sessionId: 'string',
    },
  },
  'filesystem.readDirectory': {
    fields: ['uri', 'maxEntries'],
    required: ['uri'],
    types: {
      uri: 'string',
      maxEntries: 'number',
    },
  },
  'filesystem.readFileText': {
    fields: ['uri', 'maxBytes'],
    required: ['uri'],
    types: {
      uri: 'string',
      maxBytes: 'number',
    },
  },
  'filesystem.stat': {
    fields: ['uri'],
    required: ['uri'],
    types: {
      uri: 'string',
    },
  },
  'filesystem.readDirectoryInMount': {
    fields: ['uri', 'mountId', 'maxEntries'],
    required: ['uri', 'mountId'],
    types: {
      uri: 'string',
      mountId: 'string',
      maxEntries: 'number',
    },
  },
  'filesystem.readFileTextInMount': {
    fields: ['uri', 'mountId', 'maxBytes'],
    required: ['uri', 'mountId'],
    types: {
      uri: 'string',
      mountId: 'string',
      maxBytes: 'number',
    },
  },
  'filesystem.statInMount': {
    fields: ['uri', 'mountId'],
    required: ['uri', 'mountId'],
    types: {
      uri: 'string',
      mountId: 'string',
    },
  },
  'filesystem.writeFileTextInMount': {
    fields: ['uri', 'mountId', 'content', 'overwrite'],
    required: ['uri', 'mountId', 'content'],
    types: {
      uri: 'string',
      mountId: 'string',
      content: 'string',
      overwrite: 'boolean',
    },
  },
}
for (const [id, contract] of Object.entries(expected)) {
  it(id + ' exports field-level wire shape', () => {
    const operation = getControlSurfaceOperation(id)
    if (operation?.contract !== 'schema') {
      throw new Error('Expected schema operation')
    }
    const exported = z.toJSONSchema(operation.input, { io: 'input', unrepresentable: 'throw' })
    const arrayCompatible = [
      'filesystem.readDirectory',
      'filesystem.readFileText',
      'filesystem.stat',
    ].includes(id)
    const schema = arrayCompatible ? exported.anyOf?.[0] : exported
    if (!schema || typeof schema === 'boolean') {
      throw new Error('Expected object schema')
    }
    if (arrayCompatible) {
      expect(exported.anyOf?.[1]).toMatchObject({ type: 'array' })
    }
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([...contract.fields].sort())
    expect([...(schema.required ?? [])].sort()).toEqual([...contract.required].sort())
    for (const [field, type] of Object.entries(contract.types)) {
      expect(schema.properties?.[field]).toMatchObject({ type })
    }
    expect(operation.input.safeParse(null).success).toBe(false)
    expect(operation.input.safeParse({}).success).toBe(false)
    for (const field of contract.required) {
      expect(operation.input.safeParse({ [field]: false }).success).toBe(false)
    }
  })
}
for (const id of ['endpoint.list', 'system.ping', 'system.capabilities']) {
  it(id + ' intentionally accepts arbitrary legacy payloads', () => {
    const operation = getControlSurfaceOperation(id)
    if (operation?.contract !== 'schema') {
      throw new Error('Expected schema operation')
    }
    for (const payload of [undefined, null, false, 42, 'text', [], {}]) {
      expect(operation.input.safeParse(payload).success).toBe(true)
      expect(operation.normalize(payload)).toEqual(payload ?? null)
    }
  })
}
