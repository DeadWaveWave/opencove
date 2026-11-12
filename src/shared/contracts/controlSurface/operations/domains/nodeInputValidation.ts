import * as z from 'zod'
import { createAppError } from '../../../../errors/appError'

function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])))
    }
    row = next
  }
  return row[b.length]
}

/** Preserve structured unknown-key diagnostics through the registry's raw-input hook. */
export function withStrictInput<T extends z.ZodType, R>(
  schema: T,
  normalize: (input: z.output<T>) => R,
) {
  return (input: unknown): R => {
    const issues: {
      path: string[]
      code: string
      message: string
      allowedKeys: string[]
      hint?: string
    }[] = []
    function visit(type: z.ZodType, value: unknown, path: string[]) {
      if (type instanceof z.ZodOptional || type instanceof z.ZodNullable) {
        visit(type.unwrap() as z.ZodType, value, path)
      } else if (type instanceof z.ZodDiscriminatedUnion) {
        const branch = type.options.find(option => {
          const object = option as z.ZodObject
          return object.shape.kind.safeParse((value as { kind?: unknown } | null)?.kind).success
        })
        if (branch) {
          visit(branch as z.ZodType, value, path)
        }
      } else if (
        type instanceof z.ZodObject &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const allowedKeys = Object.keys(type.shape)
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(type.shape, key)) {
            const closest = allowedKeys.toSorted((a, b) => distance(key, a) - distance(key, b))[0]
            const suggestion = closest && distance(key, closest) <= 2 ? closest : undefined
            const space = suggestion === 'space'
            issues.push({
              path: [...path, key],
              code: 'unrecognized_keys',
              allowedKeys,
              message: `Unknown key "${key}".${suggestion ? ` Did you mean "${suggestion}"?` : ''} Allowed keys: ${allowedKeys.join(', ')}`,
              hint: space
                ? 'Use a space locator, for example: {"space":{"kind":"spaceId","spaceId":"…"}}'
                : undefined,
            })
          } else {
            visit(type.shape[key], (value as Record<string, unknown>)[key], [...path, key])
          }
        }
      }
    }
    visit(schema, input, [])
    if (issues.length) {
      throw createAppError('common.invalid_input', {
        debugMessage: issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        details: { issues },
      })
    }
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      throw createAppError('common.invalid_input', {
        details: { issues: parsed.error.issues },
        debugMessage: parsed.error.issues
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      })
    }
    return normalize(parsed.data)
  }
}
