import * as argon2 from 'argon2'
import { validationError } from './errors.js'

const MAX_PASSWORD_LENGTH = 200

export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$9CseLrdl9gyloxBpoKk8pA$K/1XxnKzONqdw8D2lD0ErNbJT5Ije89BG8+UckBiF3c'

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
}

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length > MAX_PASSWORD_LENGTH) {
    throw validationError({
      password: `Password exceeds maximum length of ${MAX_PASSWORD_LENGTH} characters`,
    })
  }

  return argon2.hash(plain, ARGON2_OPTIONS)
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (plain.length > MAX_PASSWORD_LENGTH) {
    return false
  }

  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}
