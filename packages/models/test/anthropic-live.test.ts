import { describe, expect, it } from 'vitest'
import { env } from '@ai-company/shared'
import { createAnthropicProvider } from '../src/index.js'
import type { ModelInput } from '../src/types.js'

const isLiveEnabled = Boolean(
  env.RUN_LIVE_MODEL_TESTS === 'true' && env.ANTHROPIC_API_KEY,
)

describe.skipIf(!isLiveEnabled)('AnthropicProvider Live Smoke Tests', () => {
  const apiKey = env.ANTHROPIC_API_KEY || ''
  const provider = createAnthropicProvider({
    apiKey,
    maxRetries: 0,
  })

  it('1. Short prompt returns non-empty text response with token usage', async () => {
    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Say "Hello, world!" and nothing else.' }],
        },
      ],
      maxOutputTokens: 50,
    }

    const res = await provider.generate(input)
    expect(res.content.length).toBeGreaterThan(0)
    expect(res.content[0]?.type).toBe('text')
    expect(res.usage.inputTokens).toBeGreaterThan(0)
    expect(res.usage.outputTokens).toBeGreaterThan(0)
  })

  it('2. Prompt with tool definition returns tool_use block', async () => {
    const input: ModelInput = {
      provider: 'anthropic',
      modelKey: 'claude-3-5-haiku-20241022',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'What is 15 + 27? Use the calculator tool.' }],
        },
      ],
      tools: [
        {
          name: 'calculator',
          description: 'Performs arithmetic calculation',
          inputSchema: {
            type: 'object',
            properties: {
              expression: { type: 'string' },
            },
            required: ['expression'],
          },
        },
      ],
      toolChoice: { name: 'calculator' },
      maxOutputTokens: 100,
    }

    const res = await provider.generate(input)
    const toolUse = res.content.find((c) => c.type === 'tool_use')
    expect(toolUse).toBeDefined()
    if (toolUse && toolUse.type === 'tool_use') {
      expect(toolUse.name).toBe('calculator')
      expect(toolUse.input).toBeDefined()
    }
  })
})
