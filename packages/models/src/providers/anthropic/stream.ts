import type Anthropic from '@anthropic-ai/sdk'
import type { Logger } from '@ai-company/shared'
import type { ModelInput, ModelOutput, ContentPart, StopReason, TokenUsage } from '../../types.js'
import type { ModelEvent } from '../../provider.js'
import { ProviderError } from '../../errors.js'
import { mapAnthropicStopReason, mapAnthropicUsage } from './response-mapper.js'
import { mapAnthropicError } from './error-mapper.js'

export async function* streamAnthropic(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsStreaming,
  input: ModelInput,
  startTime: number,
  signal?: AbortSignal,
  logger?: Logger,
): AsyncIterable<ModelEvent> {
  const accumulatedParts: ContentPart[] = []
  let currentText = ''
  let currentToolId = ''
  let currentToolName = ''
  let currentToolJson = ''
  let inToolBlock = false
  let inTextBlock = false
  let rawStopReason: string | null | undefined
  let finalStopReason: StopReason = 'end_turn'
  let tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
  let receivedMessageStop = false

  try {
    const rawStream = await client.messages.create(params, {
      signal,
    })

    for await (const event of rawStream) {
      if (signal?.aborted) {
        throw new ProviderError({
          kind: 'timeout',
          provider: 'anthropic',
          message: 'Request timed out or was aborted',
        })
      }

      switch (event.type) {
        case 'message_start': {
          tokenUsage = mapAnthropicUsage(event.message.usage)
          yield { type: 'usage', usage: tokenUsage }
          break
        }

        case 'content_block_start': {
          if (event.content_block.type === 'tool_use') {
            inToolBlock = true
            currentToolId = event.content_block.id
            currentToolName = event.content_block.name
            currentToolJson = ''
            yield { type: 'tool_use_start', id: currentToolId, name: currentToolName }
          } else if (event.content_block.type === 'text') {
            inTextBlock = true
            currentText = event.content_block.text || ''
            if (currentText) {
              yield { type: 'text_delta', text: currentText }
            }
          }
          break
        }

        case 'content_block_delta': {
          if (event.delta.type === 'text_delta') {
            currentText += event.delta.text
            yield { type: 'text_delta', text: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            currentToolJson += event.delta.partial_json
            yield {
              type: 'tool_use_delta',
              id: currentToolId,
              partialJson: event.delta.partial_json,
            }
          }
          break
        }

        case 'content_block_stop': {
          if (inToolBlock) {
            let parsedInput: Record<string, unknown> = {}
            if (currentToolJson.trim().length > 0) {
              try {
                parsedInput = JSON.parse(currentToolJson)
              } catch {
                parsedInput = {}
              }
            }
            accumulatedParts.push({
              type: 'tool_use',
              id: currentToolId,
              name: currentToolName,
              input: parsedInput,
            })
            yield { type: 'tool_use_end', id: currentToolId }
            inToolBlock = false
            currentToolId = ''
            currentToolName = ''
            currentToolJson = ''
          } else if (inTextBlock) {
            accumulatedParts.push({
              type: 'text',
              text: currentText,
            })
            inTextBlock = false
            currentText = ''
          }
          break
        }

        case 'message_delta': {
          rawStopReason = event.delta.stop_reason
          finalStopReason = mapAnthropicStopReason(rawStopReason, logger)
          if (event.usage) {
            tokenUsage.outputTokens = event.usage.output_tokens
            yield { type: 'usage', usage: tokenUsage }
          }
          break
        }

        case 'message_stop': {
          receivedMessageStop = true
          const latencyMs = Date.now() - startTime
          const output: ModelOutput = {
            content: accumulatedParts,
            stopReason: finalStopReason,
            usage: tokenUsage,
            latencyMs,
            modelKey: input.modelKey,
            provider: 'anthropic',
          }
          yield { type: 'done', stopReason: finalStopReason, output }
          break
        }
      }
    }

    if (!receivedMessageStop) {
      if (signal?.aborted) {
        yield {
          type: 'error',
          error: new ProviderError({
            kind: 'timeout',
            provider: 'anthropic',
            message: 'Request timed out or was aborted',
          }),
        }
      } else {
        yield {
          type: 'error',
          error: new ProviderError({
            kind: 'network',
            provider: 'anthropic',
            message: 'Stream terminated prematurely before message_stop',
          }),
        }
      }
    }
  } catch (err: unknown) {
    const error = mapAnthropicError(err, signal)
    yield { type: 'error', error }
  }
}
