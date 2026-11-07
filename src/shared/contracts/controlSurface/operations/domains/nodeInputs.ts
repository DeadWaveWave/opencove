import * as z from 'zod'
import { normalizeCreatePayload } from '../nodeNormalize'
import { createAppError } from '../../../../errors/appError'

const optionalText = (description: string) => z.string().describe(description).nullish()
const priority = z
  .enum(['low', 'medium', 'high', 'urgent'])
  .describe('Task priority; defaults to medium')
  .nullish()
const status = z
  .enum(['todo', 'doing', 'ai_done', 'done'])
  .describe('Task workflow status; defaults to todo')
  .nullish()
const tags = z
  .array(z.string())
  .describe('Complete task tag list; an empty array clears tags')
  .nullish()
const url = z
  .string()
  .regex(/\S/)
  .describe('Website address: HTTP(S) URL or hostname; a missing scheme is normalized to HTTPS')
const website = {
  url,
  pinned: z.boolean().describe('Keep the website pinned').nullish(),
  sessionMode: z
    .enum(['shared', 'incognito', 'profile'])
    .describe('Browser session mode')
    .nullish(),
  profileId: optionalText('Browser profile ID when sessionMode is profile'),
}
const task = {
  requirement: z.string().regex(/\S/).describe('Non-empty task requirement'),
  priority,
  status,
  tags,
}
const frame = z
  .strictObject({
    x: z.number().nullish().describe('Canvas x coordinate'),
    y: z.number().nullish().describe('Canvas y coordinate'),
    width: z.number().nullish().describe('Width in canvas units; clamped to node limits'),
    height: z.number().nullish().describe('Height in canvas units; clamped to node limits'),
  })
  .nullish()
export const nodeSpaceLocator = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('spaceId'), spaceId: z.string() }),
    z.strictObject({
      kind: z.literal('spaceName'),
      name: z.string(),
      projectId: optionalText('Project ID to narrow the space name'),
    }),
    z.strictObject({
      kind: z.literal('workerBranch'),
      worker: z.string(),
      branch: z.string(),
      projectId: optionalText('Project ID to narrow the branch'),
    }),
    z.strictObject({
      kind: z.literal('workerPath'),
      worker: z.string(),
      path: z.string(),
      projectId: optionalText('Project ID to narrow the directory'),
    }),
  ])
  .describe('Target space; otherwise select the active space of projectId')
const create = {
  space: nodeSpaceLocator.nullish(),
  spaceId: optionalText('Target space ID; use either spaceId or space'),
  projectId: optionalText('Owning project ID'),
  title: optionalText('Node title; omitted or blank uses a kind-specific title'),
  frame,
}
const update = {
  nodeId: z.string().min(1).describe('Existing node ID'),
  title: optionalText('Replacement title'),
  frame,
}
export const nodeCreateInput = z.discriminatedUnion('kind', [
  z.strictObject({
    ...create,
    kind: z.literal('note'),
    data: z.strictObject({ text: optionalText('Note contents; defaults to empty text') }).nullish(),
  }),
  z.strictObject({ ...create, kind: z.literal('task'), data: z.strictObject(task) }),
  z.strictObject({ ...create, kind: z.literal('website'), data: z.strictObject(website) }),
  z.strictObject({
    ...create,
    kind: z.literal('agent'),
    data: z
      .strictObject({
        prompt: optionalText('Initial prompt; defaults to empty text'),
        provider: z
          .enum(['claude-code', 'codex', 'opencode', 'gemini', 'pi', 'kimi', ''])
          .describe('Agent provider; omitted or empty uses the configured default')
          .nullish(),
        model: optionalText('Provider model ID'),
      })
      .nullish(),
  }),
  z.strictObject({
    ...create,
    kind: z.literal('terminal'),
    data: z
      .strictObject({
        shell: optionalText('Shell executable path'),
        command: optionalText('Initial shell command'),
        profileId: optionalText('Terminal profile ID'),
      })
      .nullish(),
  }),
])
export const nodeUpdateInput = z.discriminatedUnion('kind', [
  z.strictObject({
    ...update,
    kind: z.literal('note'),
    data: z.strictObject({ text: optionalText('Replacement note contents') }).nullish(),
  }),
  z.strictObject({
    ...update,
    kind: z.literal('task'),
    data: z
      .strictObject({ ...task, requirement: optionalText('Replacement task requirement') })
      .partial()
      .nullish(),
  }),
  z.strictObject({
    ...update,
    kind: z.literal('website'),
    data: z.strictObject(website).partial().nullish(),
  }),
])

export function normalizeNodeCreateInput(wire: z.output<typeof nodeCreateInput>) {
  if (
    wire.spaceId !== null &&
    wire.spaceId !== undefined &&
    wire.space !== null &&
    wire.space !== undefined
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Use either spaceId or space, not both.',
    })
  }
  return normalizeCreatePayload({
    ...wire,
    space:
      wire.space ??
      (wire.spaceId !== null && wire.spaceId !== undefined
        ? { kind: 'spaceId', spaceId: wire.spaceId }
        : null),
  })
}
