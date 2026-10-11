import { describe, expect, it } from 'vitest'
import { AppError, decryptSecret, encryptSecret, sha256Hex } from '../src/index.js'

describe('crypto', () => {
  it('encrypt -> decrypt round-trip returns original string', () => {
    const plain = 'super-secret-api-key-12345!@#$%^&*()'
    const encrypted = encryptSecret(plain)
    const decrypted = decryptSecret(encrypted)
    expect(decrypted).toBe(plain)
  })

  it('two encrypt calls on identical text return DIFFERENT ciphertexts due to random IV', () => {
    const plain = 'same-plain-text'
    const enc1 = encryptSecret(plain)
    const enc2 = encryptSecret(plain)
    expect(enc1).not.toBe(enc2)
    expect(decryptSecret(enc1)).toBe(plain)
    expect(decryptSecret(enc2)).toBe(plain)
  })

  it('tampering with a single byte in ciphertext throws AppError', () => {
    const plain = 'secret-data'
    const encrypted = encryptSecret(plain)
    const parts = encrypted.split(':')

    // Tamper with actual bytes of the ciphertext
    const ctBuf = Buffer.from(parts[3]!, 'base64url')
    ctBuf[0] = ctBuf[0]! ^ 0xff
    const tamperedCt = ctBuf.toString('base64url')
    const tamperedPayload = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCt}`

    expect(() => decryptSecret(tamperedPayload)).toThrowError(AppError)
  })

  it('payload without "v1:" prefix throws AppError', () => {
    const plain = 'secret-data'
    const encrypted = encryptSecret(plain)
    const invalidPrefix = encrypted.replace(/^v1:/, 'v2:')
    expect(() => decryptSecret(invalidPrefix)).toThrowError(AppError)
  })

  it('sha256Hex computes correct SHA-256 hash', () => {
    expect(sha256Hex('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })
})
