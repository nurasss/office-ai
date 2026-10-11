import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'
import {
  createFixedClock,
  realIdGenerator,
  rootLogger,
  type RequestContext,
  type Logger,
} from '@ai-company/shared'
import {
  createDatabase,
  createRepositories,
  seedModelCatalog,
  models,
} from '@ai-company/db'
import {
  createAnthropicProvider,
  createProviderRegistry,
  executeModelCall,
  computeCost,
  ProviderError,
  type ModelInput,
} from '../src/index.js'
import { createMockServer, type MockServer } from './helpers/mock-server.js'
import { isDatabaseReachable, truncateAll } from './helpers/db.js'

describe('AI Company OS - Step 8: AnthropicProvider', () => {
  let mockServer: MockServer
  let dbAvailable = false
  const db = createDatabase()

  beforeAll(async () => {
    mockServer = await createMockServer()
    dbAvailable = await isDatabaseReachable()
  })

  afterAll(async () => {
    if (mockServer) {
      await mockServer.close()
    }
  })

  beforeEach(async () => {
    mockServer.resetRequests()
    if (dbAvailable) {
      await truncateAll(db)
      await seedModelCatalog(db)
      await db.update(models).set({ pricingVerified: true })
    }
  })

  // ==========================================
  // Part C: Преобразование запроса (1 - 6)
  // ==========================================

  it('1. system sends as top-level field, not as a message with role system', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Hi!' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      system: 'You are an AI assistant specialized in coding.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      maxOutputTokens: 100,
    }

    const output = await provider.generate(input)
    expect(output.content[0]?.type).toBe('text')

    const lastReq = mockServer.getLastRequest()
    expect(lastReq).not.toBeNull()
    expect(lastReq?.body?.['system']).toBe('You are an AI assistant specialized in coding.')

    const msgs = lastReq?.body?.['messages'] as Array<{ role: string; content: unknown }>
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.role).toBe('user')
    expect(msgs.some((m) => m.role === 'system')).toBe(false)
  })

  it('2. text, tool_use and tool_result map to correct blocks; tool_result has role user', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'The result is 4.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 8 },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Compute 2 + 2' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool_call_abc',
              name: 'calculator',
              input: { expr: '2+2' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tool_call_abc',
              content: '4',
              isError: false,
            },
          ],
        },
      ],
      maxOutputTokens: 200,
    }

    await provider.generate(input)

    const lastReq = mockServer.getLastRequest()
    const msgs = lastReq?.body?.['messages'] as Array<{ role: string; content: unknown[] }>
    expect(msgs).toHaveLength(3)

    expect(msgs[0]?.role).toBe('user')
    expect(msgs[0]?.content[0]).toEqual({ type: 'text', text: 'Compute 2 + 2' })

    expect(msgs[1]?.role).toBe('assistant')
    expect(msgs[1]?.content[0]).toEqual({
      type: 'tool_use',
      id: 'tool_call_abc',
      name: 'calculator',
      input: { expr: '2+2' },
    })

    expect(msgs[2]?.role).toBe('user')
    expect(msgs[2]?.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tool_call_abc',
      content: '4',
      is_error: false,
    })
  })

  it('3. All 4 toolChoice options produce correct Anthropic tool_choice payload', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_3',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const baseInput: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: { type: 'object', properties: { loc: { type: 'string' } } },
        },
      ],
      maxOutputTokens: 50,
    }

    // 1. auto
    await provider.generate({ ...baseInput, toolChoice: 'auto' })
    expect(mockServer.getLastRequest()?.body?.['tool_choice']).toEqual({ type: 'auto' })

    // 2. none
    await provider.generate({ ...baseInput, toolChoice: 'none' })
    expect(mockServer.getLastRequest()?.body?.['tool_choice']).toEqual({ type: 'none' })

    // 3. required
    await provider.generate({ ...baseInput, toolChoice: 'required' })
    expect(mockServer.getLastRequest()?.body?.['tool_choice']).toEqual({ type: 'any' })

    // 4. specific tool
    await provider.generate({ ...baseInput, toolChoice: { name: 'get_weather' } })
    expect(mockServer.getLastRequest()?.body?.['tool_choice']).toEqual({
      type: 'tool',
      name: 'get_weather',
    })
  })

  it('4. Empty messages or empty message content throws invalid_request without network call', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    await expect(
      provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [],
        maxOutputTokens: 50,
      }),
    ).rejects.toThrowError(ProviderError)

    await expect(
      provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: [] }],
        maxOutputTokens: 50,
      }),
    ).rejects.toThrowError(ProviderError)

    expect(mockServer.getRequestCount()).toBe(0)
  })

  it('5. Consecutive messages with same role throw invalid_request, no automatic merging', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first user message' }] },
        { role: 'user', content: [{ type: 'text', text: 'second user message immediately' }] },
      ],
      maxOutputTokens: 50,
    }

    try {
      await provider.generate(input)
      expect.unreachable('Should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).kind).toBe('invalid_request')
    }

    expect(mockServer.getRequestCount()).toBe(0)
  })

  it('6. tool_result without matching tool_use in preceding assistant message throws invalid_request', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    // tool_result as first message
    await expect(
      provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: 'orphan_id', content: '123', isError: false }],
          },
        ],
        maxOutputTokens: 50,
      }),
    ).rejects.toThrowError(ProviderError)

    // tool_result with mismatched toolUseId
    await expect(
      provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'search', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: 'call_2', content: 'result', isError: false }],
          },
        ],
        maxOutputTokens: 50,
      }),
    ).rejects.toThrowError(ProviderError)

    expect(mockServer.getRequestCount()).toBe(0)
  })

  // ==========================================
  // Part C: Преобразование ответа (7 - 12)
  // ==========================================

  it('7. Text-only response maps to single text block and stopReason end_turn', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_7',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Only text returned' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 15, output_tokens: 6 },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const output = await provider.generate({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      maxOutputTokens: 50,
    })

    expect(output.content).toEqual([{ type: 'text', text: 'Only text returned' }])
    expect(output.stopReason).toBe('end_turn')
    expect(output.usage.inputTokens).toBe(15)
    expect(output.usage.outputTokens).toBe(6)
  })

  it('8. tool_use response maps id, name, and parsed input object', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_8',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'fetch_weather',
              input: { location: 'San Francisco', unit: 'celsius' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 25, output_tokens: 18 },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const output = await provider.generate({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Weather in SF?' }] }],
      maxOutputTokens: 50,
    })

    expect(output.stopReason).toBe('tool_use')
    expect(output.content).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'fetch_weather',
        input: { location: 'San Francisco', unit: 'celsius' },
      },
    ])
  })

  it('9. max_tokens stop_reason is mapped to max_tokens', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_9',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Truncated output...' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 10, output_tokens: 50 },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const output = await provider.generate({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Write a long essay' }] }],
      maxOutputTokens: 50,
    })

    expect(output.stopReason).toBe('max_tokens')
  })

  it('10. Unknown stop_reason defaults to end_turn and logs a warning', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_10',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Unknown stop reason' }],
          stop_reason: 'future_unseen_reason',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
    })

    const loggedWarnings: string[] = []
    const logStream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        loggedWarnings.push(chunk.toString())
        callback()
      },
    })
    const logger: Logger = pino({ level: 'trace' }, logStream)

    const provider = createAnthropicProvider(
      {
        apiKey: 'test-api-key',
        baseUrl: mockServer.baseUrl,
        maxRetries: 0,
      },
      logger,
    )

    const output = await provider.generate({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      maxOutputTokens: 50,
    })

    expect(output.stopReason).toBe('end_turn')
    const combinedLog = loggedWarnings.join(' ')
    expect(combinedLog).toContain('future_unseen_reason')
  })

  it('11. Tokens: input_tokens: 100, cache_read_input_tokens: 40 give inputTokens: 140, cachedInputTokens: 40; computeCost is accurate', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_11',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Cached tokens test' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 40,
          },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const output = await provider.generate({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 50,
    })

    expect(output.usage.inputTokens).toBe(140)
    expect(output.usage.cachedInputTokens).toBe(40)
    expect(output.usage.outputTokens).toBe(50)

    // Verify cost math:
    // model pricing: input $1.00/M, cachedInput $0.10/M, output $5.00/M
    const cost = computeCost(output.usage, {
      inputPerMillion: '1.000000',
      cachedInputPerMillion: '0.100000',
      outputPerMillion: '5.000000',
      pricingVerified: true,
    })
    // Uncached: (140 - 40) = 100 tokens @ $1.00/M = $0.000100
    // Cached: 40 tokens @ $0.10/M = $0.000004
    // Output: 50 tokens @ $5.00/M = $0.000250
    // Total = $0.000354
    expect(cost.toString()).toBe('0.000354')
  })

  it('12. cache_creation_input_tokens > 0 throws unknown error (prompt caching not supported yet)', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_12',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Creation tokens test' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
          },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    try {
      await provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        maxOutputTokens: 50,
      })
      expect.unreachable('Should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).kind).toBe('unknown')
      expect((err as ProviderError).message).toContain('prompt caching is not supported yet')
    }
  })

  // ==========================================
  // Part C: Ошибки (13 - 15)
  // ==========================================

  it('13. Error mapping table from B5 is fully covered (1 test per row)', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const testCases: Array<{
      status: number
      body: Record<string, unknown>
      expectedKind: string
    }> = [
      {
        status: 401,
        body: { type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } },
        expectedKind: 'auth',
      },
      {
        status: 403,
        body: { type: 'error', error: { type: 'permission_error', message: 'Forbidden' } },
        expectedKind: 'auth',
      },
      {
        status: 400,
        body: {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'prompt is too long for context' },
        },
        expectedKind: 'context_length',
      },
      {
        status: 400,
        body: { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } },
        expectedKind: 'invalid_request',
      },
      {
        status: 404,
        body: { type: 'error', error: { type: 'not_found_error', message: 'Model not found' } },
        expectedKind: 'invalid_request',
      },
      {
        status: 413,
        body: { type: 'error', error: { type: 'request_too_large', message: 'Payload too large' } },
        expectedKind: 'context_length',
      },
      {
        status: 429,
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
        expectedKind: 'rate_limit',
      },
      {
        status: 500,
        body: { type: 'error', error: { type: 'api_error', message: 'Internal error' } },
        expectedKind: 'server_error',
      },
      {
        status: 502,
        body: { type: 'error', error: { type: 'api_error', message: 'Bad gateway' } },
        expectedKind: 'server_error',
      },
      {
        status: 503,
        body: { type: 'error', error: { type: 'api_error', message: 'Service unavailable' } },
        expectedKind: 'server_error',
      },
      {
        status: 529,
        body: { type: 'error', error: { type: 'overloaded_error', message: 'Anthropic is overloaded' } },
        expectedKind: 'overloaded',
      },
    ]

    for (const tc of testCases) {
      mockServer.setHandler((_req, res) => {
        res.writeHead(tc.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(tc.body))
      })

      try {
        await provider.generate({
          provider: 'anthropic',
          modelKey: 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
          maxOutputTokens: 50,
        })
        expect.unreachable(`Expected error for status ${tc.status}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError)
        expect((err as ProviderError).kind).toBe(tc.expectedKind)
      }
    }
  })

  it('14. 429 with retry-after header maps to retryAfterMs in milliseconds', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'retry-after': '3',
      })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    try {
      await provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        maxOutputTokens: 50,
      })
      expect.unreachable('Should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError)
      const pErr = err as ProviderError
      expect(pErr.kind).toBe('rate_limit')
      expect(pErr.retryAfterMs).toBe(3000)
    }
  })

  it('15. Prompt marker and API key are NEVER present in error text or logs', async () => {
    const PROMPT_MARKER = 'SUPER_SECRET_PAYLOAD_987654321_ANTHROPIC'
    const API_KEY_SECRET = 'sk-ant-api03-SECRET_KEY_NEVER_LEAK_12345'

    mockServer.setHandler((_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Malformed JSON payload from client' },
        }),
      )
    })

    const loggedMessages: string[] = []
    const logStream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
        loggedMessages.push(chunk.toString())
        callback()
      },
    })
    const logger: Logger = pino({ level: 'trace' }, logStream)

    const provider = createAnthropicProvider(
      {
        apiKey: API_KEY_SECRET,
        baseUrl: mockServer.baseUrl,
        maxRetries: 0,
      },
      logger,
    )

    let caughtError: Error | null = null
    try {
      await provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT_MARKER }] }],
        maxOutputTokens: 50,
      })
    } catch (err: unknown) {
      caughtError = err as Error
    }

    expect(caughtError).not.toBeNull()
    const errorJson = JSON.stringify(caughtError)
    expect(errorJson).not.toContain(PROMPT_MARKER)
    expect(errorJson).not.toContain(API_KEY_SECRET)

    const fullLog = loggedMessages.join(' ')
    expect(fullLog).not.toContain(PROMPT_MARKER)
    expect(fullLog).not.toContain(API_KEY_SECRET)
  })

  // ==========================================
  // Part C: Стриминг (16 - 19)
  // ==========================================

  it('16. Text deltas stream correctly assemble into the same text as generate', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      const events = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s1","type":"message","role":"assistant","model":"claude-3-5-haiku-20241022","content":[],"stop_reason":null,"usage":{"input_tokens":12,"output_tokens":1}}}\n\n`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello, "}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"streaming world!"}}\n\n`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":8}}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
      ]

      for (const ev of events) {
        res.write(ev)
      }
      res.end()
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const eventsList = []
    let assembledText = ''
    for await (const event of provider.stream({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 50,
    })) {
      eventsList.push(event)
      if (event.type === 'text_delta') {
        assembledText += event.text
      }
    }

    expect(assembledText).toBe('Hello, streaming world!')
    const doneEvent = eventsList.find((e) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    if (doneEvent && doneEvent.type === 'done') {
      expect(doneEvent.stopReason).toBe('end_turn')
      expect(doneEvent.output.content).toEqual([{ type: 'text', text: 'Hello, streaming world!' }])
      expect(doneEvent.output.usage.inputTokens).toBe(12)
      expect(doneEvent.output.usage.outputTokens).toBe(8)
    }
  })

  it('17. Tool use stream yields tool_use_start -> deltas -> tool_use_end and parses arguments once at the end', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      const events = [
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s2","type":"message","role":"assistant","model":"claude-3-5-haiku-20241022","content":[],"stop_reason":null,"usage":{"input_tokens":20,"output_tokens":1}}}\n\n`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_call_stream_1","name":"lookup_user"}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"user_id\\""}}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":\\"u-12345\\",\\"detail\\":true}"}}\n\n`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":15}}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
      ]

      for (const ev of events) {
        res.write(ev)
      }
      res.end()
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const streamEvents = []
    for await (const event of provider.stream({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'find user' }] }],
      maxOutputTokens: 50,
    })) {
      streamEvents.push(event)
    }

    expect(streamEvents.some((e) => e.type === 'tool_use_start')).toBe(true)
    expect(streamEvents.some((e) => e.type === 'tool_use_delta')).toBe(true)
    expect(streamEvents.some((e) => e.type === 'tool_use_end')).toBe(true)

    const doneEvent = streamEvents.find((e) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    if (doneEvent && doneEvent.type === 'done') {
      expect(doneEvent.stopReason).toBe('tool_use')
      expect(doneEvent.output.content).toEqual([
        {
          type: 'tool_use',
          id: 'tool_call_stream_1',
          name: 'lookup_user',
          input: { user_id: 'u-12345', detail: true },
        },
      ])
    }
  })

  it('18. Premature stream termination before message_stop yields network error event', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      res.write(
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_cut","type":"message","role":"assistant","model":"claude-3-5-haiku-20241022","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n`,
      )
      res.write(
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
      )
      res.write(
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Incomplete..."}}\n\n`,
      )

      // Destroy socket abruptly without message_stop
      res.destroy()
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const receivedEvents = []
    for await (const event of provider.stream({
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      maxOutputTokens: 50,
    })) {
      receivedEvents.push(event)
    }

    const errorEvent = receivedEvents.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    if (errorEvent && errorEvent.type === 'error') {
      expect(errorEvent.error.kind).toBe('network')
    }
  })

  it('19. AbortSignal cleanly aborts the stream generator', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      res.write(
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_abort","type":"message","role":"assistant","model":"claude-3-5-haiku-20241022","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n`,
      )
      res.write(
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
      )
      // Keep stream hanging open
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const controller = new AbortController()
    const receivedEvents = []

    setTimeout(() => {
      controller.abort()
    }, 50)

    for await (const event of provider.stream(
      {
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
        maxOutputTokens: 50,
      },
      controller.signal,
    )) {
      receivedEvents.push(event)
    }

    const errorEvent = receivedEvents.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    if (errorEvent && errorEvent.type === 'error') {
      expect(errorEvent.error.kind).toBe('timeout')
    }
  })

  // ==========================================
  // Part C: Интеграция с executeModelCall (20 - 22)
  // ==========================================

  it('20. executeModelCall with real AnthropicProvider against local server writes row to model_invocations with correct tokens and cost', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()

    mockServer.setHandler((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_20',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5',
          content: [{ type: 'text', text: 'Integration success' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_read_input_tokens: 50,
          },
        }),
      )
    })

    const clock = createFixedClock(new Date('2026-08-26T12:00:00Z'))
    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const registry = createProviderRegistry()
    registry.register(provider)
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const ctx: RequestContext = {
      requestId: 'req-anthropic-integ',
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Integration test' }] }],
      maxOutputTokens: 200,
    }

    const output = await executeModelCall(ctx, input, {
      registry,
      repos,
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
      sleep: async () => {},
      random: () => 0.5,
    })

    expect(output.content[0]?.type).toBe('text')
    expect(output.usage.inputTokens).toBe(250)
    expect(output.usage.cachedInputTokens).toBe(50)
    expect(output.usage.outputTokens).toBe(100)

    const list = await repos.modelInvocations.list(ctx)
    expect(list.items).toHaveLength(1)
    const row = list.items[0]!
    expect(row.status).toBe('success')
    expect(row.provider).toBe('anthropic')
    expect(row.modelKey).toBe('claude-sonnet-5')
    expect(row.inputTokens).toBe(250)
    expect(row.cachedInputTokens).toBe(50)
    expect(row.outputTokens).toBe(100)
    expect(parseFloat(row.costUsd)).toBeGreaterThan(0)
  })

  it('21. 429 from local server triggers retry according to Step 7 policy, creating rows for each attempt in model_invocations', async ({
    skip,
  }) => {
    if (!dbAvailable) skip()

    let attemptCount = 0
    mockServer.setHandler((_req, res) => {
      attemptCount++
      if (attemptCount === 1) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'retry-after': '1',
        })
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'Rate limit on attempt 1' },
          }),
        )
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'msg_21_success',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [{ type: 'text', text: 'Recovered on attempt 2' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 50, output_tokens: 20 },
          }),
        )
      }
    })

    const clock = createFixedClock(new Date('2026-08-26T12:00:00Z'))
    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const registry = createProviderRegistry()
    registry.register(provider)
    const repos = createRepositories(db, { clock, ids: realIdGenerator })

    const ctx: RequestContext = {
      requestId: 'req-retry-429',
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Retry me' }] }],
      maxOutputTokens: 100,
    }

    const output = await executeModelCall(ctx, input, {
      registry,
      repos,
      clock,
      ids: realIdGenerator,
      logger: rootLogger,
      sleep: async () => {},
      random: () => 0.5,
    })

    expect(output.content[0]?.type).toBe('text')
    expect(mockServer.getRequestCount()).toBe(2)

    const list = await repos.modelInvocations.list(ctx)
    expect(list.items).toHaveLength(2)
    // Ordered by createdAt desc: item 0 is attempt 2, item 1 is attempt 1
    const attempt2 = list.items.find((i) => i.attempt === 2)!
    const attempt1 = list.items.find((i) => i.attempt === 1)!

    expect(attempt1.status).toBe('error')
    expect(attempt1.errorKind).toBe('rate_limit')

    expect(attempt2.status).toBe('success')
    expect(attempt2.inputTokens).toBe(50)
  })

  it('22. SDK does NOT perform internal retries: local server returning 500 receives exactly 1 request per call attempt', async () => {
    mockServer.setHandler((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: 'Internal Server Error' },
        }),
      )
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    try {
      await provider.generate({
        provider: 'anthropic',
        modelKey: 'claude-3-5-haiku-20241022',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        maxOutputTokens: 50,
      })
      expect.unreachable('Should fail with 500')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).kind).toBe('server_error')
    }

    // Proves SDK has maxRetries: 0 and made exactly 1 request
    expect(mockServer.getRequestCount()).toBe(1)
  })

  it('23. countInputTokens calls endpoint if available, and falls back to character estimation when 404', async () => {
    // 1. Endpoint available
    mockServer.setHandler((req, res) => {
      if (req.url?.includes('count_tokens')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: 42 }))
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Not found' } }))
      }
    })

    const provider = createAnthropicProvider({
      apiKey: 'test-api-key',
      baseUrl: mockServer.baseUrl,
      maxRetries: 0,
    })

    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Calculate my tokens please' }] }],
      maxOutputTokens: 50,
    }

    const count1 = await provider.countInputTokens(input)
    expect(count1).toBe(42)

    // 2. Endpoint returns 404 -> fallback approximation
    mockServer.setHandler((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Count tokens not found' } }))
    })

    const count2 = await provider.countInputTokens(input)
    // 'Calculate my tokens please' has 26 chars -> ceil(26 / 4) = 7
    expect(count2).toBe(7)
  })
})
