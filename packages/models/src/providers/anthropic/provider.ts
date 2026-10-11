import Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '@ai-company/shared'
import type { ModelInput, ModelOutput } from '../../types.js'
import type { ModelEvent, ModelProvider } from '../../provider.js'
import type { AnthropicProviderConfig } from './types.js'
import { validateAndMapAnthropicRequest } from './request-mapper.js'
import { mapAnthropicResponse } from './response-mapper.js'
import { mapAnthropicError } from './error-mapper.js'
import { streamAnthropic } from './stream.js'

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const
  private readonly client: Anthropic
  private readonly logger?: Logger | undefined

  constructor(cfg: AnthropicProviderConfig, logger?: Logger) {
    this.logger = logger
    this.client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
      maxRetries: 0,
      timeout: cfg.timeoutMs,
    })
  }

  async generate(input: ModelInput, signal?: AbortSignal): Promise<ModelOutput> {
    const params = validateAndMapAnthropicRequest(input)
    const startTime = Date.now()

    try {
      const raw = await this.client.messages.create(
        {
          ...params,
          stream: false,
        },
        {
          signal,
        },
      )
      const latencyMs = Date.now() - startTime
      return mapAnthropicResponse(raw, latencyMs, this.logger)
    } catch (err: unknown) {
      throw mapAnthropicError(err, signal)
    }
  }

  stream(input: ModelInput, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    const params = validateAndMapAnthropicRequest(input)
    const startTime = Date.now()

    return streamAnthropic(
      this.client,
      {
        ...params,
        stream: true,
      },
      input,
      startTime,
      signal,
      this.logger,
    )
  }

  async countInputTokens(input: ModelInput): Promise<number> {
    try {
      const params = validateAndMapAnthropicRequest(input)
      if (typeof this.client.messages.countTokens === 'function') {
        const res = await this.client.messages.countTokens({
          model: params.model,
          messages: params.messages,
          ...(params.system ? { system: params.system } : {}),
          ...(params.tools ? { tools: params.tools } : {}),
          ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
        })
        return res.input_tokens
      }
    } catch {
      // If endpoint returns 404 or fails, fall back to character estimation
    }

    // VERIFY: fallback approximation, replace when endpoint confirmed
    let totalChars = 0
    if (input.system) {
      totalChars += input.system.length
    }
    for (const msg of input.messages) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text.length
        } else if (part.type === 'tool_result') {
          totalChars += part.content.length
        } else if (part.type === 'tool_use') {
          totalChars += part.name.length + JSON.stringify(part.input).length
        }
      }
    }
    return Math.max(1, Math.ceil(totalChars / 4))
  }
}

export function createAnthropicProvider(
  cfg: AnthropicProviderConfig,
  logger?: Logger,
): ModelProvider {
  return new AnthropicProvider(cfg, logger)
}
