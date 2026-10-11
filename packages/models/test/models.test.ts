import { describe, expect, it, beforeAll, beforeEach } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'
import { z } from 'zod'
import {
  createFixedClock,
  realIdGenerator,
  rootLogger,
  Usd,
  env,
  type RequestContext,
  type Logger,
} from '@ai-company/shared'
import {
  createDatabase,
  createRepositories,
  seedModelCatalog,
  models,
  organizations,
} from '@ai-company/db'
import {
  computeCost,
  assertPricingUsable,
  withRetry,
  ProviderError,
  executeModelCall,
  createProviderRegistry,
  createFakeProvider,
  generateStructuredOutput,
  type ModelInput,
  type ModelOutput,
  type ModelEvent,
} from '../src/index.js'
import { isDatabaseReachable, truncateAll } from './helpers/db.js'

describe('AI Company OS - Step 7: Packages/Models Core', () => {
  let dbAvailable = false
  const db = createDatabase()

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable()
  })

  beforeEach(async () => {
    if (dbAvailable) {
      await truncateAll(db)
      await seedModelCatalog(db)
      await db.update(models).set({ pricingVerified: true })
    }
  })

  // ==========================================
  // Test 1: Конвертация канонического формата
  // ==========================================
  it('1. Roundtrip canonical message format preserves text, tool_use, and tool_result parts without data loss', async () => {
    const fake = createFakeProvider([
      {
        type: 'output',
        output: {
          content: [
            { type: 'text', text: 'I will calculate that for you.' },
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'calculator',
              input: { expression: '2 + 2' },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 50, outputTokens: 25, cachedInputTokens: 0 },
        },
      },
    ])

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      system: 'You are a helpful assistant.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Calculate 2+2' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_prev',
              name: 'calculator',
              input: { expression: '1 + 1' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'call_prev',
              content: '2',
              isError: false,
            },
          ],
        },
      ],
      maxOutputTokens: 1024,
    }

    const output = await fake.generate(input)
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.messages).toHaveLength(3)
    expect(fake.calls[0]?.system).toBe('You are a helpful assistant.')
    expect(output.content).toHaveLength(2)
    expect(output.content[0]).toEqual({
      type: 'text',
      text: 'I will calculate that for you.',
    })
    expect(output.content[1]).toEqual({
      type: 'tool_use',
      id: 'call_123',
      name: 'calculator',
      input: { expression: '2 + 2' },
    })
  })

  // ==========================================
  // Test 2: computeCost
  // ==========================================
  it('2. computeCost: 1M tokens at 3.00 gives exactly 3.000000; rounding up on 1 token; cached tokens pricing; negative uncached throws', () => {
    const pricing = {
      inputPerMillion: '3.000000',
      outputPerMillion: '15.000000',
      cachedInputPerMillion: '0.300000',
      pricingVerified: true,
    }

    // 1M input tokens
    const cost1M = computeCost(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0 },
      pricing,
    )
    expect(cost1M.toString()).toBe('3.000000')

    // 1 token at 3.00/M is 3 micro-USD (0.000003)
    const cost1Token = computeCost(
      { inputTokens: 1, outputTokens: 0, cachedInputTokens: 0 },
      pricing,
    )
    expect(cost1Token.toString()).toBe('0.000003')

    // 1 token at 0.50/M is 0.5 micro-USD -> rounds up to 1 micro-USD (0.000001)
    const pricingFractional = {
      ...pricing,
      inputPerMillion: '0.500000',
    }
    const costFractional = computeCost(
      { inputTokens: 1, outputTokens: 0, cachedInputTokens: 0 },
      pricingFractional,
    )
    expect(costFractional.toString()).toBe('0.000001')

    // Cached input tokens at 0.30/M
    const costCached = computeCost(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 },
      pricing,
    )
    expect(costCached.toString()).toBe('0.300000')

    // Mixed input: 500k cached + 500k uncached
    const costMixed = computeCost(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 },
      pricing,
    )
    // 500k * 3.00 = 1.50, 500k * 0.30 = 0.15 => 1.650000
    expect(costMixed.toString()).toBe('1.650000')

    // cachedInputPerMillion = null falls back to normal inputPerMillion
    const pricingNoCache = {
      ...pricing,
      cachedInputPerMillion: null,
    }
    const costNullCached = computeCost(
      { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 },
      pricingNoCache,
    )
    expect(costNullCached.toString()).toBe('3.000000')

    // cachedInputTokens > inputTokens throws error
    expect(() =>
      computeCost(
        { inputTokens: 100, outputTokens: 0, cachedInputTokens: 200 },
        pricing,
      ),
    ).toThrow()
  })

  // ==========================================
  // Test 3: assertPricingUsable
  // ==========================================
  it('3. assertPricingUsable: pricingVerified = false throws unless ALLOW_UNVERIFIED_MODEL_PRICING is true', () => {
    const unverifiedPricing = {
      inputPerMillion: '999.000000',
      outputPerMillion: '999.000000',
      cachedInputPerMillion: null,
      pricingVerified: false,
    }

    const verifiedPricing = {
      ...unverifiedPricing,
      pricingVerified: true,
    }

    // Verified passes
    expect(() => assertPricingUsable(verifiedPricing, 'claude-sonnet-5')).not.toThrow()

    // Unverified throws when flag is false
    const originalFlag = env.ALLOW_UNVERIFIED_MODEL_PRICING
    env.ALLOW_UNVERIFIED_MODEL_PRICING = false
    try {
      expect(() => assertPricingUsable(unverifiedPricing, 'unverified-model')).toThrow()

      // When flag is true, unverified passes
      env.ALLOW_UNVERIFIED_MODEL_PRICING = true
      expect(() => assertPricingUsable(unverifiedPricing, 'unverified-model')).not.toThrow()
    } finally {
      env.ALLOW_UNVERIFIED_MODEL_PRICING = originalFlag
    }
  })

  // ==========================================
  // Test 4: withRetry
  // ==========================================
  it('4. withRetry: retries only retryable errors, maxAttempts limit, retryAfterMs priority, deterministic jitter with injected random', async () => {
    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const sleepDelays: number[] = []
    const sleep = async (ms: number) => {
      sleepDelays.push(ms)
      clock.advance(ms)
    }

    // 1. Successful on 3rd attempt with exponential delay and deterministic jitter
    let callCount = 0
    const result = await withRetry(
      async () => {
        callCount++
        if (callCount < 3) {
          throw new ProviderError({
            kind: 'rate_limit',
            provider: 'anthropic',
            message: 'Rate limit exceeded',
          })
        }
        return 'success'
      },
      { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 20000, jitter: true },
      {
        clock,
        sleep,
        logger: rootLogger,
        random: () => 0.5, // Deterministic: 50% of expDelay
      },
    )

    expect(result).toBe('success')
    expect(callCount).toBe(3)
    // Attempt 1 -> expDelay = 500ms -> with jitter 0.5 = 250ms
    // Attempt 2 -> expDelay = 1000ms -> with jitter 0.5 = 500ms
    expect(sleepDelays).toEqual([250, 500])

    // 2. retryAfterMs has priority over calculated delay
    sleepDelays.length = 0
    let retryAfterCalls = 0
    await withRetry(
      async () => {
        retryAfterCalls++
        if (retryAfterCalls === 1) {
          throw new ProviderError({
            kind: 'rate_limit',
            provider: 'anthropic',
            message: 'Rate limited with header',
            retryAfterMs: 1500,
          })
        }
        return 'ok'
      },
      { maxAttempts: 3 },
      { clock, sleep, logger: rootLogger },
    )
    expect(sleepDelays).toEqual([1500])

    // 3. Exhausting maxAttempts throws last error
    let exhaustCalls = 0
    await expect(
      withRetry(
        async () => {
          exhaustCalls++
          throw new ProviderError({
            kind: 'overloaded',
            provider: 'anthropic',
            message: 'Server overloaded',
          })
        },
        { maxAttempts: 2 },
        { clock, sleep, logger: rootLogger },
      ),
    ).rejects.toThrow('Server overloaded')
    expect(exhaustCalls).toBe(2)
  })

  // ==========================================
  // Test 5: Non-retryable errors
  // ==========================================
  it('5. auth and invalid_request are NOT retried — exactly 1 attempt is made', async () => {
    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    let sleepCount = 0
    const sleep = async () => {
      sleepCount++
    }

    let authCalls = 0
    await expect(
      withRetry(
        async () => {
          authCalls++
          throw new ProviderError({
            kind: 'auth',
            provider: 'openai',
            message: 'Invalid API key',
          })
        },
        { maxAttempts: 3 },
        { clock, sleep, logger: rootLogger },
      ),
    ).rejects.toThrow('Invalid API key')
    expect(authCalls).toBe(1)
    expect(sleepCount).toBe(0)

    let invalidReqCalls = 0
    await expect(
      withRetry(
        async () => {
          invalidReqCalls++
          throw new ProviderError({
            kind: 'invalid_request',
            provider: 'google',
            message: 'Bad parameters',
          })
        },
        { maxAttempts: 3 },
        { clock, sleep, logger: rootLogger },
      ),
    ).rejects.toThrow('Bad parameters')
    expect(invalidReqCalls).toBe(1)
    expect(sleepCount).toBe(0)
  })

  // ==========================================
  // Test 6: Таймаут
  // ==========================================
  it('6. Timeout: provider that never resolves is aborted after timeoutMs with ProviderError kind timeout and triggered AbortSignal', async () => {
    let receivedSignal: AbortSignal | undefined

    const hangingProvider = {
      name: 'anthropic' as const,
      async generate(_input: ModelInput, signal?: AbortSignal): Promise<ModelOutput> {
        receivedSignal = signal
        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(
              new ProviderError({
                kind: 'timeout',
                provider: 'anthropic',
                message: 'Request timed out',
              }),
            )
          })
        })
      },
      async *stream(): AsyncIterable<ModelEvent> {},
      async countInputTokens() {
        return 10
      },
    }

    const registry = createProviderRegistry()
    registry.register(hangingProvider)

    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const ctx: RequestContext = {
      requestId: 'req-timeout',
      userId: 'user-1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      maxOutputTokens: 1000,
      timeoutMs: 50,
    }

    await expect(
      executeModelCall(
        ctx,
        input,
        {
          registry,
          repos,
          clock,
          ids: realIdGenerator,
          logger: rootLogger,
          sleep: async () => {},
          random: () => 0.5,
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toThrow()

    expect(receivedSignal?.aborted).toBe(true)
  })

  // ==========================================
  // Test 7: executeModelCall success log
  // ==========================================
  it('7. executeModelCall writes row to model_invocations on success with tokens, cost, and status=success', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()

    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    // Create an organization in DB
    const orgId = realIdGenerator.next()
    await db.insert(organizations).values({
      id: orgId,
      name: 'Models Test Org',
      slug: `models-org-${Date.now()}`,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })

    const ctx: RequestContext = {
      requestId: 'req-success-1',
      userId: 'user-1',
      orgId,
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const fake = createFakeProvider([
      {
        type: 'output',
        output: {
          content: [{ type: 'text', text: 'Hello world' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 200 },
        },
      },
    ])

    const registry = createProviderRegistry()
    registry.register(fake)

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 2000,
    }

    const res = await executeModelCall(ctx, input, {
      registry,
      repos,
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
      sleep: async () => {},
      random: () => 0.5,
    })

    expect(res.cost.gt(Usd.zero())).toBe(true)

    const invocations = await repos.modelInvocations.list(ctx)
    expect(invocations.items).toHaveLength(1)
    const inv = invocations.items[0]!
    expect(inv.status).toBe('success')
    expect(inv.provider).toBe('anthropic')
    expect(inv.modelKey).toBe('claude-sonnet-5')
    expect(inv.inputTokens).toBe(1000)
    expect(inv.outputTokens).toBe(500)
    expect(inv.cachedInputTokens).toBe(200)
    expect(inv.stopReason).toBe('end_turn')
    expect(inv.errorKind).toBeNull()
    expect(inv.attempt).toBe(1)
  })

  // ==========================================
  // Test 8: executeModelCall error logs across 3 attempts
  // ==========================================
  it('8. executeModelCall writes row on error with status=error and error_kind; 3 failed attempts produce exactly 3 rows with attempt 1, 2, 3', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()

    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const orgId = realIdGenerator.next()
    await db.insert(organizations).values({
      id: orgId,
      name: 'Error Logs Org',
      slug: `error-org-${Date.now()}`,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })

    const ctx: RequestContext = {
      requestId: 'req-err-3',
      userId: 'user-1',
      orgId,
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const fake = createFakeProvider([
      {
        type: 'error',
        error: new ProviderError({
          kind: 'overloaded',
          provider: 'anthropic',
          message: 'Capacity full',
        }),
      },
      {
        type: 'error',
        error: new ProviderError({
          kind: 'overloaded',
          provider: 'anthropic',
          message: 'Capacity full',
        }),
      },
      {
        type: 'error',
        error: new ProviderError({
          kind: 'overloaded',
          provider: 'anthropic',
          message: 'Capacity full',
        }),
      },
    ])

    const registry = createProviderRegistry()
    registry.register(fake)

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 1000,
    }

    await expect(
      executeModelCall(
        ctx,
        input,
        {
          registry,
          repos,
          clock,
          ids: realIdGenerator,
          logger: rootLogger,
          sleep: async () => {},
          random: () => 0.5,
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toThrow('Capacity full')

    const invocations = await repos.modelInvocations.list(ctx)
    expect(invocations.items).toHaveLength(3)

    // Items are ordered by created_at desc, so sort by attempt ascending
    const sorted = [...invocations.items].sort((a, b) => a.attempt - b.attempt)
    expect(sorted.map((i) => i.attempt)).toEqual([1, 2, 3])
    for (const inv of sorted) {
      expect(inv.status).toBe('error')
      expect(inv.errorKind).toBe('overloaded')
      expect(inv.modelKey).toBe('claude-sonnet-5')
    }
  })

  // ==========================================
  // Test 9: maxOutputTokens validation before provider
  // ==========================================
  it('9. maxOutputTokens exceeds model limit -> error BEFORE calling provider (provider.calls.length === 0)', async () => {
    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const fake = createFakeProvider([])
    const registry = createProviderRegistry()
    registry.register(fake)

    const ctx: RequestContext = {
      requestId: 'req-limit',
      userId: 'user-1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5', // maxOutputTokens is 8192 in catalog
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 999999, // Exceeds limit
    }

    await expect(
      executeModelCall(ctx, input, {
        registry,
        repos,
        clock,
        ids: realIdGenerator,
        logger: rootLogger,
        sleep: async () => {},
        random: () => 0.5,
      }),
    ).rejects.toThrow()

    expect(fake.calls).toHaveLength(0)
  })

  // ==========================================
  // Test 10: tools when supports_tools = false
  // ==========================================
  it('10. tools passed to model with supports_tools = false -> error before calling provider', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()

    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    // Create a model in catalog with supportsTools = false
    const modelId = realIdGenerator.next()
    await db.insert(models).values({
      id: modelId,
      provider: 'openai',
      modelKey: 'test-no-tools',
      displayName: 'No Tools Model',
      tier: 'cheap',
      contextWindow: 4096,
      maxOutputTokens: 2048,
      supportsTools: false,
      supportsStreaming: true,
      supportsVision: false,
      inputPricePerMillion: '1.000000',
      outputPricePerMillion: '2.000000',
      pricingVerified: true,
      status: 'active',
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })

    const fake = createFakeProvider([], 'openai')
    const registry = createProviderRegistry()
    registry.register(fake)

    const ctx: RequestContext = {
      requestId: 'req-tools-no',
      userId: 'user-1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const input: ModelInput = {
      provider: 'openai',
      modelKey: 'test-no-tools',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 1000,
      tools: [
        {
          name: 'test_tool',
          description: 'A tool',
          inputSchema: { type: 'object' },
        },
      ],
    }

    await expect(
      executeModelCall(ctx, input, {
        registry,
        repos,
        clock,
        ids: realIdGenerator,
        logger: rootLogger,
        sleep: async () => {},
        random: () => 0.5,
      }),
    ).rejects.toThrow('does not support tools')

    expect(fake.calls).toHaveLength(0)
  })

  // ==========================================
  // Test 11: deprecated model rejection
  // ==========================================
  it('11. Deprecated model -> error before calling provider', async ({ skip }) => {
    if (!dbAvailable) skip()

    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    // Create a deprecated model
    const modelId = realIdGenerator.next()
    await db.insert(models).values({
      id: modelId,
      provider: 'openai',
      modelKey: 'test-deprecated',
      displayName: 'Old Deprecated Model',
      tier: 'cheap',
      contextWindow: 4096,
      maxOutputTokens: 2048,
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: false,
      inputPricePerMillion: '1.000000',
      outputPricePerMillion: '2.000000',
      pricingVerified: true,
      status: 'deprecated',
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })

    const fake = createFakeProvider([], 'openai')
    const registry = createProviderRegistry()
    registry.register(fake)

    const ctx: RequestContext = {
      requestId: 'req-deprecated',
      userId: 'user-1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const input: ModelInput = {
      provider: 'openai',
      modelKey: 'test-deprecated',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 1000,
    }

    await expect(
      executeModelCall(ctx, input, {
        registry,
        repos,
        clock,
        ids: realIdGenerator,
        logger: rootLogger,
        sleep: async () => {},
        random: () => 0.5,
      }),
    ).rejects.toThrow('deprecated')

    expect(fake.calls).toHaveLength(0)
  })

  // ==========================================
  // Test 12: structuredOutput
  // ==========================================
  it('12. structuredOutput: valid response parsed by zod schema; invalid schema gives clear error and is NOT silently retried', async () => {
    const userSchema = z.object({
      name: z.string(),
      age: z.number().int().positive(),
    })

    // 1. Valid output
    const fakeValid = createFakeProvider([
      {
        type: 'output',
        output: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'extract_user',
              input: { name: 'Alice', age: 30 },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 50, outputTokens: 20, cachedInputTokens: 0 },
        },
      },
    ])

    const res = await generateStructuredOutput(fakeValid, {
      name: 'extract_user',
      schema: userSchema,
      input: {
        provider: 'anthropic',
        modelKey: 'claude-sonnet-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Alice is 30' }] }],
        maxOutputTokens: 500,
      },
    })

    expect(res.data).toEqual({ name: 'Alice', age: 30 })

    // 2. Invalid schema (age is string instead of number)
    const fakeInvalid = createFakeProvider([
      {
        type: 'output',
        output: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_2',
              name: 'extract_user',
              input: { name: 'Bob', age: 'not-a-number' as unknown as number },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 50, outputTokens: 20, cachedInputTokens: 0 },
        },
      },
    ])

    await expect(
      generateStructuredOutput(fakeInvalid, {
        name: 'extract_user',
        schema: userSchema,
        input: {
          provider: 'anthropic',
          modelKey: 'claude-sonnet-5',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Bob' }] }],
          maxOutputTokens: 500,
        },
      }),
    ).rejects.toThrow('Structured output validation failed')
  })

  // ==========================================
  // Test 13: Streaming from FakeProvider
  // ==========================================
  it('13. FakeProvider streaming yields text_delta* -> usage -> done; reconstructed text matches generate', async () => {
    const fake = createFakeProvider([
      {
        type: 'output',
        output: {
          content: [{ type: 'text', text: 'Hello, this is a 32-character msg.' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 15, outputTokens: 8, cachedInputTokens: 0 },
        },
      },
    ])

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 100,
    }

    const events = []
    let collectedText = ''
    for await (const event of fake.stream(input)) {
      events.push(event)
      if (event.type === 'text_delta') {
        collectedText += event.text
      }
    }

    expect(collectedText).toBe('Hello, this is a 32-character msg.')

    // Event order: text_deltas first, then usage, then done
    const types = events.map((e) => e.type)
    const usageIdx = types.indexOf('usage')
    const doneIdx = types.indexOf('done')

    expect(usageIdx).toBeGreaterThan(0)
    expect(doneIdx).toBe(types.length - 1)
    expect(types.slice(0, usageIdx).every((t) => t === 'text_delta')).toBe(true)
  })

  // ==========================================
  // Test 14: Tenant Isolation on model_invocations
  // ==========================================
  it('14. Tenant isolation for model_invocations: Org B cannot see Org A invocations', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()

    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const orgAId = realIdGenerator.next()
    const orgBId = realIdGenerator.next()

    await db.insert(organizations).values([
      {
        id: orgAId,
        name: 'Org A',
        slug: `org-a-${Date.now()}`,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
      {
        id: orgBId,
        name: 'Org B',
        slug: `org-b-${Date.now()}`,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
    ])

    const ctxA: RequestContext = {
      requestId: 'req-a',
      userId: 'user-a',
      orgId: orgAId,
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    const ctxB: RequestContext = {
      requestId: 'req-b',
      userId: 'user-b',
      orgId: orgBId,
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
    }

    // Append invocation in Org A
    await repos.modelInvocations.append(ctxA, {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      requestId: 'req-a-call',
      inputTokens: 100,
      outputTokens: 50,
      status: 'success',
    })

    // Query from Org A
    const pageA = await repos.modelInvocations.list(ctxA)
    expect(pageA.items).toHaveLength(1)

    // Query from Org B -> returns empty
    const pageB = await repos.modelInvocations.list(ctxB)
    expect(pageB.items).toHaveLength(0)

    // sumCostForPeriod from Org B -> returns zero
    const sumB = await repos.modelInvocations.sumCostForPeriod(ctxB, {
      fromCreatedAt: new Date('2026-01-01'),
      toCreatedAt: new Date('2026-12-31'),
    })
    expect(sumB.toString()).toBe('0.000000')
  })

  // ==========================================
  // Test 15: Prompt text is NEVER leaked in errors or logs
  // ==========================================
  it('15. Security: Neither error messages nor intercepted logs contain prompt text', async () => {
    const clock = createFixedClock(new Date('2026-08-25T12:00:00Z'))
    const loggedMessages: string[] = []
    const logStream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        loggedMessages.push(chunk.toString())
        callback()
      },
    })
    const testLogger: Logger = pino({ level: 'trace' }, logStream)

    const SECRET_PROMPT_MARKER = 'SUPER_SECRET_PROMPT_PAYLOAD_XYZ_98765'

    const fake = createFakeProvider([
      {
        type: 'error',
        error: new ProviderError({
          kind: 'invalid_request',
          provider: 'anthropic',
          message: 'Invalid payload structure',
        }),
      },
    ])

    const registry = createProviderRegistry()
    registry.register(fake)
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const ctx: RequestContext = {
      requestId: 'req-secret-prompt',
      userId: 'user-1',
      orgId: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      clock,
      ids: realIdGenerator,
      logger: testLogger,
    }

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-sonnet-5',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Please process this: ${SECRET_PROMPT_MARKER}` }],
        },
      ],
      maxOutputTokens: 1000,
    }

    let caughtError: Error | null = null
    try {
      await executeModelCall(ctx, input, {
        registry,
        repos,
        clock,
        ids: realIdGenerator,
        logger: testLogger,
        sleep: async () => {},
        random: () => 0.5,
      })
    } catch (err: unknown) {
      caughtError = err as Error
    }

    expect(caughtError).not.toBeNull()
    const errorStr = JSON.stringify(caughtError)
    expect(errorStr.includes(SECRET_PROMPT_MARKER)).toBe(false)

    const allLogs = loggedMessages.join(' ')
    expect(allLogs.includes(SECRET_PROMPT_MARKER)).toBe(false)
  })
})
