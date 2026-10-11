import crypto from 'node:crypto'
import { env } from './env.js'
import { AppError, ERROR_CODES, validationError } from './errors.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const VERSION_PREFIX = 'v1:'

function getEncryptionKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex')
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = getEncryptionKey()
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(VERSION_PREFIX)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      httpStatus: 400,
      message: "Unsupported encryption payload version; expected 'v1:' prefix",
    })
  }

  const parts = payload.split(':')
  if (parts.length !== 4) {
    throw validationError({ payload: 'Malformed encrypted payload structure' })
  }

  const ivB64 = parts[1]!
  const tagB64 = parts[2]!
  const ctB64 = parts[3]!

  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  const ciphertext = Buffer.from(ctB64, 'base64url')

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw validationError({ payload: 'Invalid IV or Auth Tag length in encrypted payload' })
  }

  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch (cause) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      httpStatus: 400,
      message: 'Failed to decrypt secret: corrupted or invalid payload',
      cause,
    })
  }
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}
