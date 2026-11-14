export const NOTE_APPEND_MAX_BYTES = 64 * 1024
export const NOTE_BODY_MAX_BYTES = 1024 * 1024
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength
