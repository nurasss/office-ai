import type { ModelInput, ModelOutput, TokenUsage, StopReason } from './types.js'
import type { ProviderError } from './errors.js'

export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; stopReason: StopReason; output: ModelOutput }
  | { type: 'error'; error: ProviderError }

export interface ModelProvider {
  readonly name: 'openai' | 'anthropic' | 'google'
  generate(input: ModelInput, signal?: AbortSignal): Promise<ModelOutput>
  stream(input: ModelInput, signal?: AbortSignal): AsyncIterable<ModelEvent>
  countInputTokens(input: ModelInput): Promise<number>
}
