import { randomBytes } from 'node:crypto'

export function createControlToken(random: (size: number) => Buffer = randomBytes): string {
  // Preserve all 256 bits without a leading '-' that breaks the documented --token <value> form.
  return random(32).toString('hex')
}
