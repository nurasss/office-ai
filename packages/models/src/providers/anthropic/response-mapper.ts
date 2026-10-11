import type Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '@ai-company/shared'
import type { ContentPart, ModelOutput, StopReason, TokenUsage } from '../../types.js'
import { ProviderError } from '../../errors.js'

export function mapAnthropicStopReason(
  rawStopReason: string | null | undefined,
  logger?: Logger,
): StopReason {
  switch (rawStopReason) {
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'stop_sequence':
      return 'stop_sequence'
    case 'tool_use':
      return 'tool_use'
    case 'refusal':
      return 'content_filter'
    default:
      if (rawStopReason) {
        logger?.warn(
          { stopReason: rawStopReason },
          'Unknown stop_reason from Anthropic API, defaulting to end_turn',
        )
      }
      return 'end_turn'
  }
}

export function mapAnthropicUsage(usage: Anthropic.Usage): TokenUsage {
  const cacheCreation = (usage as { cache_creation_input_tokens?: number | null })
    .cache_creation_input_tokens
  if (cacheCreation !== undefined && cacheCreation !== null && cacheCreation > 0) {
    throw new ProviderError({
      kind: 'unknown',
      provider: 'anthropic',
      message: 'prompt caching is not supported yet',
    })
  }

  const cacheRead =
    (usage as { cache_read_input_tokens?: number | null }).cache_read_input_tokens ?? 0
  const inputTokens = (usage.input_tokens ?? 0) + cacheRead
  const cachedInputTokens = cacheRead
  const outputTokens = usage.output_tokens ?? 0

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  }
}

export function mapAnthropicResponse(
  raw: Anthropic.Message,
  latencyMs: number,
  logger?: Logger,
): ModelOutput {
  const usage = mapAnthropicUsage(raw.usage)
  const stopReason = mapAnthropicStopReason(raw.stop_reason, logger)

  const content: ContentPart[] = []
  for (const block of raw.content) {
    if (block.type === 'text') {
      content.push({
        type: 'text',
        text: block.text,
      })
    } else if (block.type === 'tool_use') {
      content.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      })
    }
  }

  return {
    content,
    stopReason,
    usage,
    latencyMs,
    modelKey: raw.model,
    provider: 'anthropic',
  }
}
