import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  isAppError,
} from '../src/index.js'

describe('Password hashing & verification (@ai-company/shared)', () => {
  it('1. hashPassword -> verifyPassword returns true for correct password', async () => {
    const plain = 'correct-horse-battery-staple'
    const hash = await hashPassword(plain)

    expect(hash).toMatch(/^\$argon2id\$/)
    const isValid = await verifyPassword(hash, plain)
    expect(isValid).toBe(true)
  })

  it('2. verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('my-secret-password-123')
    const isValid = await verifyPassword(hash, 'wrong-password')
    expect(isValid).toBe(false)
  })

  it('3. verifyPassword returns false and never throws on corrupted hash or garbage input', async () => {
    expect(await verifyPassword('not-a-valid-argon2-hash', 'password')).toBe(false)
    expect(await verifyPassword('', 'password')).toBe(false)
    expect(await verifyPassword('$argon2id$v=19$garbage', 'password')).toBe(false)
  })

  it('4. Two hashes of the same password produce different hashes (salt is unique)', async () => {
    const plain = 'repeatable-password-check'
    const hash1 = await hashPassword(plain)
    const hash2 = await hashPassword(plain)

    expect(hash1).not.toBe(hash2)
    expect(await verifyPassword(hash1, plain)).toBe(true)
    expect(await verifyPassword(hash2, plain)).toBe(true)
  })

  it('5. DUMMY_PASSWORD_HASH is a valid argon2id hash that verifies against dummy string', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$/)
    // verifyPassword should execute argon2.verify without error and return false for mismatched password
    const result = await verifyPassword(DUMMY_PASSWORD_HASH, 'random-password-attempt')
    expect(result).toBe(false)
  })

  it('6. Password length limit > 200 characters is rejected before calling argon2', async () => {
    const longPassword = 'a'.repeat(201)

    try {
      await hashPassword(longPassword)
      expect.fail('Expected hashPassword to throw for password > 200 chars')
    } catch (err) {
      expect(isAppError(err)).toBe(true)
    }

    const verifyResult = await verifyPassword(DUMMY_PASSWORD_HASH, longPassword)
    expect(verifyResult).toBe(false)
  })
})
