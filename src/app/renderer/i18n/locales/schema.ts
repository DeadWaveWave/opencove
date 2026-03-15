import type { en } from './en'

type DeepTranslationShape<T> = T extends string
  ? string
  : T extends Record<string, unknown>
    ? { readonly [K in keyof T]: DeepTranslationShape<T[K]> }
    : never

export type TranslationDictionary = DeepTranslationShape<typeof en>
