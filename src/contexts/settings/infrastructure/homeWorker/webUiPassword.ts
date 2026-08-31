import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const SCRYPT_KEY_LENGTH_BYTES = 64
const PASSWORD_SALT_LENGTH_BYTES = 16
const MAX_PASSWORD_LENGTH = 1024

type ParsedPasswordHash = {
  salt: Buffer
  hash: Buffer
}

function normalizePassword(value: string): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  const trimmed = encoded.trim()
  const parts = trimmed.split(':')
  if (parts.length !== 3) {
    return null
  }

  const [scheme, saltBase64, hashBase64] = parts
  if (scheme !== 'scrypt') {
    return null
  }

  try {
    const salt = Buffer.from(saltBase64, 'base64')
    const hash = Buffer.from(hashBase64, 'base64')
    if (salt.length === 0 || hash.length === 0) {
      return null
    }

    return { salt, hash }
  } catch {
    return null
  }
}

export function isValidWebUiPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && parsePasswordHash(value) !== null
}

export async function hashWebUiPassword(rawPassword: string): Promise<string> {
  const password = normalizePassword(rawPassword)
  if (password.length === 0) {
    throw new Error('Password is required.')
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password is too long.')
  }

  const salt = randomBytes(PASSWORD_SALT_LENGTH_BYTES)
  const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH_BYTES)) as Buffer
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`
}

export async function verifyWebUiPassword(
  rawPassword: string,
  encodedHash: string,
): Promise<boolean> {
  const password = normalizePassword(rawPassword)
  if (password.length === 0) {
    return false
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return false
  }

  const parsed = parsePasswordHash(encodedHash)
  if (!parsed) {
    return false
  }

  const derived = (await scryptAsync(password, parsed.salt, parsed.hash.length)) as Buffer
  if (derived.length !== parsed.hash.length) {
    return false
  }

  return timingSafeEqual(derived, parsed.hash)
}
