import type { ModelInput, ModelOutput } from '../types.js'
import type { ModelProvider, ModelEvent } from '../provider.js'
import { ProviderError } from '../errors.js'

export type FakeScriptItem =
  | {
      type: 'output'
      output: {
        content: ModelOutput['content']
        stopReason: ModelOutput['stopReason']
        usage: ModelOutput['usage']
        latencyMs?: number
        modelKey?: string
        provider?: string
      }
    }
  | {
      type: 'error'
      error: ProviderError
    }

export type FakeScript = FakeScriptItem[]

export interface FakeProvider extends ModelProvider {
  calls: ModelInput[]
  reset(newScript?: FakeScript): void
}

export function createFakeProvider(
  initialScript: FakeScript,
  providerName: 'openai' | 'anthropic' | 'google' = 'anthropic',
): FakeProvider {
  let script: FakeScript = [...initialScript]
  let currentIndex = 0
  const recordedCalls: ModelInput[] = []

  function getNextItem(input: ModelInput): FakeScriptItem {
    if (currentIndex >= script.length) {
      throw new ProviderError({
        kind: 'unknown',
        provider: providerName,
        message: `FakeProvider script exhausted: received call #${recordedCalls.length + 1} with modelKey '${input.modelKey}', but script only had ${script.length} responses`,
      })
    }
    const item = script[currentIndex]!
    currentIndex++
    return item
  }

  return {
    get name() {
      return providerName
    },
    get calls() {
      return recordedCalls
    },
    reset(newScript?: FakeScript): void {
      if (newScript) {
        script = [...newScript]
      }
      currentIndex = 0
      recordedCalls.length = 0
    },
    async generate(input: ModelInput, signal?: AbortSignal): Promise<ModelOutput> {
      recordedCalls.push(input)

      if (signal?.aborted) {
        throw new ProviderError({
          kind: 'timeout',
          provider: providerName,
          message: 'Operation was aborted',
        })
      }

      const item = getNextItem(input)
      if (item.type === 'error') {
        throw item.error
      }

      return {
        content: item.output.content,
        stopReason: item.output.stopReason,
        usage: item.output.usage,
        latencyMs: item.output.latencyMs ?? 10,
        modelKey: item.output.modelKey ?? input.modelKey,
        provider: item.output.provider ?? providerName,
      }
    },
    async *stream(input: ModelInput, signal?: AbortSignal): AsyncIterable<ModelEvent> {
      recordedCalls.push(input)

      if (signal?.aborted) {
        yield {
          type: 'error',
          error: new ProviderError({
            kind: 'timeout',
            provider: providerName,
            message: 'Operation was aborted',
          }),
        }
        return
      }

      const item = getNextItem(input)
      if (item.type === 'error') {
        yield { type: 'error', error: item.error }
        throw item.error
      }

      const fullOutput: ModelOutput = {
        content: item.output.content,
        stopReason: item.output.stopReason,
        usage: item.output.usage,
        latencyMs: item.output.latencyMs ?? 10,
        modelKey: item.output.modelKey ?? input.modelKey,
        provider: item.output.provider ?? providerName,
      }

      // Stream text in 8-character chunks
      for (const part of item.output.content) {
        if (part.type === 'text') {
          const text = part.text
          for (let i = 0; i < text.length; i += 8) {
            if (signal?.aborted) {
              yield {
                type: 'error',
                error: new ProviderError({
                  kind: 'timeout',
                  provider: providerName,
                  message: 'Operation was aborted',
                }),
              }
              return
            }
            yield {
              type: 'text_delta',
              text: text.slice(i, i + 8),
            }
          }
        } else if (part.type === 'tool_use') {
          yield {
            type: 'tool_use_start',
            id: part.id,
            name: part.name,
          }
          const jsonStr = JSON.stringify(part.input)
          for (let i = 0; i < jsonStr.length; i += 8) {
            yield {
              type: 'tool_use_delta',
              id: part.id,
              partialJson: jsonStr.slice(i, i + 8),
            }
          }
          yield {
            type: 'tool_use_end',
            id: part.id,
          }
        }
      }

      yield {
        type: 'usage',
        usage: item.output.usage,
      }

      yield {
        type: 'done',
        stopReason: item.output.stopReason,
        output: fullOutput,
      }
    },
    async countInputTokens(input: ModelInput): Promise<number> {
      let charCount = 0
      if (input.system) {
        charCount += input.system.length
      }
      for (const msg of input.messages) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            charCount += part.text.length
          } else if (part.type === 'tool_use') {
            charCount += part.name.length + JSON.stringify(part.input).length
          } else if (part.type === 'tool_result') {
            charCount += part.content.length
          }
        }
      }
      if (input.tools) {
        for (const tool of input.tools) {
          charCount += tool.name.length + tool.description.length + JSON.stringify(tool.inputSchema).length
        }
      }

      return Math.max(1, Math.ceil(charCount / 4))
    },
  }
}
